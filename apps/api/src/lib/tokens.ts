import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized } from './errors.js';

export type PrincipalKind = 'user' | 'platform';

export interface AccessPayload {
  sub: string;            // user id o platform_user id
  ten?: string;           // tenant id (solo kind 'user')
  kind: PrincipalKind;
}

export function signAccessToken(payload: AccessPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m`,
    issuer: 'minimarket-api',
  });
}

export function verifyAccessToken(token: string): AccessPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET, { issuer: 'minimarket-api' }) as AccessPayload;
  } catch {
    throw unauthorized('Sesión inválida o expirada');
  }
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
