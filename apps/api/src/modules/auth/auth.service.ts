/**
 * Auth de usuarios de tenant Y de super admins (kind 'platform').
 * Usa prismaAdmin deliberadamente: el login ocurre ANTES de conocer el tenant,
 * así que no hay contexto RLS todavía (único módulo con esta excepción,
 * ver src/lib/prisma.ts). Todo lo demás del request va por RLS.
 */
import argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';
import type { Request } from 'express';
import { forbidden, unauthorized } from '../../lib/errors.js';
import { prismaAdmin } from '../../lib/prisma.js';
import {
  hashRefreshToken,
  newRefreshToken,
  refreshExpiry,
  signAccessToken,
  type PrincipalKind,
} from '../../lib/tokens.js';
import { audit } from '../audit/audit.service.js';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

async function issueTokens(principal: {
  kind: PrincipalKind;
  id: string;
  tenantId?: string;
  familyId?: string; // presente al rotar; ausente en login (familia nueva)
  req?: Request;
}): Promise<TokenPair> {
  const { token, hash } = newRefreshToken();
  await prismaAdmin.refreshToken.create({
    data: {
      id: uuidv7(),
      tenantId: principal.tenantId ?? null,
      userId: principal.kind === 'user' ? principal.id : null,
      platformUserId: principal.kind === 'platform' ? principal.id : null,
      tokenHash: hash,
      familyId: principal.familyId ?? uuidv7(),
      deviceInfo: principal.req?.headers['user-agent']?.slice(0, 250) ?? null,
      ip: principal.req?.ip ?? null,
      expiresAt: refreshExpiry(),
    },
  });
  const accessToken = signAccessToken({
    sub: principal.id,
    kind: principal.kind,
    ...(principal.tenantId ? { ten: principal.tenantId } : {}),
  });
  return { accessToken, refreshToken: token };
}

export async function loginTenantUser(email: string, password: string, req: Request) {
  const user = await prismaAdmin.user.findUnique({
    where: { email },
    include: { tenant: { select: { id: true, name: true, status: true } } },
  });
  const passwordOk = user && (await argon2.verify(user.passwordHash, password));
  if (!user || !user.isActive || !passwordOk) {
    await audit(prismaAdmin, {
      tenantId: user?.tenantId,
      userId: user?.id,
      action: 'auth.login_failed',
      after: { email },
    }, req);
    throw unauthorized();
  }
  if (user.tenant.status !== 'ACTIVE') {
    await audit(prismaAdmin, {
      tenantId: user.tenantId,
      userId: user.id,
      action: 'auth.login_blocked_suspended',
    }, req);
    throw forbidden('TENANT_SUSPENDED', 'El servicio está suspendido. Contacte a soporte.');
  }

  const tokens = await issueTokens({ kind: 'user', id: user.id, tenantId: user.tenantId, req });
  await prismaAdmin.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(prismaAdmin, { tenantId: user.tenantId, userId: user.id, action: 'auth.login' }, req);

  return {
    ...tokens,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      mustChangePassword: user.mustChangePassword,
    },
    tenant: { id: user.tenant.id, name: user.tenant.name },
  };
}

export async function loginPlatformUser(email: string, password: string, req: Request) {
  const admin = await prismaAdmin.platformUser.findUnique({ where: { email } });
  const passwordOk = admin && (await argon2.verify(admin.passwordHash, password));
  if (!admin || !admin.isActive || !passwordOk) {
    await audit(prismaAdmin, {
      platformUserId: admin?.id,
      action: 'platform.login_failed',
      after: { email },
    }, req);
    throw unauthorized();
  }
  const tokens = await issueTokens({ kind: 'platform', id: admin.id, req });
  await audit(prismaAdmin, { platformUserId: admin.id, action: 'platform.login' }, req);
  return { ...tokens, admin: { id: admin.id, name: admin.name, email: admin.email } };
}

export async function rotateRefreshToken(rawToken: string, req: Request): Promise<TokenPair> {
  const row = await prismaAdmin.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
  });
  if (!row) throw unauthorized('Sesión inválida');

  // Detección de reuso: un token ya rotado que vuelve a usarse = posible robo.
  // Se revoca la familia completa (todas las rotaciones de ese dispositivo).
  if (row.revokedAt) {
    await prismaAdmin.refreshToken.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit(prismaAdmin, {
      tenantId: row.tenantId,
      userId: row.userId,
      platformUserId: row.platformUserId,
      action: 'auth.refresh_reuse_detected',
      entityType: 'refresh_token_family',
      entityId: row.familyId,
    }, req);
    throw unauthorized('Sesión revocada por seguridad');
  }
  if (row.expiresAt < new Date()) throw unauthorized('Sesión expirada');

  // Revalidar que el principal siga activo (despidos, suspensión de tenant).
  if (row.userId) {
    const user = await prismaAdmin.user.findUnique({
      where: { id: row.userId },
      include: { tenant: { select: { status: true } } },
    });
    if (!user?.isActive) throw unauthorized();
    if (user.tenant.status !== 'ACTIVE') {
      throw forbidden('TENANT_SUSPENDED', 'El servicio está suspendido.');
    }
  } else if (row.platformUserId) {
    const admin = await prismaAdmin.platformUser.findUnique({ where: { id: row.platformUserId } });
    if (!admin?.isActive) throw unauthorized();
  }

  await prismaAdmin.refreshToken.update({
    where: { id: row.id },
    data: { revokedAt: new Date() },
  });
  return issueTokens({
    kind: row.userId ? 'user' : 'platform',
    id: (row.userId ?? row.platformUserId)!,
    tenantId: row.tenantId ?? undefined,
    familyId: row.familyId,
    req,
  });
}

export async function revokeSession(rawToken: string, req: Request): Promise<void> {
  const row = await prismaAdmin.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
  });
  if (!row) return; // logout idempotente
  await prismaAdmin.refreshToken.updateMany({
    where: { familyId: row.familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await audit(prismaAdmin, {
    tenantId: row.tenantId,
    userId: row.userId,
    platformUserId: row.platformUserId,
    action: 'auth.logout',
  }, req);
}
