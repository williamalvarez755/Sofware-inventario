/**
 * Correcciones de la auditoría (Fase 7). Cada bloque prueba un hallazgo real:
 *  1. Ingreso por nombre de usuario (D-036).
 *  2. Membresía de tienda exigida en las mutaciones sensibles: sin ella, un
 *     encargado de una sucursal podía operar el dinero de otra conociendo ids.
 *  3. Descuentos: los reportes ya no inflan ingresos ni utilidad.
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
let ownerId: string;
let ownerToken: string;
let unidadId: string;
/** Dos tiendas del MISMO tenant, con el trabajador solo en la primera. */
let storeConAcceso: string;
let storeSinAcceso: string;
let registerSinAcceso: string;
let workerLimitadoToken: string;
let workerLimitadoId: string;

async function login(username: string, password = PASSWORD) {
  return request(app).post('/api/auth/login').send({ username, password });
}

beforeAll(async () => {
  tenantA = await prismaAdmin.tenant.findUniqueOrThrow({ where: { slug: 'tienda-uno' } });
  ownerId = (await prismaAdmin.user.findUniqueOrThrow({ where: { username: 'owner1' } })).id;
  unidadId = (await prismaAdmin.unit.findFirstOrThrow({ where: { code: 'UNIDAD' } })).id;
  ownerToken = (await login('owner1')).body.accessToken;

  const stamp = Date.now();
  const [conAcceso, sinAcceso] = await Promise.all([
    prismaAdmin.store.create({
      data: { id: uuidv7(), tenantId: tenantA.id, name: `Sucursal propia ${stamp}` },
    }),
    prismaAdmin.store.create({
      data: { id: uuidv7(), tenantId: tenantA.id, name: `Sucursal ajena ${stamp}` },
    }),
  ]);
  storeConAcceso = conAcceso.id;
  storeSinAcceso = sinAcceso.id;

  // Trabajador con permisos de caja, pero SOLO en su sucursal.
  const worker = await prismaAdmin.user.create({
    data: {
      id: uuidv7(),
      tenantId: tenantA.id,
      username: `limitado${stamp}`,
      email: `limitado${stamp}@demo.local`,
      name: 'Encargado de una sola sucursal',
      passwordHash: (
        await prismaAdmin.user.findUniqueOrThrow({ where: { username: 'owner1' } })
      ).passwordHash,
      mustChangePassword: false,
    },
  });
  workerLimitadoId = worker.id;
  await prismaAdmin.storeMember.create({
    data: {
      id: uuidv7(),
      tenantId: tenantA.id,
      storeId: storeConAcceso,
      userId: worker.id,
      role: 'STORE_ADMIN',
    },
  });
  // El dueño sí es miembro de ambas (para poder preparar la sucursal ajena).
  await prismaAdmin.storeMember.createMany({
    data: [
      { id: uuidv7(), tenantId: tenantA.id, storeId: storeConAcceso, userId: ownerId, role: 'OWNER' },
      { id: uuidv7(), tenantId: tenantA.id, storeId: storeSinAcceso, userId: ownerId, role: 'OWNER' },
    ],
  });
  workerLimitadoToken = (await login(worker.username)).body.accessToken;
  ownerToken = (await login('owner1')).body.accessToken; // refresca membresías

  const register = await prismaAdmin.cashRegister.create({
    data: { id: uuidv7(), tenantId: tenantA.id, storeId: storeSinAcceso, name: 'Caja ajena' },
  });
  registerSinAcceso = register.id;
});

describe('1. Ingreso por nombre de usuario (D-036)', () => {
  it('entra con el usuario, sin escribir el correo', async () => {
    const res = await login('owner1');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('sigue aceptando el correo para no romper integraciones', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner1@demo.local', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('no distingue entre usuario inexistente y contraseña incorrecta', async () => {
    const noExiste = await login('nadie-existe-aqui');
    const malaClave = await login('owner1', 'incorrecta');
    expect(noExiste.status).toBe(malaClave.status);
    expect(noExiste.body.error.message).toBe(malaClave.body.error.message);
  });

  it('/me devuelve el usuario para mostrarlo en la interfaz', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.body.user.username).toBe('owner1');
  });

  it('el super admin también entra por usuario', async () => {
    const res = await request(app)
      .post('/api/platform/auth/login')
      .send({
        username: 'superadmin',
        password: process.env.SEED_SUPERADMIN_PASSWORD ?? 'SuperAdmin!2026',
      });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
  });
});

