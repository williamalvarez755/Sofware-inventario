/**
 * 2FA TOTP (RFC 6238) para OWNER y SUPER_ADMIN.
 *
 * Decisiones que importan:
 *  - El QR se genera EN EL SERVIDOR como data URL. Nunca se manda el secreto a
 *    un servicio externo de códigos QR — sería regalar el segundo factor.
 *  - El secreto se guarda al hacer "setup" pero 2FA solo cuenta como activo
 *    cuando el usuario prueba un código válido (totpEnabledAt). Así nadie se
 *    queda fuera de su propio negocio por un QR que nunca escaneó.
 *  - Códigos de recuperación de un solo uso, hasheados con Argon2id: un
 *    tendero que pierde el teléfono no puede perder el acceso a su negocio.
 *  - Ventana de validación de ±1 paso (30 s) para tolerar relojes desfasados,
 *    que en teléfonos baratos es la causa #1 de "mi código no sirve".
 */
import { randomInt } from 'node:crypto';
import argon2 from 'argon2';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { v7 as uuidv7 } from 'uuid';
import type { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prismaAdmin } from '../../lib/prisma.js';

const ISSUER = 'MiniMarket';
const RECOVERY_CODE_COUNT = 8;

export interface Principal {
  kind: 'user' | 'platform';
  id: string;
  email: string;
  tenantId?: string;
}

function totp(secret: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1', // el que soportan Google Authenticator y Authy
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

/** Valida con tolerancia de ±1 periodo (relojes desfasados). */
export function verifyTotpCode(secret: string, label: string, code: string): boolean {
  return totp(secret, label).validate({ token: code.replace(/\s/g, ''), window: 1 }) !== null;
}

function newRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I, O, 0, 1
  let out = '';
  for (let i = 0; i < 10; i++) {
    if (i === 5) out += '-';
    out += alphabet[randomInt(alphabet.length)];
  }
  return out;
}

/**
 * Estado de 2FA del principal. Para usuarios de tenant vive en `user_totp`
 * (tabla aparte, fuera del alcance del rol de runtime — D-033); para el super
 * admin, en su propia tabla, que el runtime tampoco puede leer.
 */
export async function getTwoFactorRecord(
  principal: Principal,
): Promise<{ totpSecret: string | null; totpEnabledAt: Date | null }> {
  if (principal.kind === 'user') {
    const row = await prismaAdmin.userTotp.findUnique({ where: { userId: principal.id } });
    return { totpSecret: row?.secret ?? null, totpEnabledAt: row?.enabledAt ?? null };
  }
  const row = await prismaAdmin.platformUser.findUnique({
    where: { id: principal.id },
    select: { totpSecret: true, totpEnabledAt: true },
  });
  return { totpSecret: row?.totpSecret ?? null, totpEnabledAt: row?.totpEnabledAt ?? null };
}

/** Paso 1: genera el secreto y el QR. Todavía NO activa el 2FA. */
export async function startTwoFactorSetup(principal: Principal) {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  const uri = totp(secret, principal.email).toString();

  if (principal.kind === 'user') {
    await prismaAdmin.userTotp.upsert({
      where: { userId: principal.id },
      update: { secret, enabledAt: null },
      create: { userId: principal.id, tenantId: principal.tenantId!, secret },
    });
  } else {
    await prismaAdmin.platformUser.update({
      where: { id: principal.id },
      data: { totpSecret: secret, totpEnabledAt: null },
    });
  }

  return {
    secret, // se muestra para quien no pueda escanear el QR
    otpauthUri: uri,
    qrDataUrl: await QRCode.toDataURL(uri, { width: 240, margin: 1 }),
  };
}

