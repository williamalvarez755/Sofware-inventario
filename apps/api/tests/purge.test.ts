/**
 * Eliminación definitiva de un cliente.
 *
 * Es la operación más destructiva del sistema, así que lo que se prueba no es
 * tanto que borre —eso es lo fácil— sino que NO borre cuando no debe, y que la
 * muralla de inmutabilidad siga en pie para todo lo demás:
 *  - no se puede eliminar a un cliente activo,
 *  - la confirmación tiene que coincidir,
 *  - el vecino de al lado no pierde un solo dato,
 *  - las ventas y el kardex siguen siendo imborrables fuera de la purga,
 *  - y el rol de la aplicación no puede abrir esa puerta ni declarando la
 *    variable que la abre.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prismaAdmin, prismaRuntime } from '../src/lib/prisma.js';
import { TABLAS_PURGA } from '../src/modules/platform/purge.service.js';

const app = createApp();
const SUPER = {
  email: process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@minimarket.local',
  password: process.env.SEED_SUPERADMIN_PASSWORD ?? 'SuperAdmin!2026',
};
const stamp = Date.now();

let platformToken: string;
let victima: { id: string; slug: string; username: string };
const CLAVE = 'ParaBorrar2026';

function asPlatform(method: 'get' | 'post' | 'patch' | 'delete', path: string) {
  return request(app)[method](`/api/platform${path}`).set('Authorization', `Bearer ${platformToken}`);
}

/** Cliente completo: producto, caja abierta y una venta real que borrar. */
async function crearClienteConVenta(sufijo: string) {
  const alta = await asPlatform('post', '/tenants').send({
    name: `Para borrar ${sufijo}`,
    slug: `borrar-${sufijo}`,
    planCode: 'basico',
    ownerName: 'Dueño saliente',
    ownerUsername: `borrar${sufijo}`,
    ownerEmail: `borrar-${sufijo}@demo.local`,
    ownerPassword: CLAVE,
    storeName: 'Su tienda',
    trialDays: 30,
  });
  expect(alta.status).toBe(201);

  const sesion = await request(app)
    .post('/api/auth/login')
    .send({ username: `borrar${sufijo}`, password: CLAVE });
  const token = sesion.body.accessToken;
  const auth = { Authorization: `Bearer ${token}` };

  const storeId = alta.body.storeId;
  const unidad = await prismaAdmin.unit.findFirstOrThrow({ where: { code: 'UNIDAD' } });
  const producto = await request(app)
    .post('/api/products')
    .set(auth)
    .send({
      name: 'Producto que se va',
      unitId: unidad.id,
      price: 1000,
      initial: { storeId, qty: 10, unitCost: 600 },
    });
  expect(producto.status).toBe(201);

  const caja = await prismaAdmin.cashRegister.findFirstOrThrow({
    where: { tenantId: alta.body.tenantId },
  });
  const sesionCaja = await request(app)
    .post('/api/cash/sessions')
    .set(auth)
    .send({ cashRegisterId: caja.id, openingAmount: 10_000 });
  expect(sesionCaja.status).toBe(201);

  const venta = await request(app)
    .post('/api/sales')
    .set(auth)
    .send({
      storeId,
      cashSessionId: sesionCaja.body.id,
      clientOpId: crypto.randomUUID(),
      items: [{ productId: producto.body.id, qty: 2 }],
      discount: 0,
      payments: [{ method: 'CASH', amount: 2000, amountTendered: 2000 }],
    });
  expect(venta.status).toBe(201);

  return { id: alta.body.tenantId, slug: `borrar-${sufijo}`, username: `borrar${sufijo}` };
}

beforeAll(async () => {
  const login = await request(app).post('/api/platform/auth/login').send(SUPER);
  platformToken = login.body.accessToken;
  victima = await crearClienteConVenta(String(stamp));
});

