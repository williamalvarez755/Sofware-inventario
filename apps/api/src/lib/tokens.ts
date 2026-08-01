import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized } from './errors.js';

export type PrincipalKind = 'user' | 'platform';

export interface AccessPayload {
  sub: string;            // user id o platform_user id
  ten?: string;           // tenant id (solo kind 'user')
  kind: PrincipalKind;
  /** Super admin que está "viendo como" este tenant (D-028). Su presencia
   *  marca la sesión como impersonada: solo lectura y todo auditado. */
  imp?: string;
}

export function signAccessToken(payload: AccessPayload, ttlMinutes?: number): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: `${ttlMinutes ?? env.ACCESS_TOKEN_TTL_MIN}m`,
    issuer: 'minimarket-api',
  });
}

export function verifyAccessToken(token: string): AccessPayload {
  let payload: AccessPayload & { chal?: boolean };
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { issuer: 'minimarket-api' }) as AccessPayload & {
      chal?: boolean;
    };
  } catch {
    throw unauthorized('Sesión inválida o expirada');
  }
  // Un token de desafío 2FA jamás vale como token de acceso.
  if (payload.chal) throw unauthorized();
  return payload;
}

/**
 * Token de desafío del segundo factor: vida muy corta (5 min) y sin poder
 * alguno salvo el de completar ese login concreto.
 */
export interface ChallengePayload {
  sub: string;
  kind: PrincipalKind;
  ten?: string;
  chal: true;
}

export function signChallengeToken(payload: Omit<ChallengePayload, 'chal'>): string {
  return jwt.sign({ ...payload, chal: true }, env.JWT_SECRET, {
    expiresIn: '5m',
    issuer: 'minimarket-api',
  });
}

export function verifyChallengeToken(token: string): ChallengePayload {
  let payload: ChallengePayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { issuer: 'minimarket-api' }) as ChallengePayload;
  } catch {
    throw unauthorized('La verificación expiró. Ingrese de nuevo.');
  }
  if (!payload.chal) throw unauthorized();
  return payload;
}

/** Refresh token: opaco (no JWT). Solo su hash SHA-256 se guarda en BD. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
