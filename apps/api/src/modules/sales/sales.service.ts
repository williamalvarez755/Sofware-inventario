/**
 * Venta transaccional (CLAUDE.md §6.1) — TODO ocurre en UNA transacción:
 * correlativo → venta → líneas (stock atómico + costo congelado) → pagos →
 * efectivo a caja → auditoría. Cualquier fallo revierte todo.
 * Idempotencia: client_op_id único por tenant — un reintento de red devuelve
 * la venta ya creada en lugar de duplicarla.
 */
import { v7 as uuidv7 } from 'uuid';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import {
  roleHasPermission,
  type Role,
  type SaleCreateInput,
  type VoidSaleInput,
} from '@minimarket/shared';
import { AppError, notFound } from '../../lib/errors.js';
import { prismaRuntime, withTenantTx, type TenantClient } from '../../lib/prisma.js';
import { assertStoreAccess, type MembershipLike } from '../../lib/store-access.js';
import { audit } from '../audit/audit.service.js';
import { verifyAuthorizer } from '../auth/pin.service.js';
import { applyMovement } from '../inventory/movements.service.js';
import { insertCashMovement, lockOpenSession } from '../cash/cash.service.js';

function taxBreakdownFor(regime: string, total: bigint): bigint {
  // Informativo (precios con IVA incluido, CLAUDE.md A2)
  if (regime === 'GENERAL') return (total * 12n) / 112n;
  if (regime === 'PEQUENO_CONTRIBUYENTE') return (total * 5n) / 105n;
  return 0n;
}

async function nextSaleNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  storeId: string,
): Promise<bigint> {
  const rows = await tx.$queryRaw<{ current_value: bigint }[]>`
    INSERT INTO counters (tenant_id, store_id, doc_type, current_value)
    VALUES (${tenantId}::uuid, ${storeId}::uuid, 'SALE', 1)
    ON CONFLICT (store_id, doc_type)
    DO UPDATE SET current_value = counters.current_value + 1
    RETURNING current_value`;
  return rows[0]!.current_value;
}

