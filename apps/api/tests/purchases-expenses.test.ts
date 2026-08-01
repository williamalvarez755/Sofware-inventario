/**
 * Compras y gastos: CPP contra casos calculados a mano, anulación con reversa
 * de costo, compra de 50 líneas < 5 s, permisos y gastos desde caja que
 * impactan el arqueo. Requiere BD migrada + seedeada.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { createApp } from '../src/app.js';
import { prismaAdmin, withTenantTx } from '../src/lib/prisma.js';
import { applyCostedEntry } from '../src/modules/inventory/movements.service.js';
import { findStockDiscrepancies } from '../src/modules/inventory/consistency.js';

const app = createApp();
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo!2026';

let tenantA: { id: string };
let storeA: { id: string };
let ownerA: { id: string };
let supplierA: { id: string };
let registerA: { id: string };
let ownerToken: string;
let workerToken: string;
let unidadId: string;

async function login(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.accessToken;
}

async function newProduct(stock: number, cost: bigint): Promise<string> {
  const product = await prismaAdmin.product.create({
    data: {
      id: uuidv7(),
      tenantId: tenantA.id,
      sku: `PUR-${uuidv7().slice(-8)}`,
      name: `Compra test ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      unitId: unidadId,
      basePrice: 1000n,
    },
  });
  if (stock > 0) {
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
  }
  return product.id;
}

async function storeProductOf(productId: string) {
  return prismaAdmin.storeProduct.findUniqueOrThrow({
    where: { storeId_productId: { storeId: storeA.id, productId } },
  });
}

beforeAll(async () => {
  tenantA = await prismaAdmin.tenant.findUniqueOrThrow({ where: { slug: 'tienda-uno' } });
  storeA = await prismaAdmin.store.findFirstOrThrow({ where: { tenantId: tenantA.id } });
  ownerA = await prismaAdmin.user.findUniqueOrThrow({ where: { email: 'owner1@demo.local' } });
  supplierA = await prismaAdmin.supplier.findFirstOrThrow({ where: { tenantId: tenantA.id } });
  registerA = await prismaAdmin.cashRegister.findFirstOrThrow({ where: { storeId: storeA.id } });
  unidadId = (await prismaAdmin.unit.findFirstOrThrow({ where: { code: 'UNIDAD' } })).id;
  ownerToken = await login('owner1@demo.local');
  workerToken = await login('worker1@demo.local');
});

describe('Compras y CPP', () => {
  it('CPP a mano: 10@Q5.00 + compra 10@Q7.00 → Q6.00; + 30@Q8.00 → Q7.20', async () => {
    const productId = await newProduct(10, 500n);

    const first = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        storeId: storeA.id,
        supplierId: supplierA.id,
        supplierInvoice: 'F-001',
        items: [{ productId, qty: 10, unitCost: 700 }],
      });
    expect(first.status).toBe(201);
    expect(first.body.total).toBe('7000');

    let sp = await storeProductOf(productId);
    expect(sp.avgCost).toBe(600n); // (10×500 + 10×700) / 20
    expect(sp.stockQty.toFixed(3)).toBe('20.000');

    const second = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        storeId: storeA.id,
        supplierId: supplierA.id,
        items: [{ productId, qty: 30, unitCost: 800 }],
      });
    expect(second.status).toBe(201);

    sp = await storeProductOf(productId);
    expect(sp.avgCost).toBe(720n); // (20×600 + 30×800) / 50
    expect(sp.stockQty.toFixed(3)).toBe('50.000');

    // Kardex con referencia a la compra y último costo del proveedor
    const movement = await prismaAdmin.inventoryMovement.findFirstOrThrow({
      where: { productId, type: 'PURCHASE', refId: first.body.id },
    });
    expect(movement.unitCost).toBe(700n);
    const link = await prismaAdmin.productSupplier.findUniqueOrThrow({
      where: { productId_supplierId: { productId, supplierId: supplierA.id } },
    });
    expect(link.lastCost).toBe(800n);
  });

  it('anulación revierte stock y CPP al valor previo exacto', async () => {
    const productId = await newProduct(10, 500n); // CPP 500
    const purchase = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        storeId: storeA.id,
        supplierId: supplierA.id,
        items: [{ productId, qty: 10, unitCost: 700 }],
      });
    expect((await storeProductOf(productId)).avgCost).toBe(600n);

    const voided = await request(app)
      .post(`/api/purchases/${purchase.body.id}/void`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'Factura equivocada' });
    expect(voided.status).toBe(200);
    expect(voided.body.status).toBe('VOIDED');

    const sp = await storeProductOf(productId);
    expect(sp.stockQty.toFixed(3)).toBe('10.000');
    expect(sp.avgCost).toBe(500n); // reversa exacta: (20×600 − 10×700) / 10

    const again = await request(app)
      .post(`/api/purchases/${purchase.body.id}/void`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'doble' });
    expect(again.status).toBe(409);
    expect(await findStockDiscrepancies()).toHaveLength(0);
  });

  it('no se puede anular si parte de la mercadería ya salió', async () => {
    const productId = await newProduct(0, 0n);
    const purchase = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        storeId: storeA.id,
        supplierId: supplierA.id,
        items: [{ productId, qty: 5, unitCost: 400 }],
      });
    // Sale mercadería (merma de 2): quedan 3 < 5
    await request(app)
      .post('/api/inventory/adjustments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ storeId: storeA.id, productId, type: 'WASTE', qty: 2, reason: 'dañado' });

    const res = await request(app)
      .post(`/api/purchases/${purchase.body.id}/void`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'intento inválido' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STOCK_INSUFFICIENT');

    // La compra sigue RECEIVED y el stock intacto
    const sp = await storeProductOf(productId);
    expect(sp.stockQty.toFixed(3)).toBe('3.000');
  });

  it('un WORKER no puede ver ni registrar compras', async () => {
    const list = await request(app)
      .get(`/api/purchases?storeId=${storeA.id}`)
      .set('Authorization', `Bearer ${workerToken}`);
    expect(list.status).toBe(403);
  });

  it('compra de 50 líneas en menos de 5 s (criterio Fase 3)', async () => {
    const items = [];
    for (let i = 0; i < 50; i++) {
      items.push({ productId: await newProduct(0, 0n), qty: 10, unitCost: 500 + i });
    }
    const startedAt = Date.now();
    const res = await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ storeId: storeA.id, supplierId: supplierA.id, items });
    const elapsed = Date.now() - startedAt;
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(50);
    expect(elapsed).toBeLessThan(5000);
  }, 20_000);
});

describe('Gastos', () => {
  async function categoryId(): Promise<string> {
    const category = await prismaAdmin.expenseCategory.findFirstOrThrow({
      where: { tenantId: tenantA.id, deletedAt: null },
    });
    return category.id;
  }

  it('gasto sin caja: se registra y audita; trabajador puede con justificación', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({
        storeId: storeA.id,
        categoryId: await categoryId(),
        amount: 2500,
        description: 'Bolsas para despacho',
      });
    expect(res.status).toBe(201);
    const log = await prismaAdmin.auditLog.findFirst({
      where: { action: 'expense.create', entityId: res.body.id },
    });
    expect(log).not.toBeNull();
  });

  it('gasto desde caja: EXPENSE_OUT impacta el arqueo; sin fondos → 409; DELETE bloqueado', async () => {
    // Cerrar cualquier sesión previa de la caja demo
    const open = await prismaAdmin.cashSession.findFirst({
      where: { cashRegisterId: registerA.id, status: 'OPEN' },
    });
    if (open) {
      await request(app)
        .post(`/api/cash/sessions/${open.id}/close`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ countedAmount: 0 });
    }
    const session = await request(app)
      .post('/api/cash/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ cashRegisterId: registerA.id, openingAmount: 10000 });
    const sessionId = session.body.id as string;

    const tooMuch = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        storeId: storeA.id,
        categoryId: await categoryId(),
        amount: 99999,
        description: 'Gasto imposible',
        cashSessionId: sessionId,
      });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_CASH');

    const ok = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        storeId: storeA.id,
        categoryId: await categoryId(),
        amount: 3000,
        description: 'Pago de agua purificada',
        cashSessionId: sessionId,
      });
    expect(ok.status).toBe(201);

    const movement = await prismaAdmin.cashMovement.findFirstOrThrow({
      where: { refId: ok.body.id, type: 'EXPENSE_OUT' },
    });
    expect(movement.amount).toBe(-3000n);

    // Arqueo: 10000 − 3000 = 7000
    const close = await request(app)
      .post(`/api/cash/sessions/${sessionId}/close`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ countedAmount: 7000 });
    expect(close.body.expectedAmount).toBe('7000');
    expect(close.body.difference).toBe('0');

    // DELETE bloqueado por trigger
    await expect(prismaAdmin.expense.delete({ where: { id: ok.body.id } })).rejects.toThrow();
  });

  it('editar gasto: solo categoría/descripción, con auditoría; trabajador no puede', async () => {
    const created = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        storeId: storeA.id,
        categoryId: await categoryId(),
        amount: 1000,
        description: 'Descripción original',
      });
    const denied = await request(app)
      .patch(`/api/expenses/${created.body.id}`)
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ description: 'Trabajador editando' });
    expect(denied.status).toBe(403);

    const updated = await request(app)
      .patch(`/api/expenses/${created.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ description: 'Descripción corregida' });
    expect(updated.status).toBe(200);
    expect(updated.body.amount).toBe('1000'); // monto intacto
    const log = await prismaAdmin.auditLog.findFirst({
      where: { action: 'expense.update', entityId: created.body.id },
    });
    expect(log).not.toBeNull();
  });
});
