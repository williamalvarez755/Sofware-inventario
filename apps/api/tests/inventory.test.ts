/**
 * Kardex y stock: balance_after exacto, bloqueo de stock insuficiente,
 * CPP ponderado, CONCURRENCIA (la prueba que protege el dinero) y
 * reconciliación kardex ↔ stock materializado.
 * Requiere BD migrada + seedeada.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { v7 as uuidv7 } from 'uuid';
import { createApp } from '../src/app.js';
import { prismaAdmin, withTenantTx } from '../src/lib/prisma.js';
import { applyCostedEntry, applyMovement } from '../src/modules/inventory/movements.service.js';
import { findStockDiscrepancies } from '../src/modules/inventory/consistency.js';

const app = createApp();
let tenantA: { id: string };
let storeA: { id: string };
let ownerA: { id: string };
let ownerToken: string;
let workerToken: string;
let unidadId: string;

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password: process.env.SEED_DEMO_PASSWORD ?? 'Demo!2026' });
  expect(res.status).toBe(200);
  return res.body.accessToken;
}

/** Producto de prueba aislado, con stock inicial dado. */
async function newTestProduct(stock: number, cost: bigint): Promise<string> {
  const product = await prismaAdmin.product.create({
    data: {
      id: uuidv7(),
      tenantId: tenantA.id,
      sku: `TEST-${uuidv7().slice(-8)}`,
      name: `Producto test ${Date.now()}`,
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

beforeAll(async () => {
  tenantA = await prismaAdmin.tenant.findUniqueOrThrow({ where: { slug: 'tienda-uno' } });
  storeA = await prismaAdmin.store.findFirstOrThrow({
    where: { tenantId: tenantA.id, name: 'Central' },
  });
  ownerA = await prismaAdmin.user.findUniqueOrThrow({ where: { email: 'owner1@demo.local' } });
  unidadId = (await prismaAdmin.unit.findFirstOrThrow({ where: { code: 'UNIDAD' } })).id;
  ownerToken = await login('owner1@demo.local');
  workerToken = await login('worker1@demo.local');
});

describe('Movimientos: balance y bloqueos', () => {
  it('la secuencia entrada→salida deja balance_after correcto en cada paso', async () => {
    const productId = await newTestProduct(10, 500n);
    await withTenantTx(tenantA.id, (tx) =>
      applyMovement(tx, tenantA.id, {
        storeId: storeA.id,
        productId,
        type: 'ADJUSTMENT_OUT',
        signedQty: -3,
        userId: ownerA.id,
        note: 'test',
      }),
    );
    const movements = await prismaAdmin.inventoryMovement.findMany({
      where: { productId },
      orderBy: { createdAt: 'asc' },
    });
    expect(movements.map((m) => m.balanceAfter.toFixed(3))).toEqual(['10.000', '7.000']);
    const sp = await prismaAdmin.storeProduct.findUniqueOrThrow({
      where: { storeId_productId: { storeId: storeA.id, productId } },
    });
    expect(sp.stockQty.toFixed(3)).toBe('7.000');
  });

  it('rechaza salida mayor al stock (STOCK_INSUFFICIENT) sin dejar rastro', async () => {
    const productId = await newTestProduct(5, 500n);
    await expect(
      withTenantTx(tenantA.id, (tx) =>
        applyMovement(tx, tenantA.id, {
          storeId: storeA.id,
          productId,
          type: 'ADJUSTMENT_OUT',
          signedQty: -8,
          userId: ownerA.id,
        }),
      ),
    ).rejects.toMatchObject({ code: 'STOCK_INSUFFICIENT' });
    const count = await prismaAdmin.inventoryMovement.count({
      where: { productId, type: 'ADJUSTMENT_OUT' },
    });
    expect(count).toBe(0);
  });

  it('CPP ponderado: 10 uds a Q5.00 + 10 uds a Q7.00 = Q6.00', async () => {
    const productId = await newTestProduct(10, 500n);
    await withTenantTx(tenantA.id, (tx) =>
      applyCostedEntry(tx, tenantA.id, {
        storeId: storeA.id,
        productId,
        type: 'INITIAL',
        qty: 10,
        unitCost: 700n,
        userId: ownerA.id,
      }),
    );
    const sp = await prismaAdmin.storeProduct.findUniqueOrThrow({
      where: { storeId_productId: { storeId: storeA.id, productId } },
    });
    expect(sp.avgCost).toBe(600n);
    expect(sp.stockQty.toFixed(3)).toBe('20.000');
  });

  it('CONCURRENCIA: 20 salidas paralelas de 1 ud con stock 10 → exactamente 10 éxitos y stock 0', async () => {
    const productId = await newTestProduct(10, 500n);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        withTenantTx(tenantA.id, (tx) =>
          applyMovement(tx, tenantA.id, {
            storeId: storeA.id,
            productId,
            type: 'ADJUSTMENT_OUT',
            signedQty: -1,
            userId: ownerA.id,
          }),
        ),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(10);
    const sp = await prismaAdmin.storeProduct.findUniqueOrThrow({
      where: { storeId_productId: { storeId: storeA.id, productId } },
    });
    expect(sp.stockQty.toFixed(3)).toBe('0.000');
    // Sin discrepancia kardex↔stock después de la tormenta
    const diffs = await findStockDiscrepancies();
    expect(diffs.filter((d) => d.productId === productId)).toHaveLength(0);
  });

  it('el kardex es inmutable a nivel de base de datos', async () => {
    const productId = await newTestProduct(1, 100n);
    const movement = await prismaAdmin.inventoryMovement.findFirstOrThrow({
      where: { productId },
    });
    await expect(
      prismaAdmin.inventoryMovement.update({
        where: { id: movement.id },
        data: { note: 'alterado' },
      }),
    ).rejects.toThrow(/append-only/);
  });
});

describe('API de inventario y RBAC', () => {
  it('un ajuste vía API exige motivo y queda en kardex + auditoría', async () => {
    const productId = await newTestProduct(10, 500n);
    const noReason = await request(app)
      .post('/api/inventory/adjustments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ storeId: storeA.id, productId, type: 'WASTE', qty: 2 });
    expect(noReason.status).toBe(400);

    const res = await request(app)
      .post('/api/inventory/adjustments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ storeId: storeA.id, productId, type: 'WASTE', qty: 2, reason: 'Producto vencido' });
    expect(res.status).toBe(201);
    expect(res.body.balanceAfter).toBe('8.000');

    const auditRow = await prismaAdmin.auditLog.findFirst({
      where: { action: 'inventory.adjust', entityId: productId },
    });
    expect(auditRow).not.toBeNull();
  });

  it('un WORKER no puede ajustar inventario', async () => {
    const productId = await newTestProduct(5, 500n);
    const res = await request(app)
      .post('/api/inventory/adjustments')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ storeId: storeA.id, productId, type: 'ADJUSTMENT_OUT', qty: 1, reason: 'intento' });
    expect(res.status).toBe(403);
  });

  it('el kardex OCULTA costos al WORKER y los muestra al OWNER', async () => {
    const productId = await newTestProduct(5, 500n);
    const asWorker = await request(app)
      .get(`/api/inventory/kardex?storeId=${storeA.id}&productId=${productId}`)
      .set('Authorization', `Bearer ${workerToken}`);
    expect(asWorker.status).toBe(200);
    expect(asWorker.body.rows[0].unitCost).toBeUndefined();

    const asOwner = await request(app)
      .get(`/api/inventory/kardex?storeId=${storeA.id}&productId=${productId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(asOwner.body.rows[0].unitCost).toBe('500');
  });

  it('low-stock lista productos en o bajo el mínimo', async () => {
    const productId = await newTestProduct(3, 500n);
    await prismaAdmin.storeProduct.update({
      where: { storeId_productId: { storeId: storeA.id, productId } },
      data: { minStock: 5 },
    });
    const res = await request(app)
      .get(`/api/inventory/low-stock?storeId=${storeA.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.some((r: { productId: string }) => r.productId === productId)).toBe(true);
  });
});