describe('Protecciones antes de borrar', () => {
  it('no elimina a un cliente que sigue activo', async () => {
    const res = await asPlatform('delete', `/tenants/${victima.id}`).send({
      confirmSlug: victima.slug,
      reason: 'Intento sobre un cliente en operación',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TENANT_NOT_CANCELLED');
  });

  it('con el cliente dado de baja, exige que la confirmación coincida', async () => {
    const baja = await asPlatform('patch', `/tenants/${victima.id}/status`).send({
      status: 'CANCELLED',
      reason: 'El cliente ya no quiere el servicio',
    });
    expect(baja.status).toBe(200);

    const res = await asPlatform('delete', `/tenants/${victima.id}`).send({
      confirmSlug: 'otro-identificador',
      reason: 'Confirmación equivocada a propósito',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CONFIRMATION_MISMATCH');

    // Y sigue existiendo.
    expect(await prismaAdmin.tenant.findUnique({ where: { id: victima.id } })).not.toBeNull();
  });

  it('exige un motivo explicado, no una palabra suelta', async () => {
    const res = await asPlatform('delete', `/tenants/${victima.id}`).send({
      confirmSlug: victima.slug,
      reason: 'no',
    });
    expect(res.status).toBe(400);
  });
});

describe('La muralla de inmutabilidad sigue en pie', () => {
  it('una venta no se puede borrar fuera de una purga', async () => {
    const venta = await prismaAdmin.sale.findFirstOrThrow({ where: { tenantId: victima.id } });
    await expect(
      prismaAdmin.$executeRaw`DELETE FROM sales WHERE id = ${venta.id}::uuid`,
    ).rejects.toThrow(/no se borran/i);
  });

  it('el rol de la aplicación no puede abrir la puerta ni declarando la variable', async () => {
    // Este es el punto clave del diseño: la purga se autoriza por variable de
    // transacción, así que hay que probar que el rol de runtime —el que usa el
    // sistema en cada venta— no pueda usarla aunque la conozca.
    await expect(
      prismaRuntime.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.purge_tenant = 'on'`);
        await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${victima.id}'`);
        await tx.$executeRawUnsafe(`DELETE FROM inventory_movements`);
      }),
    ).rejects.toThrow(/append-only/i);
  });
});

describe('Purga', () => {
  it('la lista de tablas cubre TODAS las que tienen tenant_id', async () => {
    // Si mañana alguien agrega una tabla y olvida sumarla, la purga fallaría
    // por llave foránea recién en producción. Que falle acá.
    const rows = await prismaAdmin.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT DISTINCT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'tenant_id'`,
    );
    const faltantes = rows
      .map((r) => r.table_name)
      .filter((t) => !TABLAS_PURGA.includes(t));
    expect(faltantes).toEqual([]);
  });

  it('elimina al cliente por completo y deja constancia en la bitácora', async () => {
    const vecino = await prismaAdmin.tenant.findUniqueOrThrow({ where: { slug: 'tienda-uno' } });
    const ventasVecinoAntes = await prismaAdmin.sale.count({ where: { tenantId: vecino.id } });

    const res = await asPlatform('delete', `/tenants/${victima.id}`).send({
      confirmSlug: victima.slug,
      reason: 'El cliente terminó el contrato y pidió que se borren sus datos',
    });
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    // Se llevó lo que tenía que llevarse: la venta y su kardex.
    expect(res.body.filasBorradas.sales).toBe(1);
    expect(res.body.filasBorradas.inventory_movements).toBeGreaterThan(0);

    // No queda nada del cliente.
    expect(await prismaAdmin.tenant.findUnique({ where: { id: victima.id } })).toBeNull();
    expect(await prismaAdmin.sale.count({ where: { tenantId: victima.id } })).toBe(0);
    expect(await prismaAdmin.user.findUnique({ where: { username: victima.username } })).toBeNull();

    // El vecino no perdió absolutamente nada.
    expect(await prismaAdmin.sale.count({ where: { tenantId: vecino.id } })).toBe(ventasVecinoAntes);
    expect(await prismaAdmin.tenant.findUnique({ where: { id: vecino.id } })).not.toBeNull();

    // Y la huella de la eliminación sobrevive, que es lo único que debe quedar.
    const log = await prismaAdmin.auditLog.findFirst({
      where: { action: 'platform.tenant_purged', entityId: victima.id },
    });
    expect(log).not.toBeNull();
    expect(log!.before).toMatchObject({ slug: victima.slug });
  });

  it('el usuario del cliente eliminado ya no puede entrar', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: victima.username, password: CLAVE });
    expect(res.status).toBe(401);
  });
});