export async function createSale(
  tenantId: string,
  userId: string,
  input: SaleCreateInput,
  req: Request,
) {
  try {
    return await withTenantTx(tenantId, async (tx) => {
      // Idempotencia: si este client_op_id ya se procesó, devolver lo existente.
      const existing = await tx.sale.findUnique({
        where: { tenantId_clientOpId: { tenantId, clientOpId: input.clientOpId } },
        select: { id: true },
      });
      if (existing) return { saleId: existing.id, idempotent: true as const };

      const session = await lockOpenSession(tx, input.cashSessionId);
      if (session.storeId !== input.storeId) {
        throw new AppError(409, 'SESSION_STORE_MISMATCH', 'La sesión de caja es de otra tienda');
      }

      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { taxRegime: true, settings: true },
      });
      const allowNegative =
        typeof tenant.settings === 'object' &&
        tenant.settings !== null &&
        (tenant.settings as Record<string, unknown>).allow_negative_stock === true;

      const productIds = input.items.map((i) => i.productId);
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, deletedAt: null, isActive: true },
        include: {
          unit: { select: { allowsDecimals: true } },
          storeProducts: { where: { storeId: input.storeId } },
        },
      });
      const byId = new Map(products.map((p) => [p.id, p]));

      // Totales
      let subtotal = 0n;
      const lines = input.items.map((item) => {
        const product = byId.get(item.productId);
        if (!product) throw notFound('Producto no encontrado o inactivo');
        if (!product.unit.allowsDecimals && !Number.isInteger(item.qty)) {
          throw new AppError(400, 'VALIDATION', `"${product.name}" no admite cantidades decimales`);
        }
        const unitPrice = product.storeProducts[0]?.priceOverride ?? product.basePrice;
        const lineTotal = BigInt(Math.round(item.qty * Number(unitPrice)));
        subtotal += lineTotal;
        return { product, qty: item.qty, unitPrice, lineTotal };
      });
      const discount = BigInt(input.discount);
      if (discount > subtotal) {
        throw new AppError(400, 'VALIDATION', 'El descuento no puede exceder el subtotal');
      }
      const total = subtotal - discount;

      // Pagos: deben cuadrar exactamente con el total
      const paymentsSum = input.payments.reduce((acc, p) => acc + BigInt(p.amount), 0n);
      if (paymentsSum !== total) {
        throw new AppError(400, 'PAYMENT_MISMATCH', 'La suma de pagos no coincide con el total');
      }
      let change = 0n;
      for (const p of input.payments) {
        if (p.method === 'CASH' && p.amountTendered !== undefined) {
          if (BigInt(p.amountTendered) < BigInt(p.amount)) {
            throw new AppError(400, 'VALIDATION', 'El efectivo recibido es menor al monto');
          }
          change += BigInt(p.amountTendered) - BigInt(p.amount);
        }
        if (p.method !== 'CASH' && p.amountTendered !== undefined) {
          throw new AppError(400, 'VALIDATION', 'amountTendered solo aplica a efectivo');
        }
      }

      const number = await nextSaleNumber(tx, tenantId, input.storeId);
      const saleId = uuidv7();
      await tx.sale.create({
        data: {
          id: saleId,
          tenantId,
          storeId: input.storeId,
          cashSessionId: input.cashSessionId,
          userId,
          number,
          subtotal,
          discount,
          total,
          taxBreakdown: taxBreakdownFor(tenant.taxRegime, total),
          clientOpId: input.clientOpId,
        },
      });

      for (const line of lines) {
        const movement = await applyMovement(tx, tenantId, {
          storeId: input.storeId,
          productId: line.product.id,
          type: 'SALE',
          signedQty: -line.qty,
          userId,
          refType: 'sale',
          refId: saleId,
          allowNegative,
        });
        await tx.saleItem.create({
          data: {
            id: uuidv7(),
            tenantId,
            saleId,
            productId: line.product.id,
            qty: new Prisma.Decimal(line.qty.toFixed(3)),
            unitPrice: line.unitPrice,
            unitCostAtSale: movement.unitCost, // CPP congelado (D-006)
            lineTotal: line.lineTotal,
          },
        });
      }

      for (const p of input.payments) {
        await tx.salePayment.create({
          data: {
            id: uuidv7(),
            tenantId,
            saleId,
            method: p.method,
            amount: BigInt(p.amount),
            amountTendered: p.amountTendered !== undefined ? BigInt(p.amountTendered) : null,
            reference: p.reference ?? null,
          },
        });
      }

      const cashIn = input.payments
        .filter((p) => p.method === 'CASH')
        .reduce((acc, p) => acc + BigInt(p.amount), 0n);
      if (cashIn > 0n) {
        await insertCashMovement(tx, {
          tenantId,
          storeId: input.storeId,
          cashSessionId: input.cashSessionId,
          type: 'SALE_IN',
          amount: cashIn,
          userId,
          refType: 'sale',
          refId: saleId,
        });
      }

      await audit(tx, {
        tenantId,
        storeId: input.storeId,
        userId,
        action: 'sale.create',
        entityType: 'sale',
        entityId: saleId,
        after: { number: number.toString(), total: total.toString() },
      }, req);

      return { saleId, idempotent: false as const, change: change.toString() };
    });
  } catch (e) {
    // Carrera de doble submit: otro request ganó el client_op_id → devolver el suyo.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002' &&
      (e.meta?.target as string[] | undefined)?.includes('client_op_id')
    ) {
      const sale = await prismaRuntime.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
        return tx.sale.findUniqueOrThrow({
          where: { tenantId_clientOpId: { tenantId, clientOpId: input.clientOpId } },
          select: { id: true },
        });
      });
      return { saleId: sale.id, idempotent: true as const };
    }
    throw e;
  }
}

