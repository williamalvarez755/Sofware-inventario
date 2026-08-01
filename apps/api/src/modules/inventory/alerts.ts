/**
 * Alertas de stock bajo (CLAUDE.md §6.7, D-020): se evalúan EN LA MISMA
 * transacción del movimiento (un par de queries baratas, sin colas).
 * Episodios: una sola alerta ACTIVE por producto-tienda (índice parcial);
 * la notificación in-app se crea solo al ABRIR el episodio (anti-spam) y la
 * alerta se resuelve sola cuando el stock se recupera.
 */
import { v7 as uuidv7 } from 'uuid';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export async function evaluateStockAlert(
  tx: Tx,
  tenantId: string,
  params: {
    storeProductId: string;
    storeId: string;
    productId: string;
    stockQty: number;
    minStock: number;
  },
): Promise<void> {
  if (params.minStock <= 0) return;

  if (params.stockQty <= params.minStock) {
    const inserted = await tx.$executeRaw`
      INSERT INTO stock_alerts (id, tenant_id, store_product_id)
      VALUES (${uuidv7()}::uuid, ${tenantId}::uuid, ${params.storeProductId}::uuid)
      ON CONFLICT DO NOTHING`;
    if (inserted > 0) {
      const [product, store, admins] = await Promise.all([
        tx.product.findUnique({ where: { id: params.productId }, select: { name: true } }),
        tx.store.findUnique({ where: { id: params.storeId }, select: { name: true } }),
        tx.storeMember.findMany({
          where: {
            storeId: params.storeId,
            isActive: true,
            role: { in: ['OWNER', 'STORE_ADMIN'] },
          },
          select: { userId: true },
        }),
      ]);
      if (admins.length > 0) {
        await tx.notification.createMany({
          data: admins.map((a) => ({
            id: uuidv7(),
            tenantId,
            userId: a.userId,
            type: 'STOCK_LOW',
            title: `Stock bajo: ${product?.name ?? 'producto'}`,
            body: `Quedan ${params.stockQty} (mínimo ${params.minStock}) en ${store?.name ?? 'la tienda'}.`,
            data: { productId: params.productId, storeId: params.storeId },
          })),
        });
      }
    }
  } else {
    await tx.$executeRaw`
      UPDATE stock_alerts SET status = 'RESOLVED', resolved_at = now()
      WHERE store_product_id = ${params.storeProductId}::uuid AND status = 'ACTIVE'`;
  }
}
