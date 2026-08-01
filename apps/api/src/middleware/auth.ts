import type { NextFunction, Request, Response } from 'express';
import type { TenantStatus } from '@prisma/client';
import { forbidden, unauthorized } from '../lib/errors.js';
import { forTenant, prismaAdmin } from '../lib/prisma.js';
import { verifyAccessToken } from '../lib/tokens.js';

/**
 * Cache en memoria del estado del tenant (TTL 60 s): la suspensión por el
 * super admin surte efecto en ≤ 1 min sin consultar la BD en cada request.
 */
const tenantStatusCache = new Map<string, { status: TenantStatus; expires: number }>();
const TTL_MS = 60_000;

export function invalidateTenantCache(tenantId: string): void {
  tenantStatusCache.delete(tenantId);
}

async function getTenantStatus(tenantId: string): Promise<TenantStatus> {
  const cached = tenantStatusCache.get(tenantId);
  if (cached && cached.expires > Date.now()) return cached.status;
  const tenant = await prismaAdmin.tenant.findUnique({
    where: { id: tenantId },
    select: { status: true },
  });
  const status = tenant?.status ?? 'CANCELLED';
  tenantStatusCache.set(tenantId, { status, expires: Date.now() + TTL_MS });
  return status;
}

function bearerToken(req: Request): string {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized('Token requerido');
  return header.slice('Bearer '.length);
}

/** Autenticación de usuarios de tenant: adjunta req.auth y req.db (RLS). */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const payload = verifyAccessToken(bearerToken(req));
  if (payload.kind !== 'user' || !payload.ten) throw unauthorized();

  // Sesión impersonada (D-028): estrictamente de lectura. El super admin ve lo
  // que ve el cliente, pero no puede vender, anular ni tocar su dinero.
  if (payload.imp && req.method !== 'GET') {
    throw forbidden(
      'IMPERSONATION_READ_ONLY',
      'La sesión de soporte es de solo lectura: no puede modificar datos del cliente',
    );
  }

  // Un tenant suspendido sigue siendo visible para soporte (por eso el super
  // admin puede entrar a diagnosticar); para sus propios usuarios, no.
  const status = await getTenantStatus(payload.ten);
  if (status !== 'ACTIVE' && !payload.imp) {
    throw forbidden(
      'TENANT_SUSPENDED',
      'El servicio está suspendido. Contacte al administrador de la plataforma.',
    );
  }

  req.auth = {
    kind: 'user',
    userId: payload.sub,
    tenantId: payload.ten,
    ...(payload.imp ? { impersonatedBy: payload.imp } : {}),
  };
  req.db = forTenant(payload.ten);
  next();
}

/** Autenticación de super admins (módulo plataforma). */
export function requirePlatformAuth(req: Request, _res: Response, next: NextFunction) {
  const payload = verifyAccessToken(bearerToken(req));
  if (payload.kind !== 'platform') throw forbidden('PLATFORM_ONLY', 'Acceso solo de plataforma');
  req.auth = { kind: 'platform', userId: payload.sub };
  next();
}
