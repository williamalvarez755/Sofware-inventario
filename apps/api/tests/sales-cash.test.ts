/**
 * POS y caja: venta transaccional, idempotencia, correlativos bajo
 * concurrencia, anulación compensatoria, retiros con PIN y arqueo al centavo.
 * Requiere BD migrada + seedeada.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { createApp } from '../src/app.js';
import { prismaAdmin, withTenantTx } from '../src/lib/prisma.js';
import { applyCostedEntry } from '../src/modules/inventory/movements.service.js';
import { findStockDiscrepancies } from '../src/modules/inventory/consistency.js';

const app = createApp();
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo!2026';

let tenantA: { id: string };
let storeA: { id: string };
let registerA: { id: string };
let ownerA: { id: string };
let ownerToken: string;
let workerToken: string;
let unidadId: string;

async function login(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.accessToken;
}

async function newProduct(stock: number, cost: bigint, price = 1000n): Promise<string> {
  const product = await prismaAdmin.product.create({
    data: {
      id: uuidv7(),
      tenantId: tenantA.id,
      sku: `POS-${uuidv7().slice(-8)}`,
      name: `POS test ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      unitId: unidadId,
      basePrice: price,
    },
  });
  await withTenantTx(tenantA.id, (tx) =>
    applyCostedEntry(tx, tenantA.id, {
      storeId: storeA.id,
      productId: product.id,
      type: 'INITIAL',
      qty: stock,
      unitCost: cost,
      userId: ownerA.id,
    }),
  );
  return product.id;
}

async function openSession(token: string, openingAmount = 10000): Promise<string> {
  const res = await request(app)
    .post('/api/cash/sessions')
    .set('Authorization', `Bearer ${token}`)
    .send({ cashRegisterId: registerA.id, openingAmount });
  expect(res.status).toBe(201);
  return res.body.id;
}

async function closeSession(token: string, sessionId: string, countedAmount: number) {
  return request(app)
    .post(`/api/cash/sessions/${sessionId}/close`)
    .set('Authorization', `Bearer ${token}`)
    .send({ countedAmount });
}

/** Cierra cualquier sesión abierta de la caja demo para dejar estado limpio. */
async function ensureNoOpenSession(token: string) {
  const current = await request(app)
    .get(`/api/cash/sessions/current?registerId=${registerA.id}`)
    .set('Authorization', `Bearer ${token}`);
  if (current.body?.id) {
    const expected = Number(current.body.expectedSoFar);
    await closeSession(token, current.body.id, expected);
  }
}

function cashSale(sessionId: string, productId: string, qty: number, opts?: {
  clientOpId?: string;
  amount?: number;
  tendered?: number;
  discount?: number;
}) {
  const amount = opts?.amount ?? qty * 1000;
  return {
    storeId: storeA.id,
    cashSessionId: sessionId,
    clientOpId: opts?.clientOpId ?? randomUUID(),
    items: [{ productId, qty }],
    discount: opts?.discount ?? 0,
    payments: [
      { method: 'CASH', amount, ...(opts?.tendered ? { amountTendered: opts.tendered } : {}) },
    ],
  };
}

beforeAll(async () => {
  tenantA = await prismaAdmin.tenant.findUniqueOrThrow({ where: { slug: 'tienda-uno' } });
  storeA = await prismaAdmin.store.findFirstOrThrow({ where: { tenantId: tenantA.id } });
  registerA = await prismaAdmin.cashRegister.findFirstOrThrow({
    where: { storeId: storeA.id },
  });
  ownerA = await prismaAdmin.user.findUniqueOrThrow({ where: { email: 'owner1@demo.local' } });
  unidadId = (await prismaAdmin.unit.findFirstOrThrow({ where: { code: 'UNIDAD' } })).id;
  ownerToken = await login('owner1@demo.local');
  workerToken = await login('worker1@demo.local');
  await ensureNoOpenSession(ownerToken);
});

