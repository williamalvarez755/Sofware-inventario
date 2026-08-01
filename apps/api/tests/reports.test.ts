/**
 * Reportes y alertas. Lo que realmente se prueba aquí:
 *  - RECONCILIACIÓN: las cifras de cada reporte cuadran contra los ledgers
 *    (sale_items, cash_movements, expenses) y contra valores calculados a mano.
 *  - Coherencia entre vistas: agrupar por día, usuario o categoría da el mismo
 *    total; el dashboard coincide con el resumen financiero.
 *  - Aislamiento y permisos: un tenant no puede reportar sobre otro; un
 *    trabajador nunca recibe costos ni utilidades.
 *  - Alertas de stock: episodio único, notificación al abrir, cierre solo.
 *
 * Escenario controlado: se crea una tienda propia para estos tests, así los
 * datos acumulados de otras suites no contaminan los totales.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { createApp } from '../src/app.js';
import { prismaAdmin, withTenantTx } from '../src/lib/prisma.js';
import { applyCostedEntry } from '../src/modules/inventory/movements.service.js';

const app = createApp();
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo!2026';
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' });

let tenantA: { id: string };
let storeId: string;
let registerId: string;
let sessionId: string;
let ownerId: string;
let ownerToken: string;
let workerToken: string;
let unidadId: string;
let productA: string; // vendido: 10 uds a Q12.00, costo Q7.00
let productB: string; // vendido: 5 uds a Q20.00, costo Q15.00

async function login(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.accessToken;
}

async function newProduct(name: string, price: bigint, cost: bigint, stock: number, categoryName?: string) {
  const category = categoryName
    ? await prismaAdmin.category.upsert({
        where: { tenantId_name: { tenantId: tenantA.id, name: categoryName } },
        update: {},
        create: { id: uuidv7(), tenantId: tenantA.id, name: categoryName },
      })
    : null;
  const product = await prismaAdmin.product.create({
    data: {
      id: uuidv7(),
      tenantId: tenantA.id,
      sku: `RPT-${uuidv7().slice(-8)}`,
      name,
      unitId: unidadId,
      basePrice: price,
      categoryId: category?.id ?? null,
    },
  });
  await withTenantTx(tenantA.id, (tx) =>
    applyCostedEntry(tx, tenantA.id, {
      storeId,
      productId: product.id,
      type: 'INITIAL',
      qty: stock,
      unitCost: cost,
      userId: ownerId,
    }),
  );
  return product.id;
}

async function sell(productId: string, qty: number, unitPrice: number, token = ownerToken) {
  const amount = qty * unitPrice;
  const res = await request(app)
    .post('/api/sales')
    .set('Authorization', `Bearer ${token}`)
    .send({
      storeId,
      cashSessionId: sessionId,
      clientOpId: randomUUID(),
      items: [{ productId, qty }],
      discount: 0,
      payments: [{ method: 'CASH', amount }],
    });
  expect(res.status).toBe(201);
  return res.body.saleId as string;
}

function report(path: string, token = ownerToken) {
  return request(app)
    .get(`/api/reports/${path}${path.includes('?') ? '&' : '?'}from=${TODAY}&to=${TODAY}&storeId=${storeId}`)
    .set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  tenantA = await prismaAdmin.tenant.findUniqueOrThrow({ where: { slug: 'tienda-uno' } });
  ownerId = (await prismaAdmin.user.findUniqueOrThrow({ where: { email: 'owner1@demo.local' } })).id;
  unidadId = (await prismaAdmin.unit.findFirstOrThrow({ where: { code: 'UNIDAD' } })).id;
  ownerToken = await login('owner1@demo.local');
  workerToken = await login('worker1@demo.local');

  // Tienda dedicada + caja para aislar las cifras de este archivo.
  const storeName = `Reportes ${Date.now()}`;
  const store = await request(app)
    .post('/api/stores')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: storeName });
  expect(store.status).toBe(201);
  storeId = store.body.id;

  // El trabajador también opera en esta tienda (para probar ocultamiento de costos).
  const workerId = (await prismaAdmin.user.findUniqueOrThrow({
    where: { email: 'worker1@demo.local' },
  })).id;
  await prismaAdmin.storeMember.create({
    data: { id: uuidv7(), tenantId: tenantA.id, storeId, userId: workerId, role: 'WORKER' },
  });
  workerToken = await login('worker1@demo.local'); // refresca membresías

  const register = await request(app)
    .post('/api/cash/registers')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ storeId, name: 'Caja Reportes' });
  expect(register.status).toBe(201);
  registerId = register.body.id;

  const session = await request(app)
    .post('/api/cash/sessions')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ cashRegisterId: registerId, openingAmount: 20000 }); // Q200.00
  expect(session.status).toBe(201);
  sessionId = session.body.id;

  // Escenario: venta A = 10 × Q12.00 = Q120.00 (costo 10 × Q7.00 = Q70.00)
  //            venta B =  5 × Q20.00 = Q100.00 (costo  5 × Q15.00 = Q75.00)
  //            + una venta anulada de A (2 uds = Q24.00)
  productA = await newProduct('Reporte A', 1200n, 700n, 100, 'Bebidas Reporte');
  productB = await newProduct('Reporte B', 2000n, 1500n, 100, 'Abarrotes Reporte');
  await sell(productA, 10, 1200);
  await sell(productB, 5, 2000);
  const toVoid = await sell(productA, 2, 1200);
  await request(app)
    .post(`/api/sales/${toVoid}/void`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ reason: 'Prueba de reporte de anuladas' });

  // Gasto Q30.00 desde caja + compra Q500.00
  const category = await prismaAdmin.expenseCategory.findFirstOrThrow({
    where: { tenantId: tenantA.id, deletedAt: null },
  });
  await request(app)
    .post('/api/expenses')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      storeId,
      categoryId: category.id,
      amount: 3000,
      description: 'Gasto de prueba de reportes',
      cashSessionId: sessionId,
    });
  const supplier = await prismaAdmin.supplier.findFirstOrThrow({ where: { tenantId: tenantA.id } });
  await request(app)
    .post('/api/purchases')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      storeId,
      supplierId: supplier.id,
      items: [{ productId: productA, qty: 50, unitCost: 1000 }],
    });
});

describe('Dashboard y reconciliación con los ledgers', () => {
  it('los totales cuadran con los valores calculados a mano', async () => {
    const res = await report('dashboard');
    expect(res.status).toBe(200);
    // Ventas COMPLETED: Q120.00 + Q100.00 = Q220.00
    expect(res.body.salesTotal).toBe('22000');
    expect(res.body.salesCount).toBe(2);
    // Costo: Q70.00 + Q75.00 = Q145.00 → utilidad Q75.00
    expect(res.body.costTotal).toBe('14500');
    expect(res.body.profitTotal).toBe('7500');
    // Anulada: 1 venta de Q24.00
    expect(res.body.voidedCount).toBe(1);
    expect(res.body.voidedTotal).toBe('2400');
    expect(res.body.expensesTotal).toBe('3000');
    expect(res.body.purchasesTotal).toBe('50000');
    // Ticket promedio: Q220.00 / 2 = Q110.00
    expect(res.body.ticketAverage).toBe('11000');
  });

  it('el total del reporte coincide con la suma directa del ledger de líneas', async () => {
    const [ledger] = await prismaAdmin.$queryRaw<{ total: bigint; cost: bigint }[]>`
      SELECT COALESCE(SUM(si.line_total), 0)::bigint AS total,
             COALESCE(ROUND(SUM(si.qty * si.unit_cost_at_sale)), 0)::bigint AS cost
      FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.store_id = ${storeId}::uuid AND s.status = 'COMPLETED'`;
    const res = await report('dashboard');
    expect(res.body.salesTotal).toBe(ledger!.total.toString());
    expect(res.body.costTotal).toBe(ledger!.cost.toString());
  });

  it('el efectivo del reporte de caja cuadra con el ledger de la sesión', async () => {
    const res = await report('cash-sessions');
    const session = res.body.find((s: { id: string }) => s.id === sessionId);
    expect(session).toBeDefined();
    // Ventas en efectivo: Q220.00 + Q24.00 (la anulada entró y luego salió)
    expect(session.salesIn).toBe('24400');
    expect(session.expensesOut).toBe('3000');

    const [ledger] = await prismaAdmin.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM cash_movements
      WHERE cash_session_id = ${sessionId}::uuid`;
    // Esperado en caja = apertura + entradas − salidas
    // 20000 + 24400 − 2400 (anulación) − 3000 (gasto) = 39000
    expect(ledger!.total).toBe(39000n);
  });

  it('utilidades por producto: márgenes exactos por línea', async () => {
    const res = await report('profit-by-product');
    expect(res.status).toBe(200);
    const a = res.body.find((r: { productId: string }) => r.productId === productA);
    const b = res.body.find((r: { productId: string }) => r.productId === productB);
    expect(a.revenue).toBe('12000');
    expect(a.cost).toBe('7000');
    expect(a.profit).toBe('5000');
    expect(a.marginPct).toBeCloseTo(41.6, 1); // 5000/12000
    expect(b.profit).toBe('2500');
    expect(b.marginPct).toBeCloseTo(25.0, 1);
    // La suma por producto es el total del dashboard
    const sum = res.body.reduce((acc: bigint, r: { profit: string }) => acc + BigInt(r.profit), 0n);
    expect(sum.toString()).toBe('7500');
  });

  it('agrupar por día, usuario, categoría o producto da siempre el mismo total', async () => {
    const totals = await Promise.all(
      ['day', 'user', 'category', 'product', 'store'].map(async (groupBy) => {
        const res = await report(`sales?groupBy=${groupBy}`);
        expect(res.status).toBe(200);
        return res.body.reduce((acc: bigint, r: { total: string }) => acc + BigInt(r.total), 0n);
      }),
    );
    for (const total of totals) expect(total.toString()).toBe('22000');

    // Las categorías creadas aparecen con su nombre
    const byCategory = await report('sales?groupBy=category');
    const labels = byCategory.body.map((r: { label: string }) => r.label);
    expect(labels).toContain('Bebidas Reporte');
    expect(labels).toContain('Abarrotes Reporte');
  });

  it('resumen financiero: utilidad bruta menos gastos = resultado', async () => {
    const res = await report('financial-summary');
    expect(res.status).toBe(200);
    const row = res.body.find((r: { storeId: string }) => r.storeId === storeId);
    expect(row.salesTotal).toBe('22000');
    expect(row.grossProfit).toBe('7500');
    expect(row.expensesTotal).toBe('3000');
    expect(row.netResult).toBe('4500'); // 7500 − 3000
    expect(row.voidedTotal).toBe('2400');
  });

  it('gastos por categoría distinguen lo pagado de caja', async () => {
    const res = await report('expenses');
    const total = res.body.reduce((acc: bigint, r: { total: string }) => acc + BigInt(r.total), 0n);
    expect(total.toString()).toBe('3000');
    expect(res.body[0].fromCash).toBe('3000');
  });

  it('ventas anuladas listan motivo y responsable', async () => {
    const res = await report('voided-sales');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].total).toBe('2400');
    expect(res.body[0].reason).toBe('Prueba de reporte de anuladas');
    expect(res.body[0].voidedBy).toBeTruthy();
  });

  it('compras por proveedor e inventario valorizado', async () => {
    const purchases = await report('purchases-by-supplier');
    expect(purchases.body[0].total).toBe('50000');

    const inventory = await request(app)
      .get(`/api/reports/inventory?storeId=${storeId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const a = inventory.body.find((r: { productId: string }) => r.productId === productA);
    // 100 − 10 − 2 + 2 (anulación) + 50 (compra) = 140
    expect(a.stockQty).toBe('140.000');
    expect(a.stockValue).toBeTruthy();
  });
});

describe('Permisos y aislamiento en reportes', () => {
  it('el WORKER no entra al módulo de reportes; su vista es el turno de caja (D-024)', async () => {
    for (const path of ['dashboard', 'sales', 'profit-by-product', 'financial-summary']) {
      const res = await report(path, workerToken);
      expect(res.status).toBe(403);
    }
    // Lo que sí puede consultar: su propia sesión de caja (Fase 2)
    const turno = await request(app)
      .get(`/api/cash/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${workerToken}`);
    expect(turno.status).toBe(200);
    expect(turno.body.expectedSoFar).toBeTruthy();
  });

  /**
   * Caso real que hace load-bearing al ocultamiento de costos: un tenant
   * delega la lectura de reportes a un trabajador de confianza vía
   * extraPermissions, SIN darle acceso a costos ni utilidades.
   */
  it('un WORKER con reports.view delegado ve ventas pero nunca costos', async () => {
    const workerId = (await prismaAdmin.user.findUniqueOrThrow({
      where: { email: 'worker1@demo.local' },
    })).id;
    await prismaAdmin.storeMember.updateMany({
      where: { storeId, userId: workerId },
      data: { extraPermissions: ['reports.view'] },
    });
    const delegated = await login('worker1@demo.local');

    const dashboard = await report('dashboard', delegated);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.salesTotal).toBe('22000'); // sí ve ventas
    expect(dashboard.body.costTotal).toBe('0'); // nunca costos
    expect(dashboard.body.profitTotal).toBe('0');
    expect(dashboard.body.purchasesTotal).toBe('0');
    expect(dashboard.body.series[0].profitTotal).toBeUndefined();

    const sales = await report('sales?groupBy=day', delegated);
    expect(sales.status).toBe(200);
    expect(sales.body[0].profit).toBeUndefined();

    const inventory = await request(app)
      .get(`/api/reports/inventory?storeId=${storeId}`)
      .set('Authorization', `Bearer ${delegated}`);
    expect(inventory.body[0].avgCost).toBeUndefined();
    expect(inventory.body[0].stockValue).toBeUndefined();

    // Los reportes que SON de costos siguen cerrados
    for (const path of ['profit-by-product', 'purchases-by-supplier', 'financial-summary']) {
      expect((await report(path, delegated)).status).toBe(403);
    }

    await prismaAdmin.storeMember.updateMany({
      where: { storeId, userId: workerId },
      data: { extraPermissions: [] },
    });
  });

  it('el WORKER no ve la auditoría', async () => {
    const res = await report('audit', workerToken);
    expect(res.status).toBe(403);
  });

  it('un tenant no puede reportar sobre la tienda de otro', async () => {
    const otherToken = await login('owner2@demo.local');
    const res = await request(app)
      .get(`/api/reports/dashboard?from=${TODAY}&to=${TODAY}&storeId=${storeId}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STORE_ACCESS_DENIED');
  });

  it('la auditoría lista las acciones críticas del periodo', async () => {
    const res = await request(app)
      .get(`/api/reports/audit?criticalOnly=true&storeId=${storeId}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const actions = res.body.rows.map((r: { action: string }) => r.action);
    expect(actions).toContain('sale.void');
    expect(res.body.total).toBeGreaterThan(0);
  });
});

