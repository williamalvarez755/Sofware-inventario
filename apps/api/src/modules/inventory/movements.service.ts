/**
 * Núcleo del kardex (CLAUDE.md §6.4, D-007, D-008).
 * Reglas que este archivo garantiza:
 *  - stock_qty se modifica SOLO con UPDATE atómico (sin carrera posible):
 *    si la condición de stock no se cumple, 0 filas → STOCK_INSUFFICIENT.
 *  - TODO cambio de stock inserta su fila en inventory_movements con
 *    balance_after tomado del RETURNING del mismo UPDATE (exacto bajo concurrencia).
 *  - El costo promedio (CPP) solo cambia en entradas con costo (INITIAL hoy,
 *    PURCHASE en Fase 3) vía applyCostedEntry.
 * Todas las funciones exigen correr dentro de withTenantTx (contexto RLS).
 */
import { Prisma } from '@prisma/client';
import type { MovementType } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { AppError } from '../../lib/errors.js';

type Tx = Prisma.TransactionClient;

export interface MovementResult {
  movementId: string;
  balanceAfter: string; // Decimal serializado
  /** Costo unitario aplicado al movimiento (CPP vigente) — lo congela la venta. */
  unitCost: bigint;
}

function toDecimalString(qty: number): string {
  return qty.toFixed(3);
}

async function ensureStoreProduct(tx: Tx, tenantId: string, storeId: string, productId: string) {
  await tx.$executeRaw`
    INSERT INTO store_products (id, tenant_id, store_id, product_id, updated_at)
    VALUES (${uuidv7()}::uuid, ${tenantId}::uuid, ${storeId}::uuid, ${productId}::uuid, now())
    ON CONFLICT (store_id, product_id) DO NOTHING`;
}

async function insertMovement(
  tx: Tx,
  data: {
    tenantId: string;
    storeId: string;
    productId: string;
    type: MovementType;
    qty: string;
    unitCost: bigint;
    balanceAfter: string;
    userId: string;
    refType?: string;
    refId?: string;
    note?: string;
  },
): Promise<string> {
  const id = uuidv7();
  await tx.inventoryMovement.create({
    data: {
      id,
      tenantId: data.tenantId,
      storeId: data.storeId,
      productId: data.productId,
      type: data.type,
      qty: new Prisma.Decimal(data.qty),
      unitCost: data.unitCost,
      balanceAfter: new Prisma.Decimal(data.balanceAfter),
      refType: data.refType ?? null,
      refId: data.refId ?? null,
      userId: data.userId,
      note: data.note ?? null,
    },
  });
  return id;
}

/**
 * Movimiento SIN cambio de costo (salidas y entradas a costo actual):
 * ventas, ajustes, merma, consumo interno, devoluciones.
 * `signedQty`: positivo entra, negativo sale.
 */
export async function applyMovement(
  tx: Tx,
  tenantId: string,
  input: {
    storeId: string;
    productId: string;
    type: MovementType;
    signedQty: number;
    userId: string;
    refType?: string;
    refId?: string;
    note?: string;
    allowNegative?: boolean;
  },
): Promise<MovementResult> {
  await ensureStoreProduct(tx, tenantId, input.storeId, input.productId);
  const qty = toDecimalString(input.signedQty);
  const allowNegative = input.allowNegative ?? false;

  const rows = await tx.$queryRaw<{ stock_qty: Prisma.Decimal; avg_cost: bigint }[]>`
    UPDATE store_products
    SET stock_qty = stock_qty + ${qty}::numeric, updated_at = now()
    WHERE store_id = ${input.storeId}::uuid
      AND product_id = ${input.productId}::uuid
      AND (${allowNegative} OR stock_qty + ${qty}::numeric >= 0)
    RETURNING stock_qty, avg_cost`;

  const row = rows[0];
  if (!row) {
    throw new AppError(409, 'STOCK_INSUFFICIENT', 'Stock insuficiente para esta operación');
  }
  const balanceAfter = row.stock_qty.toFixed(3);
  const movementId = await insertMovement(tx, {
    tenantId,
    storeId: input.storeId,
    productId: input.productId,
    type: input.type,
    qty,
    unitCost: row.avg_cost,
    balanceAfter,
    userId: input.userId,
    refType: input.refType,
    refId: input.refId,
    note: input.note,
  });
  return { movementId, balanceAfter, unitCost: row.avg_cost };
}

/**
 * Entrada CON costo → recalcula el costo promedio ponderado (D-006):
 *   nuevo_cpp = (stock_actual × cpp_actual + qty × costo) / (stock_actual + qty)
 * Bloquea la fila (FOR UPDATE) para que el cálculo sea consistente bajo
 * concurrencia. Usada por carga inicial (Fase 1) y compras (Fase 3).
 */
export async function applyCostedEntry(
  tx: Tx,
  tenantId: string,
  input: {
    storeId: string;
    productId: string;
    type: Extract<MovementType, 'INITIAL' | 'PURCHASE' | 'ADJUSTMENT_IN'>;
    qty: number; // siempre positiva
    unitCost: bigint;
    userId: string;
    refType?: string;
    refId?: string;
    note?: string;
  },
): Promise<MovementResult> {
  await ensureStoreProduct(tx, tenantId, input.storeId, input.productId);
  const qty = toDecimalString(input.qty);

  const current = await tx.$queryRaw<{ stock_qty: Prisma.Decimal; avg_cost: bigint }[]>`
    SELECT stock_qty, avg_cost FROM store_products
    WHERE store_id = ${input.storeId}::uuid AND product_id = ${input.productId}::uuid
    FOR UPDATE`;
  const row = current[0];
  if (!row) throw new AppError(500, 'INTERNAL', 'store_product no inicializado');

  const prevStock = Number(row.stock_qty);
  const prevCost = Number(row.avg_cost);
  const inQty = Number(qty);
  const inCost = Number(input.unitCost);
  // Si no había stock positivo, el costo entrante define el CPP.
  const newAvg =
    prevStock <= 0
      ? Math.round(inCost)
      : Math.round((prevStock * prevCost + inQty * inCost) / (prevStock + inQty));

  const updated = await tx.$queryRaw<{ stock_qty: Prisma.Decimal }[]>`
    UPDATE store_products
    SET stock_qty = stock_qty + ${qty}::numeric, avg_cost = ${newAvg}, updated_at = now()
    WHERE store_id = ${input.storeId}::uuid AND product_id = ${input.productId}::uuid
    RETURNING stock_qty`;

  const balanceAfter = updated[0]!.stock_qty.toFixed(3);
  const movementId = await insertMovement(tx, {
    tenantId,
    storeId: input.storeId,
    productId: input.productId,
    type: input.type,
    qty,
    unitCost: input.unitCost,
    balanceAfter,
    userId: input.userId,
    refType: input.refType,
    refId: input.refId,
    note: input.note,
  });
  return { movementId, balanceAfter, unitCost: input.unitCost };
}
