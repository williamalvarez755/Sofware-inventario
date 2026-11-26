import { v7 as uuidv7 } from 'uuid';
import type { Request } from 'express';
import type { StoreCreateInput } from '@minimarket/shared';
import { forbidden } from '../../lib/errors.js';
import { withTenantTx, type TenantClient } from '../../lib/prisma.js';
import { audit } from '../audit/audit.service.js';

type Membership = { storeId: string; role: string };

/**
 * OWNER ve todas las tiendas del tenant; los demás, solo donde son miembros.
 *
 * LAS INACTIVAS NO SE OFRECEN. `stores.is_active` existía desde la Fase 0 y
 * **ningún listado lo filtraba**: una tienda dada de baja seguía apareciendo
 * en el selector del punto de venta, lista para venderle. Eso convertía la
 * columna en adorno y, peor, dejaba cobrar en una sucursal cerrada.
 *
 * Importa además por una razón que no es de negocio: los ledgers son
 * inmutables por diseño (D-007), así que una tienda **no se puede borrar
 * nunca**. Sin este filtro, cada tienda creada por error o por una prueba se
 * queda para siempre en la lista que el cajero ve al abrir turno. En la base
 * de desarrollo llegaron a ser 122 contra 1 real.
 *
 * El acceso NO se toca: `canAccessStore` sigue permitiendo operar una tienda
 * inactiva si alguien tiene su identificador, porque cerrar una sucursal no
 * debe romper un turno en curso ni esconder su historial en los reportes.
 */
export async function listVisibleStores(db: TenantClient, memberships: Membership[]) {
  const isOwner = memberships.some((m) => m.role === 'OWNER');
  return db.store.findMany({
    where: {
      isActive: true,
      ...(isOwner ? {} : { id: { in: memberships.map((m) => m.storeId) } }),
    },
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