describe('4. Ingreso unificado (D-041)', () => {
  it('el mismo formulario resuelve una cuenta de tienda', async () => {
    const res = await login('owner1');
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('tienda');
    expect(res.body.tenant.name).toBeTruthy();
  });

  it('...y una cuenta de plataforma, sin puerta aparte', async () => {
    const res = await request(app).post('/api/auth/login').send({
      username: 'superadmin',
      password: process.env.SEED_SUPERADMIN_PASSWORD ?? 'SuperAdmin!2026',
    });
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('plataforma');
    expect(res.body.admin.name).toBeTruthy();

    // Y el token sirve de verdad en el panel de plataforma
    const panel = await request(app)
      .get('/api/platform/metrics')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(panel.status).toBe(200);
  });

  it('un usuario inexistente no revela que no existe', async () => {
    const inexistente = await login('no-existe-esta-cuenta');
    const claveMala = await login('owner1', 'incorrecta');
    const adminClaveMala = await request(app)
      .post('/api/auth/login')
      .send({ username: 'superadmin', password: 'incorrecta' });

    expect(inexistente.status).toBe(401);
    expect(claveMala.status).toBe(401);
    expect(adminClaveMala.status).toBe(401);
    expect(inexistente.body.error.message).toBe(claveMala.body.error.message);
    expect(adminClaveMala.body.error.message).toBe(claveMala.body.error.message);
  });

  it('la cuenta de plataforma sigue sin poder operar como tienda', async () => {
    const res = await request(app).post('/api/auth/login').send({
      username: 'superadmin',
      password: process.env.SEED_SUPERADMIN_PASSWORD ?? 'SuperAdmin!2026',
    });
    const tienda = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(tienda.status).toBe(401);
  });
});