/** Paso 2: verifica un código real y activa. Devuelve los códigos de recuperación. */
export async function enableTwoFactor(principal: Principal, code: string) {
  const record = await getTwoFactorRecord(principal);

  if (!record?.totpSecret) {
    throw new AppError(409, 'TOTP_NOT_STARTED', 'Primero genere el código QR de configuración');
  }
  if (record.totpEnabledAt) {
    throw new AppError(409, 'TOTP_ALREADY_ENABLED', 'La verificación en dos pasos ya está activa');
  }
  if (!verifyTotpCode(record.totpSecret, principal.email, code)) {
    throw new AppError(400, 'TOTP_INVALID', 'El código no es válido. Verifique la hora del teléfono.');
  }

  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  const hashes = await Promise.all(codes.map((c) => argon2.hash(c)));

  await prismaAdmin.$transaction(async (tx) => {
    if (principal.kind === 'user') {
      await tx.userTotp.update({
        where: { userId: principal.id },
        data: { enabledAt: new Date() },
      });
    } else {
      await tx.platformUser.update({
        where: { id: principal.id },
        data: { totpEnabledAt: new Date() },
      });
    }
    // Reemplaza cualquier lote anterior
    await tx.recoveryCode.deleteMany({
      where:
        principal.kind === 'user'
          ? { userId: principal.id }
          : { platformUserId: principal.id },
    });
    await tx.recoveryCode.createMany({
      data: hashes.map((hash) => ({
        id: uuidv7(),
        tenantId: principal.tenantId ?? null,
        userId: principal.kind === 'user' ? principal.id : null,
        platformUserId: principal.kind === 'platform' ? principal.id : null,
        codeHash: hash,
      })),
    });
  });

  // Los códigos en claro se devuelven UNA sola vez.
  return { recoveryCodes: codes };
}

export async function disableTwoFactor(principal: Principal, password: string, code: string) {
  const record = await getTwoFactorRecord(principal);
  if (!record.totpEnabledAt || !record.totpSecret) {
    throw new AppError(409, 'TOTP_NOT_ENABLED', 'La verificación en dos pasos no está activa');
  }
  const credentials =
    principal.kind === 'user'
      ? await prismaAdmin.user.findUnique({
          where: { id: principal.id },
          select: { passwordHash: true },
        })
      : await prismaAdmin.platformUser.findUnique({
          where: { id: principal.id },
          select: { passwordHash: true },
        });
  // Desactivar exige AMBOS factores: si alguien roba la sesión, no puede
  // quitar el segundo factor sin conocer la contraseña.
  if (!credentials || !(await argon2.verify(credentials.passwordHash, password))) {
    throw new AppError(400, 'INVALID_PASSWORD', 'Contraseña incorrecta');
  }
  if (!(await consumeSecondFactor(principal, record.totpSecret, code))) {
    throw new AppError(400, 'TOTP_INVALID', 'El código no es válido');
  }

  await prismaAdmin.$transaction(async (tx) => {
    if (principal.kind === 'user') {
      await tx.userTotp.deleteMany({ where: { userId: principal.id } });
    } else {
      await tx.platformUser.update({
        where: { id: principal.id },
        data: { totpSecret: null, totpEnabledAt: null },
      });
    }
    await tx.recoveryCode.deleteMany({
      where:
        principal.kind === 'user' ? { userId: principal.id } : { platformUserId: principal.id },
    });
  });
}

/**
 * Acepta un código TOTP o uno de recuperación (consumiéndolo).
 * Devuelve true si el segundo factor quedó satisfecho.
 */
export async function consumeSecondFactor(
  principal: Principal,
  secret: string,
  code: string,
): Promise<boolean> {
  const clean = code.replace(/\s/g, '').toUpperCase();
  if (/^\d{6}$/.test(clean) && verifyTotpCode(secret, principal.email, clean)) return true;

  // Código de recuperación: se compara contra los no usados y se marca al usar.
  const candidates = await prismaAdmin.recoveryCode.findMany({
    where: {
      usedAt: null,
      ...(principal.kind === 'user'
        ? { userId: principal.id }
        : { platformUserId: principal.id }),
    },
  });
  for (const candidate of candidates) {
    if (await argon2.verify(candidate.codeHash, clean)) {
      await prismaAdmin.recoveryCode.update({
        where: { id: candidate.id },
        data: { usedAt: new Date() },
      });
      return true;
    }
  }
  return false;
}

/** Cuántos códigos de recuperación le quedan al usuario (para avisarle). */
export function countRecoveryCodes(principal: Principal): Promise<number> {
  return prismaAdmin.recoveryCode.count({
    where: {
      usedAt: null,
      ...(principal.kind === 'user' ? { userId: principal.id } : { platformUserId: principal.id }),
    },
  });
}

export type TwoFactorTx = Prisma.TransactionClient;