describe('Venta transaccional', () => {
  it('venta feliz: correlativo, stock, costo congelado, caja y cambio', async () => {
    const sessionId = await openSession(ownerToken, 5000);
    const productId = await newProduct(10, 600n, 1250n);

    const res = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(cashSale(sessionId, productId, 2, { amount: 2500, tendered: 5000 }));
    expect(res.status).toBe(201);
    expect(res.body.change).toBe('2500');
    expect(res.body.receipt.total).toBe('2500');

    // Stock decrementado y kardex con referencia a la venta
    const sp = await prismaAdmin.storeProduct.findUniqueOrThrow({
      where: { storeId_productId: { storeId: storeA.id, productId } },
    });
    expect(sp.stockQty.toFixed(3)).toBe('8.000');

    // Costo congelado en la línea
    const item = await prismaAdmin.saleItem.findFirstOrThrow({
      where: { saleId: res.body.saleId },
    });
    expect(item.unitCostAtSale).toBe(600n);
    expect(item.unitPrice).toBe(1250n);

    // Efectivo en caja (SALE_IN por el monto, no por lo recibido)
    const cashIn = await prismaAdmin.cashMovement.findFirstOrThrow({
      where: { refId: res.body.saleId, type: 'SALE_IN' },
    });
    expect(cashIn.amount).toBe(2500n);

    await closeSession(ownerToken, sessionId, 5000 + 2500);
  });

  it('idempotencia: el mismo client_op_id no duplica la venta ni el stock', async () => {
    const sessionId = await openSession(ownerToken, 0);
    const productId = await newProduct(10, 500n);
    const clientOpId = randomUUID();
    const payload = cashSale(sessionId, productId, 1, { clientOpId });

    const first = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(payload);
    const second = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(payload);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.saleId).toBe(first.body.saleId);
    expect(second.body.idempotent).toBe(true);

    const sp = await prismaAdmin.storeProduct.findUniqueOrThrow({
      where: { storeId_productId: { storeId: storeA.id, productId } },
    });
    expect(sp.stockQty.toFixed(3)).toBe('9.000');
    await closeSession(ownerToken, sessionId, 1000);
  });

  it('rechaza venta sin sesión abierta y con pagos que no cuadran; nada persiste', async () => {
    const sessionId = await openSession(ownerToken, 0);
    const productId = await newProduct(5, 500n);

    const badPayment = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(cashSale(sessionId, productId, 1, { amount: 999 }));
    expect(badPayment.status).toBe(400);
    expect(badPayment.body.error.code).toBe('PAYMENT_MISMATCH');

    const noStock = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(cashSale(sessionId, productId, 50, { amount: 50000 }));
    expect(noStock.status).toBe(409);
    expect(noStock.body.error.code).toBe('STOCK_INSUFFICIENT');

    await closeSession(ownerToken, sessionId, 0);
    const closed = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(cashSale(sessionId, productId, 1));
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('SESSION_CLOSED');

    const sp = await prismaAdmin.storeProduct.findUniqueOrThrow({
      where: { storeId_productId: { storeId: storeA.id, productId } },
    });
    expect(sp.stockQty.toFixed(3)).toBe('5.000');
  });

  it('CONCURRENCIA: 10 ventas paralelas → 10 correlativos únicos y stock exacto', async () => {
    const sessionId = await openSession(ownerToken, 0);
    const productId = await newProduct(20, 500n);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/sales')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send(cashSale(sessionId, productId, 1)),
      ),
    );
    for (const r of results) expect(r.status).toBe(201);
    const numbers = new Set(results.map((r) => r.body.receipt.number));
    expect(numbers.size).toBe(10);

    const sp = await prismaAdmin.storeProduct.findUniqueOrThrow({
      where: { storeId_productId: { storeId: storeA.id, productId } },
    });
    expect(sp.stockQty.toFixed(3)).toBe('10.000');
    expect(await findStockDiscrepancies()).toHaveLength(0);
    await closeSession(ownerToken, sessionId, 10000);
  });
});

