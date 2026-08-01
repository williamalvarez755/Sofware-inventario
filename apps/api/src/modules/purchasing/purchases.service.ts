/**
 * Compras (CLAUDE.md §6.3): la recepción actualiza stock y CPP en la misma
 * transacción; la anulación revierte ambos (applyCostedExit deshace la
 * ponderación usando el costo de la compra anulada). Solo fecha actual (D-011).
 */
import { v7 as uuidv7 } from 'uuid';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import type { PurchaseCreateInput } from '@minimarket/shared';
import { AppError, notFound } from '../../lib/errors.js';
import { withTenantTx, type TenantClient } from '../../lib/prisma.js';
import { audit } from '../audit/audit.service.js';
import { applyCostedEntry, applyCostedExit } from '../inventory/movements.service.js';

export function createPurchase(
  tenantId: string,
  userId: string,
  input: PurchaseCreateInput,
  req: Request,
) {
  return withTenantTx(tenantId, async (tx) => {
    const supplier = await tx.supplier.findFirst({
      where: { id: input.supplierId, deletedAt: null, isActive: true },
    });
    if (!supplier) throw notFound('Proveedor no encontrado o inactivo');

    const products = await tx.product.findMany({
      where: { id: { in: input.items.map((i) => i.productId) }, deletedAt: null },
      include: { unit: { select: { allowsDecimals: true } } },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    let total = 0n;
    for (const item of input.items) {
      const product = byId.get(item.productId);
      if (!product) throw notFound('Producto no encontrado');
      if (!product.unit.allowsDecimals && !Number.isInteger(item.qty)) {
        throw new AppError(400, 'VALIDATION', `"${product.name}" no admite cantidades decimales`);
      }
      total += BigInt(Math.round(item.qty * item.unitCost));
    }

    const purchaseId = uuidv7();
    await tx.purchase.create({
      data: {
        id: purchaseId,
        tenantId,
        storeId: input.storeId,
        supplierId: input.supplierId,
        userId,
        supplierInvoice: input.supplierInvoice ?? null,
        notes: input.notes ?? null,
        total,
      },
    });

    for (const item of input.items) {
      await tx.purchaseItem.create({
        data: {
          id: uuidv7(),
          tenantId,
          purchaseId,
          productId: item.productId,
          qty: new Prisma.Decimal(item.qty.toFixed(3)),
          unitCost: BigInt(item.unitCost),
          lineTotal: BigInt(Math.round(item.qty * item.unitCost)),
        },
      });
      // Entrada al kardex con recálculo de CPP
      await applyCostedEntry(tx, tenantId, {
        storeId: input.storeId,
        productId: item.productId,
        type: 'PURCHASE',
        qty: item.qty,
        unitCost: BigInt(item.unitCost),
        userId,
        refType: 'purchase',
        refId: purchaseId,
      });
      // Último costo por proveedor: agiliza la próxima recepción
      await tx.productSupplier.upsert({
        where: {
          productId_supplierId: { productId: item.productId, supplierId: input.supplierId },
        },
        update: { lastCost: BigInt(item.unitCost), lastPurchaseAt: new Date() },
        create: {
          tenantId,
          productId: item.productId,
          supplierId: input.supplierId,
          lastCost: BigInt(item.unitCost),
          lastPurchaseAt: new Date(),
        },
      });
    }

    await audit(tx, {
      tenantId,
      storeId: input.storeId,
      userId,
      action: 'purchase.create',
      entityType: 'purchase',
      entityId: purchaseId,
      after: { supplier: supplier.name, total: total.toString(), items: input.items.length },
    }, req);

    return getPurchaseTx(tx, purchaseId);
  });
}

export function voidPurchase(
  tenantId: string,
  userId: string,
  purchaseId: string,
  reason: string,
  req: Request,
) {
  return withTenantTx(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; store_id: string; status: string }[]>`
      SELECT id, store_id, status FROM purchases WHERE id = ${purchaseId}::uuid FOR UPDATE`;
    const purchase = rows[0];
    if (!purchase) throw notFound('Compra no encontrada');
    if (purchase.status === 'VOIDED') {
      throw new AppError(409, 'ALREADY_VOIDED', 'La compra ya está anulada');
    }

    const items = await tx.purchaseItem.findMany({ where: { purchaseId } });
    for (const item of items) {
      await applyCostedExit(tx, tenantId, {
        storeId: purchase.store_id,
        productId: item.productId,
        type: 'PURCHASE_VOID',
        qty: Number(item.qty),
        unitCost: item.unitCost,
        userId,
        refType: 'purchase',
        refId: purchaseId,
        note: reason,
      });
    }

    const updated = await tx.purchase.update({
      where: { id: purchaseId },
      data: { status: 'VOIDED', voidedAt: new Date(), voidedBy: userId, voidReason: reason },
    });
    await audit(tx, {
      tenantId,
      storeId: purchase.store_id,
      userId,
      action: 'purchase.void',
      entityType: 'purchase',
      entityId: purchaseId,
      before: { status: 'RECEIVED' },
      after: { status: 'VOIDED', reason },
    }, req);
    return updated;
  });
}

async function getPurchaseTx(tx: Prisma.TransactionClient, purchaseId: string) {
  return tx.purchase.findUniqueOrThrow({
    where: { id: purchaseId },
    include: {
      supplier: { select: { id: true, name: true } },
      items: { include: { product: { select: { id: true, name: true, sku: true } } } },
    },
  });
}

export async function getPurchase(db: TenantClient, purchaseId: string) {
  const purchase = await db.purchase.findFirst({
    where: { id: purchaseId },
    include: {
      supplier: { select: { id: true, name: true } },
      items: { include: { product: { select: { id: true, name: true, sku: true } } } },
    },
  });
  if (!purchase) throw notFound('Compra no encontrada');
  return purchase;
}

export async function listPurchases(
  db: TenantClient,
  opts: { storeId: string; supplierId?: string; page: number },
) {
  const PAGE_SIZE = 50;
  const where = {
    storeId: opts.storeId,
    ...(opts.supplierId ? { supplierId: opts.supplierId } : {}),
  };
  const [rows, total] = await Promise.all([
    db.purchase.findMany({
      where,
      orderBy: { purchasedAt: 'desc' },
      skip: (opts.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        supplier: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
    db.purchase.count({ where }),
  ]);
  return { total, page: opts.page, pageSize: PAGE_SIZE, rows };
}
