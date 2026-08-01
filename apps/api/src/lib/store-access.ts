import { roleHasPermission, type PermissionCode, type Role } from '@minimarket/shared';
import { forbidden } from './errors.js';

export interface MembershipLike {
  storeId: string;
  role: string;
  extraPermissions?: unknown;
}

/** OWNER accede a todas las tiendas del tenant; el resto, solo a las suyas. */
export function canAccessStore(memberships: MembershipLike[], storeId: string): boolean {
  return (
    memberships.some((m) => m.role === 'OWNER') ||
    memberships.some((m) => m.storeId === storeId)
  );
}

export function assertStoreAccess(memberships: MembershipLike[], storeId: string): void {
  if (!canAccessStore(memberships, storeId)) {
    throw forbidden('STORE_ACCESS_DENIED', 'No tiene acceso a esta tienda');
  }
}

/** Costos/márgenes: jamás visibles para WORKER (CLAUDE.md A10). */
export function canViewCosts(memberships: MembershipLike[]): boolean {
  return memberships.some(
    (m) =>
      roleHasPermission(m.role as Role, 'costs.view' satisfies PermissionCode) ||
      (Array.isArray(m.extraPermissions) && m.extraPermissions.includes('costs.view')),
  );
}