describe('Anulación', () => {
  it('repone stock, devuelve efectivo, audita y es única', async () => {
    const sessionId = await openSession(ownerToken, 0);
    const productId = await newProduct(10, 500n);
    const sale = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(cashSale(sessionId, productId, 3, { amount: 3000 }));

    const voided = await request(app)
      .post(`/api/sales/${sale.body.saleId}/void`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'Cliente se arrepintió' });
    expect(voided.status).toBe(200);
    expect(voided.body.status).toBe('VOIDED');

    const sp = await prismaAdmin.storeProduct.findUniqueOrThrow({
      where: { storeId_productId: { storeId: storeA.id, productId } },
    });
    expect(sp.stockQty.toFixed(3)).toBe('10.000'); // repuesto

    const voidOut = await prismaAdmin.cashMovement.findFirstOrThrow({
      where: { refId: sale.body.saleId, type: 'SALE_VOID_OUT' },
    });
    expect(voidOut.amount).toBe(-3000n);

    const again = await request(app)
      .post(`/api/sales/${sale.body.saleId}/void`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'doble' });
    expect(again.status).toBe(409);

    // El arqueo cuadra: apertura 0 + venta 3000 − devolución 3000 = 0
    const close = await closeSession(ownerToken, sessionId, 0);
    expect(close.body.expectedAmount).toBe('0');
    expect(close.body.difference).toBe('0');
  });

  it('trabajador: sin PIN 403; con PIN de supervisor procede y registra autorizante', async () => {
    const sessionId = await openSession(workerToken, 0);
    const productId = await newProduct(5, 500n);
    const sale = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${workerToken}`)
      .send(cashSale(sessionId, productId, 1));

    const denied = await request(app)
      .post(`/api/sales/${sale.body.saleId}/void`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ reason: 'sin autorización' });
    expect(denied.status).toBe(403);

    const approved = await request(app)
      .post(`/api/sales/${sale.body.saleId}/void`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({
        reason: 'Cobro equivocado',
        authorizerEmail: 'owner1@demo.local',
        authorizerPin: '1234',
      });
    expect(approved.status).toBe(200);
    expect(approved.body.voidAuthorizedBy).toBe(ownerA.id);
    await closeSession(workerToken, sessionId, 0);
  });
});

describe('Caja', () => {
  it('doble apertura de la misma caja → 409', async () => {
    const sessionId = await openSession(ownerToken, 1000);
    const again = await request(app)
      .post('/api/cash/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ cashRegisterId: registerA.id, openingAmount: 500 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SESSION_ALREADY_OPEN');
    await closeSession(ownerToken, sessionId, 1000);
  });

  it('retiro de trabajador exige PIN; monto mayor al efectivo → 409; arqueo exacto', async () => {
    const sessionId = await openSession(workerToken, 10000);

    const noPin = await request(app)
      .post(`/api/cash/sessions/${sessionId}/withdrawals`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ amount: 2000, reason: 'Pago proveedor' });
    expect(noPin.status).toBe(403);

    const tooMuch = await request(app)
      .post(`/api/cash/sessions/${sessionId}/withdrawals`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({
        amount: 999999,
        reason: 'Excesivo',
        authorizerEmail: 'owner1@demo.local',
        authorizerPin: '1234',
      });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_CASH');

    const ok = await request(app)
      .post(`/api/cash/sessions/${sessionId}/withdrawals`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({
        amount: 2000,
        reason: 'Pago proveedor',
        authorizerEmail: 'owner1@demo.local',
        authorizerPin: '1234',
      });
    expect(ok.status).toBe(201);
    expect(ok.body.expectedAmount).toBe('8000');

    const movement = await prismaAdmin.cashMovement.findFirstOrThrow({
      where: { cashSessionId: sessionId, type: 'WITHDRAWAL' },
    });
    expect(movement.authorizedBy).toBe(ownerA.id);
    expect(movement.amount).toBe(-2000n);

    // Cierre con faltante de Q5.00: difference = contado − esperado
    const close = await closeSession(workerToken, sessionId, 7500);
    expect(close.status).toBe(200);
    expect(close.body.expectedAmount).toBe('8000');
    expect(close.body.difference).toBe('-500');

    const again = await closeSession(workerToken, sessionId, 7500);
    expect(again.status).toBe(409);
  });

  it('el ledger de caja es inmutable a nivel BD', async () => {
    const movement = await prismaAdmin.cashMovement.findFirstOrThrow({});
    await expect(
      prismaAdmin.cashMovement.update({
        where: { id: movement.id },
        data: { reason: 'alterado' },
      }),
    ).rejects.toThrow(/append-only/);
  });

  it('las ventas completadas no admiten UPDATE arbitrario ni DELETE (trigger)', async () => {
    const sale = await prismaAdmin.sale.findFirstOrThrow({ where: { status: 'COMPLETED' } });
    await expect(
      prismaAdmin.sale.update({ where: { id: sale.id }, data: { total: 1n } }),
    ).rejects.toThrow();
    await expect(prismaAdmin.sale.delete({ where: { id: sale.id } })).rejects.toThrow();
  });
});