describe('Exportación CSV', () => {
  it('entrega BOM, encabezados en español y montos con punto decimal', async () => {
    const res = await request(app)
      .get(`/api/reports/profit-by-product?from=${TODAY}&to=${TODAY}&storeId=${storeId}&format=csv`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('.csv');
    expect(res.text.charCodeAt(0)).toBe(0xfeff); // BOM para Excel
    expect(res.text).toContain('Utilidad (Q)');
    expect(res.text).toContain('120.00'); // Q120.00 legible por Excel
  });

  it('los campos con coma o comillas salen escapados', async () => {
    const category = await prismaAdmin.expenseCategory.create({
      data: { id: uuidv7(), tenantId: tenantA.id, name: `Fletes, cargas y "extras" ${Date.now()}` },
    });
    await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ storeId, categoryId: category.id, amount: 100, description: 'Prueba escape' });

    const res = await request(app)
      .get(`/api/reports/expenses?from=${TODAY}&to=${TODAY}&storeId=${storeId}&format=csv`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.text).toContain('"Fletes, cargas y ""extras""');
  });
});

describe('Agregados diarios', () => {
  it('el recómputo es idempotente y coincide con el dashboard', async () => {
    const refresh = () =>
      request(app)
        .post('/api/reports/daily-stats/refresh')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ from: TODAY, to: TODAY, storeId });

    expect((await refresh()).status).toBe(200);
    const first = await prismaAdmin.dailyStoreStat.findMany({ where: { storeId } });
    expect((await refresh()).status).toBe(200);
    const second = await prismaAdmin.dailyStoreStat.findMany({ where: { storeId } });

    expect(second).toHaveLength(first.length);
    expect(second[0]!.salesTotal).toBe(first[0]!.salesTotal);
    expect(second[0]!.salesTotal).toBe(22000n);
    expect(second[0]!.profitTotal).toBe(7500n);
    expect(second[0]!.expensesTotal).toBe(3100n); // 3000 + 100 del test de escape
    expect(second[0]!.voidedCount).toBe(1);
  });
});

