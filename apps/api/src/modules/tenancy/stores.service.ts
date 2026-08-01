import { v7 as uuidv7 } from 'uuid';
import type { Request } from 'express';
import type { StoreCreateInput } from '@minimarket/shared';
import { forbidden } from '../../lib/errors.js';
import { withTenantTx, type TenantClient } from '../../lib/prisma.js';
import { audit } from '../audit/audit.service.js';

type Membership = { storeId: string; role: string };

/** OWNER ve todas las tiendas del tenant; los demás, solo donde son miembros. */
export async function listVisibleStores(db: TenantClient, memberships: Membership[]) {
  const isOwner = memberships.some((m) => m.role === 'OWNER');
  return db.store.findMany({
    where: isOwner ? {} : { id: { in: memberships.map((m) => m.storeId) } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, address: true, phone: true, isActive: true },
  });
}

export async function createStore(
  tenantId: string,
  userId: string,
  input: StoreCreateInput,
  req: Request,
) {
  return withTenantTx(tenantId, async (tx) => {
    // Límite del plan: suscripción vigente más reciente.
    const today = new Date();
    const subscription = await tx.subscription.findFirst({
      where: { status: { in: ['TRIAL', 'ACTIVE'] }, periodEnd: { gte: today } },
      orderBy: { periodEnd: 'desc' },
      include: { plan: { select: { maxStores: true, name: true } } },
    });
    if (!subscription) {
      throw forbidden('NO_ACTIVE_PLAN', 'No hay una suscripción activa. Contacte a soporte.');
    }
    const storeCount = await tx.store.count();
    if (storeCount >= subscription.plan.maxStores) {
      throw forbidden(
        'PLAN_LIMIT_STORES',
        `Su plan (${subscription.plan.name}) permite máximo ${subscription.plan.maxStores} tienda(s).`,
      );
    }

    const store = await tx.store.create({
      data: { id: uuidv7(), tenantId, ...input },
    });
    // El creador (OWNER) queda como miembro de la tienda nueva.
    await tx.storeMember.create({
      data: { id: uuidv7(), tenantId, storeId: store.id, userId, role: 'OWNER' },
    });
    await audit(tx, {
      tenantId,
      userId,
      storeId: store.id,
      action: 'store.create',
      entityType: 'store',
      entityId: store.id,
      after: { name: store.name },
    }, req);
    return store;
  });
}
