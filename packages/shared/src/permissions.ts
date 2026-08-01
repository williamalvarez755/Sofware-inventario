/**
 * Catálogo de permisos y mapeo rol→permisos.
 * FUENTE DE VERDAD en v1: el seed lo persiste en BD (tablas permissions /
 * role_permissions) para reportería y roles custom futuros, pero el API evalúa
 * contra estas constantes (más rápido y sin cache que invalidar). Si en el
 * futuro hay roles personalizados por tenant, la evaluación pasa a BD.
 */

export const PERMISSIONS = {
  // Tenancy / administración
  STORES_MANAGE: 'stores.manage',
  USERS_MANAGE: 'users.manage',
  SETTINGS_MANAGE: 'settings.manage',
  AUDIT_VIEW: 'audit.view',
  // Catálogo e inventario (Fase 1)
  PRODUCTS_MANAGE: 'products.manage',
  INVENTORY_ADJUST: 'inventory.adjust',
  // Ventas (Fase 2)
  SALES_CREATE: 'sales.create',
  SALES_VOID: 'sales.void',
  // Caja (Fase 2)
  CASH_OPEN: 'cash.open',
  CASH_CLOSE: 'cash.close',
  CASH_WITHDRAW: 'cash.withdraw',        // registrar retiro (worker: requiere PIN admin)
  CASH_AUTHORIZE: 'cash.authorize',      // autorizar retiros/anulaciones con PIN
  // Compras y gastos (Fase 3)
  PURCHASES_RECEIVE: 'purchases.receive',
  SUPPLIERS_MANAGE: 'suppliers.manage',
  EXPENSES_CREATE: 'expenses.create',
  // Reportes y costos (Fase 4)
  REPORTS_VIEW: 'reports.view',
  COSTS_VIEW: 'costs.view',              // ver costos/márgenes/utilidad — NUNCA worker
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DESCRIPTIONS: Record<PermissionCode, string> = {
  'stores.manage': 'Crear y editar tiendas del negocio',
  'users.manage': 'Administrar trabajadores y sus accesos',
  'settings.manage': 'Configuración del negocio',
  'audit.view': 'Ver bitácora de auditoría del negocio',
  'products.manage': 'Crear y editar productos, categorías y códigos',
  'inventory.adjust': 'Ajustes, mermas y consumo interno de inventario',
  'sales.create': 'Registrar ventas en el POS',
  'sales.void': 'Anular ventas',
  'cash.open': 'Abrir caja',
  'cash.close': 'Cerrar caja y hacer arqueo',
  'cash.withdraw': 'Registrar retiros de efectivo',
  'cash.authorize': 'Autorizar retiros y anulaciones (PIN de supervisor)',
  'purchases.receive': 'Registrar compras a proveedores',
  'suppliers.manage': 'Administrar proveedores',
  'expenses.create': 'Registrar gastos',
  'reports.view': 'Ver reportes de la tienda',
  'costs.view': 'Ver costos, márgenes y utilidades',
};

export const ROLES = ['OWNER', 'STORE_ADMIN', 'WORKER'] as const;
export type Role = (typeof ROLES)[number];

const ALL = Object.values(PERMISSIONS) as PermissionCode[];

export const ROLE_PERMISSIONS: Record<Role, readonly PermissionCode[]> = {
  OWNER: ALL,
  // Según matriz CLAUDE.md §3.2: crear tiendas y configuración son solo del OWNER.
  STORE_ADMIN: ALL.filter((p) => p !== 'settings.manage' && p !== 'stores.manage'),
  WORKER: [
    'sales.create',
    'cash.open',
    'cash.close',
    'cash.withdraw',
    'expenses.create',
  ],
};

export function roleHasPermission(role: Role, permission: PermissionCode): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