describe('Alertas de stock', () => {
  it('abre un episodio con notificación al admin y lo cierra al reponer', async () => {
    const productId = await newProduct('Alerta test', 1000n, 500n, 10);
    await prismaAdmin.storeProduct.update({
      where: { storeId_productId: { storeId, productId } },
      data: { minStock: 5 },
    });
    const before = await prismaAdmin.notification.count({
      where: { userId: ownerId, type: 'STOCK_LOW' },
    });

    // Baja a 4 (≤ mínimo 5) → alerta ACTIVE + notificación
    await sell(productId, 6, 1000);
    const alerts = await prismaAdmin.stockAlert.findMany({
      where: { storeProduct: { storeId, productId } },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.status).toBe('ACTIVE');
    const after = await prismaAdmin.notification.count({
      where: { userId: ownerId, type: 'STOCK_LOW' },
    });
    expect(after).toBe(before + 1);

    // Otra venta que sigue bajo el mínimo NO duplica alerta ni notificación
    await sell(productId, 1, 1000);
    expect(
      await prismaAdmin.stockAlert.count({
        where: { storeProduct: { storeId, productId }, status: 'ACTIVE' },
      }),
    ).toBe(1);
    expect(
      await prismaAdmin.notification.count({ where: { userId: ownerId, type: 'STOCK_LOW' } }),
    ).toBe(after);

    // Reposición por compra → la alerta se resuelve sola
    const supplier = await prismaAdmin.supplier.findFirstOrThrow({ where: { tenantId: tenantA.id } });
    await request(app)
      .post('/api/purchases')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ storeId, supplierId: supplier.id, items: [{ productId, qty: 20, unitCost: 500 }] });

    const resolved = await prismaAdmin.stockAlert.findFirstOrThrow({
      where: { storeProduct: { storeId, productId } },
    });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolvedAt).not.toBeNull();

    // Vuelve a bajar → NUEVO episodio (el anterior quedó cerrado)
    await sell(productId, 20, 1000);
    expect(
      await prismaAdmin.stockAlert.count({ where: { storeProduct: { storeId, productId } } }),
    ).toBe(2);
  });

  it('la bandeja de notificaciones marca leídas solo las del propio usuario', async () => {
    const inbox = await request(app)
      .get('/api/notifications?unreadOnly=true')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.unread).toBeGreaterThan(0);

    const read = await request(app)
      .post('/api/notifications/read')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(read.body.updated).toBeGreaterThan(0);

    const after = await request(app)
      .get('/api/notifications?unreadOnly=true')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(after.body.unread).toBe(0);
  });
});

describe('Rendimiento', () => {
  it('un reporte de un mes completo responde en menos de 2 s (criterio Fase 4)', async () => {
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' });
    const startedAt = Date.now();
    const res = await request(app)
      .get(`/api/reports/dashboard?from=${from}&to=${TODAY}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const elapsed = Date.now() - startedAt;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(2000);
  });

  it('utilidades por producto sobre todo el catálogo responde en menos de 2 s', async () => {
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' });
    const startedAt = Date.now();
    const res = await request(app)
      .get(`/api/reports/profit-by-product?from=${from}&to=${TODAY}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    const elapsed = Date.now() - startedAt;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(2000);
  });
});
