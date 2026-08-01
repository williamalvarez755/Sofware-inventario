/**
 * Módulo de plataforma (super admin). Usa prismaAdmin: opera POR ENCIMA de los
 * tenants (rol de conexión distinto, sin contexto RLS) y todo queda auditado.
 */
import type { Request } from 'express';
import type { TenantStatus } from '@prisma/client';
import { notFound } from '../../lib/errors.js';
import { prismaAdmin } from '../../lib/prisma.js';
import { invalidateTenantCache } from '../../middleware/auth.js';
import { audit } from '../audit/audit.service.js';

export async function listTenants() {
  const tenants = await prismaAdmin.tenant.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { stores: true, users: true } },
      subscriptions: {
        orderBy: { periodEnd: 'desc' },
        take: 1,
        include: { plan: { select: { code: true, name: true } } },
      },
    },
  });
  return tenants.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    suspendedReason: t.suspendedReason,
    stores: t._count.stores,
    users: t._count.users,
    subscription: t.subscriptions[0] ?? null,
    createdAt: t.createdAt,
  }));
}

export async function setTenantStatus(
  tenantId: string,
  status: TenantStatus,
  reason: string,
  platformUserId: string,
  req: Request,
) {
  const before = await prismaAdmin.tenant.findUnique({ where: { id: tenantId } });
  if (!before) throw notFound('Tenant no encontrado');

  const updated = await prismaAdmin.$transaction(async (tx) => {
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { status, suspendedReason: status === 'ACTIVE' ? null : reason },
    });
    await audit(tx, {
      tenantId,
      platformUserId,
      action: 'platform.tenant_status',
      entityType: 'tenant',
      entityId: tenantId,
      before: { status: before.status, suspendedReason: before.suspendedReason },
      after: { status, reason },
    }, req);
    return tenant;
  });

  invalidateTenantCache(tenantId); // efecto inmediato, sin esperar el TTL
  return { id: updated.id, status: updated.status, suspendedReason: updated.suspendedReason };
}
