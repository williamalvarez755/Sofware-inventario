import { v7 as uuidv7 } from 'uuid';
import type { Request } from 'express';

/** Acepta PrismaClient, TenantClient o Prisma.TransactionClient. */
type AuditDb = { auditLog: { create(args: { data: Record<string, unknown> }): Promise<unknown> } };

export interface AuditEntry {
  tenantId?: string | null;
  storeId?: string | null;
  userId?: string | null;
  platformUserId?: string | null;
  impersonating?: boolean;
  action: string;             // catálogo: 'auth.login', 'store.create', 'platform.tenant_status'...
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Registra en bitácora DENTRO de la transacción que se le pase (D-019):
 * si el cambio no committea, el log tampoco — y viceversa.
 */
export async function audit(db: AuditDb, entry: AuditEntry, req?: Request): Promise<void> {
  await db.auditLog.create({
    data: {
      id: uuidv7(),
      tenantId: entry.tenantId ?? null,
      storeId: entry.storeId ?? null,
      userId: entry.userId ?? null,
      platformUserId: entry.platformUserId ?? null,
      impersonating: entry.impersonating ?? false,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      before: entry.before === undefined ? undefined : (entry.before as object),
      after: entry.after === undefined ? undefined : (entry.after as object),
      ip: req?.ip ?? null,
      userAgent: req?.headers['user-agent'] ?? null,
    },
  });
}
