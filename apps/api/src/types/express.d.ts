import type { MemberRole } from '@prisma/client';
import type { TenantClient } from '../lib/prisma.js';
import type { PrincipalKind } from '../lib/tokens.js';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        kind: PrincipalKind;
        userId: string;
        tenantId?: string;
        /** Presente solo en sesiones impersonadas: id del super admin. */
        impersonatedBy?: string;
      };
      /** Cliente Prisma con RLS del tenant autenticado (solo kind 'user'). */
      db?: TenantClient;
      /** Membresías activas del usuario, cargadas por requirePermission. */
      memberships?: { storeId: string; role: MemberRole; extraPermissions: unknown }[];
    }
  }
}

export {};
