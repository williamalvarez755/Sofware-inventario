import type { NextFunction, Request, Response } from 'express';
import { roleHasPermission, type PermissionCode, type Role } from '@minimarket/shared';
import { forbidden, unauthorized } from '../lib/errors.js';

/**
 * Carga membresías activas del usuario y exige el permiso en al menos una.
 * La validación FINA por tienda (¿tiene el permiso EN ESTA tienda?) la hace
 * cada servicio con req.memberships — este middleware corta lo evidente.
 */
export function requirePermission(permission: PermissionCode) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth || !req.db) throw unauthorized();
    req.memberships ??= await req.db.storeMember.findMany({
      where: { userId: req.auth.userId, isActive: true },
      select: { storeId: true, role: true, extraPermissions: true },
    });
    const allowed = req.memberships.some(
      (m) =>
        roleHasPermission(m.role as Role, permission) ||
        (Array.isArray(m.extraPermissions) && m.extraPermissions.includes(permission)),
    );
    if (!allowed) {
      throw forbidden('PERMISSION_DENIED', 'No tiene permiso para esta acción');
    }
    next();
  };
}

/** Solo carga membresías (para endpoints donde todo miembro puede entrar). */
export async function loadMemberships(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth || !req.db) throw unauthorized();
  req.memberships ??= await req.db.storeMember.findMany({
    where: { userId: req.auth.userId, isActive: true },
    select: { storeId: true, role: true, extraPermissions: true },
  });
  next();
}