export function voidSale(
  tenantId: string,
  userId: string,
  saleId: string,
  input: VoidSaleInput,
  memberships: MembershipLike[],
  req: Request,
) {
  return withTenantTx(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string; store_id: string; status: string; cash_session_id: string }[]
    >`SELECT id, store_id, status, cash_session_id FROM sales WHERE id = ${saleId}::uuid FOR UPDATE`;
    const sale = rows[0];
    if (!sale) throw notFound('Venta no encontrada');
    if (sale.status === 'VOIDED') {
      throw new AppError(409, 'ALREADY_VOIDED', 'La venta ya está anulada');
    }
    // Quien anula debe pertenecer a la tienda de la venta: el PIN del
    // supervisor autoriza la operación, pero no habilita a operar en una
    // sucursal ajena.
    assertStoreAccess(memberships, sale.store_id);

    const selfAuthorized = memberships.some(
      (m) =>
        (m.role === 'OWNER' || m.storeId === sale.store_id) &&
        roleHasPermission(m.role as Role, 'sales.void'),
    );
    const authorizedBy = selfAuthorized
      ? userId
      : await verifyAuthorizer(tx, {
          email: input.authorizerEmail,
          pin: input.authorizerPin,
          storeId: sale.store_id,
          permission: 'sales.void',
        });

    // Reposición de inventario (movimientos compensatorios)
    const items = await tx.saleItem.findMany({ where: { saleId } });
    for (const item of items) {
      await applyMovement(tx, tenantId, {
        storeId: sale.store_id,
        productId: item.productId,
        type: 'SALE_VOID',
        signedQty: Number(item.qty),
        userId,
        refType: 'sale',
        refId: saleId,
        note: input.reason,
      });
    }

    // Devolución del efectivo: sesión original si sigue abierta; si no, la
    // sesión abierta actual de la tienda (CLAUDE.md A7). Sin caja abierta → error.
    const payments = await tx.salePayment.findMany({ where: { saleId } });
    const cashPaid = payments
      .filter((p) => p.method === 'CASH')
      .reduce((acc, p) => acc + p.amount, 0n);
    if (cashPaid > 0n) {
      const openRows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM cash_sessions
        WHERE store_id = ${sale.store_id}::uuid AND status = 'OPEN'
        ORDER BY (id = ${sale.cash_session_id}::uuid) DESC, opened_at DESC
        LIMIT 1 FOR SHARE`;
      const openSession = openRows[0];
      if (!openSession) {
        throw new AppError(
          409,
          'NO_OPEN_SESSION',
          'Abra una caja para registrar la devolución del efectivo',
        );
      }
      await insertCashMovement(tx, {
        tenantId,
        storeId: sale.store_id,
        cashSessionId: openSession.id,
        type: 'SALE_VOID_OUT',
        amount: -cashPaid,
        userId,
        reason: input.reason,
        refType: 'sale',
        refId: saleId,
        authorizedBy,
      });
    }

    const updated = await tx.sale.update({
      where: { id: saleId },
      data: {
        status: 'VOIDED',
        voidedAt: new Date(),
        voidedBy: userId,
        voidReason: input.reason,
        voidAuthorizedBy: authorizedBy,
      },
    });
    await audit(tx, {
      tenantId,
      storeId: sale.store_id,
      userId,
      action: 'sale.void',
      entityType: 'sale',
      entityId: saleId,
      before: { status: 'COMPLETED' },
      after: { status: 'VOIDED', reason: input.reason, authorizedBy },
    }, req);
    return updated;
  });
}

export async function listSales(
  db: TenantClient,
  opts: { storeId: string; sessionId?: string; page: number },
) {
  const PAGE_SIZE = 50;
  const where = {
    storeId: opts.storeId,
    ...(opts.sessionId ? { cashSessionId: opts.sessionId } : {}),
  };
  const [rows, total] = await Promise.all([
    db.sale.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (opts.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { payments: { select: { method: true, amount: true } } },
    }),
    db.sale.count({ where }),
  ]);
  return { total, page: opts.page, pageSize: PAGE_SIZE, rows };
}

/** Datos completos para el comprobante (impresión y reimpresión). */
export async function getReceipt(db: TenantClient, saleId: string) {
  const sale = await db.sale.findFirst({
    where: { id: saleId },
    include: {
      items: { include: { product: { select: { name: true } } } },
      payments: true,
    },
  });
  if (!sale) throw notFound('Venta no encontrada');
  const [store, tenant, cashier] = await Promise.all([
    db.store.findFirst({
      where: { id: sale.storeId },
      select: { name: true, address: true, phone: true, receiptHeader: true, receiptFooter: true },
    }),
    db.tenant.findFirst({ select: { name: true } }),
    db.user.findFirst({ where: { id: sale.userId }, select: { name: true } }),
  ]);
  return {
    id: sale.id,
    number: sale.number,
    status: sale.status,
    createdAt: sale.createdAt,
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    taxBreakdown: sale.taxBreakdown,
    items: sale.items.map((i) => ({
      name: i.product.name,
      qty: i.qty,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
    })),
    payments: sale.payments.map((p) => ({
      method: p.method,
      amount: p.amount,
      amountTendered: p.amountTendered,
    })),
    store,
    business: tenant?.name,
    cashier: cashier?.name,
  };
}
