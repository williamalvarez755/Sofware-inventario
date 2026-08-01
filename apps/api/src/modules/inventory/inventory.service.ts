import type { Request } from 'express';
import type { AdjustmentInput } from '@minimarket/shared';
import { AppError } from '../../lib/errors.js';
import { withTenantTx, type TenantClient } from '../../lib/prisma.js';
import { audit } from '../audit/audit.service.js';
import { applyMovement, type MovementResult } from './movements.service.js';

const OUT_TYPES = new Set(['ADJUSTMENT_OUT', 'WASTE', 'INTERNAL_USE']);

/** Ajustes manuales: entrada/salida por conteo, merma, consumo interno. */
export async function registerAdjustment(
  tenantId: string,
  userId: string,
  input: AdjustmentInput,
  req: Request,
): Promise<MovementResult> {
  return withTenantTx(tenantId, async (tx) => {
    const product = await tx.product.findFirst({
      where: { id: input.productId, deletedAt: null },
      include: { unit: { select: { allowsDecimals: true } } },
    });
    if (!product) throw new AppError(404, 'NOT_FOUND', 'Producto no encontrado');
    if (!product.unit.allowsDecimals && !Number.isInteger(input.qty)) {
      throw new AppError(400, 'VALIDATION', 'Este producto no admite cantidades decimales');
    }

    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
    const allowNegative =
      typeof tenant?.settings === 'object' &&
      tenant.settings !== null &&
      (tenant.settings as Record<string, unknown>).allow_negative_stock === true;

    const signedQty = OUT_TYPES.has(input.type) ? -input.qty : input.qty;
    const result = await applyMovement(tx, tenantId, {
      storeId: input.storeId,
      productId: input.productId,
      type: input.type,
      signedQty,
      userId,
      note: input.reason,
      allowNegative,
    });

    await audit(tx, {
      tenantId,
      storeId: input.storeId,
      userId,
      action: 'inventory.adjust',
      entityType: 'product',
      entityId: input.productId,
      after: { type: input.type, qty: input.qty, reason: input.reason, balanceAfter: result.balanceAfter },
    }, req);
    return result;
  });
}

/** Kardex paginado de un producto en una tienda (más reciente primero). */
export async function getKardex(
  db: TenantClient,
  storeId: string,
  productId: string,
  page: number,
  includeCosts: boolean,
) {
  const PAGE_SIZE = 50;
  const [rows, total] = await Promise.all([
    db.inventoryMovement.findMany({
      where: { storeId, productId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.inventoryMovement.count({ where: { storeId, productId } }),
  ]);
  return {
    total,
    page,
    pageSize: PAGE_SIZE,
    rows: rows.map((m) => ({
      id: m.id,
      type: m.type,
      qty: m.qty,
      balanceAfter: m.balanceAfter,
      note: m.note,
      refType: m.refType,
      createdAt: m.createdAt,
      ...(includeCosts ? { unitCost: m.unitCost } : {}),
    })),
  };
}

/** Productos en o bajo su stock mínimo (solo donde hay mínimo configurado). */
export function getLowStock(tenantId: string, storeId: string) {
  return withTenantTx(tenantId, (tx) =>
    tx.$queryRaw`
      SELECT sp.product_id AS "productId", p.name, p.sku,
             sp.stock_qty AS "stockQty", sp.min_stock AS "minStock"
      FROM store_products sp
      JOIN products p ON p.id = sp.product_id
      WHERE sp.store_id = ${storeId}::uuid
        AND sp.is_active AND p.deleted_at IS NULL
        AND sp.min_stock > 0 AND sp.stock_qty <= sp.min_stock
      ORDER BY (sp.stock_qty / NULLIF(sp.min_stock, 0)) ASC`,
  );
}