describe('2. Membresía de tienda exigida en mutaciones sensibles', () => {
  it('no puede abrir ni mover la caja de una sucursal donde no es miembro', async () => {
    // El dueño abre la caja de la sucursal ajena
    const session = await request(app)
      .post('/api/cash/sessions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ cashRegisterId: registerSinAcceso, openingAmount: 50000 });
    expect(session.status).toBe(201);
    const sessionId = session.body.id as string;

    // El encargado de OTRA sucursal, aun con permiso de retiro, no puede tocarla
    const retiro = await request(app)
      .post(`/api/cash/sessions/${sessionId}/withdrawals`)
      .set('Authorization', `Bearer ${workerLimitadoToken}`)
      .send({ amount: 10000, reason: 'Intento desde otra sucursal' });
    expect(retiro.status).toBe(403);
    expect(retiro.body.error.code).toBe('STORE_ACCESS_DENIED');

    const deposito = await request(app)
      .post(`/api/cash/sessions/${sessionId}/deposits`)
      .set('Authorization', `Bearer ${workerLimitadoToken}`)
      .send({ amount: 5000, reason: 'Intento desde otra sucursal' });
    expect(deposito.status).toBe(403);

    // El efectivo quedó intacto
    const [saldo] = await prismaAdmin.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM cash_movements
      WHERE cash_session_id = ${sessionId}::uuid`;
    expect(saldo!.total).toBe(50000n);
  });

  it('no puede anular una venta de una sucursal ajena', async () => {
    const product = await prismaAdmin.product.create({
      data: {
        id: uuidv7(),
        tenantId: tenantA.id,
        sku: `F7-${uuidv7().slice(-8)}`,
        name: 'Producto sucursal ajena',
        unitId: unidadId,
        basePrice: 1000n,
      },
    });
    await withTenantTx(tenantA.id, (tx) =>
      applyCostedEntry(tx, tenantA.id, {
        storeId: storeSinAcceso,
        productId: product.id,
        type: 'INITIAL',
        qty: 10,
        unitCost: 600n,
        userId: ownerId,
      }),
    );
    const openSession = await prismaAdmin.cashSession.findFirstOrThrow({
      where: { storeId: storeSinAcceso, status: 'OPEN' },
    });
    const venta = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        storeId: storeSinAcceso,
        cashSessionId: openSession.id,
        clientOpId: randomUUID(),
        items: [{ productId: product.id, qty: 2 }],
        discount: 0,
        payments: [{ method: 'CASH', amount: 2000 }],
      });
    expect(venta.status).toBe(201);

    const anular = await request(app)
      .post(`/api/sales/${venta.body.saleId}/void`)
      .set('Authorization', `Bearer ${workerLimitadoToken}`)
      .send({ reason: 'Intento de anular en sucursal ajena' });
    expect(anular.status).toBe(403);
    expect(anular.body.error.code).toBe('STORE_ACCESS_DENIED');

    const sigueViva = await prismaAdmin.sale.findUniqueOrThrow({
      where: { id: venta.body.saleId },
    });
    expect(sigueViva.status).toBe('COMPLETED');
  });

  it('no puede editar un gasto de una sucursal ajena', async () => {
    const categoria = await prismaAdmin.expenseCategory.findFirstOrThrow({
      where: { tenantId: tenantA.id, deletedAt: null },
    });
    const gasto = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        storeId: storeSinAcceso,
        categoryId: categoria.id,
        amount: 1500,
        description: 'Gasto de la sucursal ajena',
      });
    expect(gasto.status).toBe(201);

    const editar = await request(app)
      .patch(`/api/expenses/${gasto.body.id}`)
      .set('Authorization', `Bearer ${workerLimitadoToken}`)
      .send({ description: 'Editado desde otra sucursal' });
    expect(editar.status).toBe(403);

    const intacto = await prismaAdmin.expense.findUniqueOrThrow({ where: { id: gasto.body.id } });
    expect(intacto.description).toBe('Gasto de la sucursal ajena');
  });

  it('sí puede operar con normalidad en SU propia sucursal', async () => {
    const register = await prismaAdmin.cashRegister.create({
      data: { id: uuidv7(), tenantId: tenantA.id, storeId: storeConAcceso, name: 'Caja propia' },
    });
    const session = await request(app)
      .post('/api/cash/sessions')
      .set('Authorization', `Bearer ${workerLimitadoToken}`)
      .send({ cashRegisterId: register.id, openingAmount: 20000 });
    expect(session.status).toBe(201);

    const retiro = await request(app)
      .post(`/api/cash/sessions/${session.body.id}/withdrawals`)
      .set('Authorization', `Bearer ${workerLimitadoToken}`)
      .send({ amount: 5000, reason: 'Pago de flete' });
    expect(retiro.status).toBe(201);
    expect(retiro.body.expectedAmount).toBe('15000');
  });
});

describe('3. Descuentos: los reportes ya no inflan los ingresos', () => {
  it('una venta con descuento se reporta por su total real, no por el bruto', async () => {
    const stamp = Date.now();
    const store = await prismaAdmin.store.create({
      data: { id: uuidv7(), tenantId: tenantA.id, name: `Descuentos ${stamp}` },
    });
    await prismaAdmin.storeMember.create({
      data: { id: uuidv7(), tenantId: tenantA.id, storeId: store.id, userId: ownerId, role: 'OWNER' },
    });
    const register = await prismaAdmin.cashRegister.create({
      data: { id: uuidv7(), tenantId: tenantA.id, storeId: store.id, name: 'Caja descuentos' },
    });
    const token = (await login('owner1')).body.accessToken;
    const session = await request(app)
      .post('/api/cash/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ cashRegisterId: register.id, openingAmount: 0 });

    // Dos productos: A 10×Q10.00 = Q100.00 (costo Q6.00), B 5×Q20.00 = Q100.00 (costo Q12.00)
    const productos = await Promise.all(
      [
        { nombre: 'Descuento A', precio: 1000n, costo: 600n },
        { nombre: 'Descuento B', precio: 2000n, costo: 1200n },
      ].map(async (p) => {
        const producto = await prismaAdmin.product.create({
          data: {
            id: uuidv7(),
            tenantId: tenantA.id,
            sku: `DESC-${uuidv7().slice(-8)}`,
            name: p.nombre,
            unitId: unidadId,
            basePrice: p.precio,
          },
        });
        await withTenantTx(tenantA.id, (tx) =>
          applyCostedEntry(tx, tenantA.id, {
            storeId: store.id,
            productId: producto.id,
            type: 'INITIAL',
            qty: 100,
            unitCost: p.costo,
            userId: ownerId,
          }),
        );
        return producto.id;
      }),
    );

    // Subtotal Q200.00, descuento Q20.00 (10 %) → total Q180.00
    const venta = await request(app)
      .post('/api/sales')
      .set('Authorization', `Bearer ${token}`)
      .send({
        storeId: store.id,
        cashSessionId: session.body.id,
        clientOpId: randomUUID(),
        items: [
          { productId: productos[0]!, qty: 10 },
          { productId: productos[1]!, qty: 5 },
        ],
        discount: 2000,
        payments: [{ method: 'CASH', amount: 18000 }],
      });
    expect(venta.status).toBe(201);
    expect(venta.body.receipt.total).toBe('18000');

    const rango = `from=${TODAY}&to=${TODAY}&storeId=${store.id}`;
    const dashboard = await request(app)
      .get(`/api/reports/dashboard?${rango}`)
      .set('Authorization', `Bearer ${token}`);

    // Antes se reportaban Q200.00 (el bruto); ahora Q180.00, lo realmente cobrado
    expect(dashboard.body.salesTotal).toBe('18000');
    expect(dashboard.body.series[0].salesTotal).toBe('18000');
    // Costo: 10×600 + 5×1200 = 12,000 → utilidad 18,000 − 12,000 = 6,000
    expect(dashboard.body.costTotal).toBe('12000');
    expect(dashboard.body.profitTotal).toBe('6000');

    // Todas las agrupaciones concuerdan con el total real
    for (const groupBy of ['day', 'user', 'category', 'product', 'store']) {
      const res = await request(app)
        .get(`/api/reports/sales?${rango}&groupBy=${groupBy}`)
        .set('Authorization', `Bearer ${token}`);
      const suma = res.body.reduce((acc: bigint, r: { total: string }) => acc + BigInt(r.total), 0n);
      expect(suma.toString(), `agrupado por ${groupBy}`).toBe('18000');
    }

    // El descuento se reparte en proporción: A y B aportaban la mitad cada uno
    const utilidades = await request(app)
      .get(`/api/reports/profit-by-product?${rango}`)
      .set('Authorization', `Bearer ${token}`);
    const a = utilidades.body.find((r: { productId: string }) => r.productId === productos[0]);
    const b = utilidades.body.find((r: { productId: string }) => r.productId === productos[1]);
    expect(a.revenue).toBe('9000'); // Q100.00 − Q10.00
    expect(b.revenue).toBe('9000');
    expect(a.profit).toBe('3000'); // 9,000 − 6,000
    expect(b.profit).toBe('3000'); // 9,000 − 6,000

    // Resumen financiero y agregados diarios cuentan lo mismo
    const resumen = await request(app)
      .get(`/api/reports/financial-summary?${rango}`)
      .set('Authorization', `Bearer ${token}`);
    const fila = resumen.body.find((r: { storeId: string }) => r.storeId === store.id);
    expect(fila.salesTotal).toBe('18000');
    expect(fila.grossProfit).toBe('6000');

    await request(app)
      .post('/api/reports/daily-stats/refresh')
      .set('Authorization', `Bearer ${token}`)
      .send({ from: TODAY, to: TODAY, storeId: store.id });
    const agregado = await prismaAdmin.dailyStoreStat.findFirstOrThrow({
      where: { storeId: store.id },
    });
    expect(agregado.salesTotal).toBe(18000n);
    expect(agregado.profitTotal).toBe(6000n);
  });
});
