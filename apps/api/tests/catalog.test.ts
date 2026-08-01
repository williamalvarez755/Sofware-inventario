/**
 * Catálogo: CRUD de productos, auditoría de cambio de precio, aislamiento
 * del catálogo entre tenants e importación CSV (con y sin errores).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prismaAdmin } from '../src/lib/prisma.js';

const app = createApp();
let ownerToken: string;
let owner2Token: string;
let storeAId: string;
let unidadId: string;

async function login(email: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password: process.env.SEED_DEMO_PASSWORD ?? 'Demo!2026' });
  return res.body.accessToken;
}

beforeAll(async () => {
  ownerToken = await login('owner1@demo.local');
  owner2Token = await login('owner2@demo.local');
  const tenantA = await prismaAdmin.tenant.findUniqueOrThrow({ where: { slug: 'tienda-uno' } });
  storeAId = (await prismaAdmin.store.findFirstOrThrow({ where: { tenantId: tenantA.id } })).id;
  unidadId = (await prismaAdmin.unit.findFirstOrThrow({ where: { code: 'UNIDAD' } })).id;
});

describe('Productos', () => {
  it('crea producto con categoría al vuelo, barcode y stock inicial', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Gaseosa 600ml prueba',
        categoryName: 'Bebidas Test',
        unitId: unidadId,
        price: 1200,
        barcode: `BAR-${Date.now()}`,
        initial: { storeId: storeAId, qty: 12, unitCost: 800 },
      });
    expect(res.status).toBe(201);

    const detail = await request(app)
      .get(`/api/products/${res.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(detail.body.category.name).toBe('Bebidas Test');
    expect(detail.body.stores[0].stockQty).toBe('12');
    expect(detail.body.stores[0].avgCost).toBe('800');
  });

  it('el cambio de precio queda auditado con antes/después', async () => {
    const created = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Producto precio test', unitId: unidadId, price: 1000 });
    const res = await request(app)
      .patch(`/api/products/${created.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ price: 1500 });
    expect(res.status).toBe(200);
    const log = await prismaAdmin.auditLog.findFirst({
      where: { action: 'product.price_change', entityId: created.body.id },
    });
    expect(log).not.toBeNull();
    expect(log!.before).toMatchObject({ price: '1000' });
    expect(log!.after).toMatchObject({ price: '1500' });
  });

  it('el catálogo de A es invisible para B (API)', async () => {
    const created = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Solo de A', unitId: unidadId, price: 100 });
    const res = await request(app)
      .get(`/api/products/${created.body.id}`)
      .set('Authorization', `Bearer ${owner2Token}`);
    expect(res.status).toBe(404);
  });

  it('búsqueda por código de barras encuentra el producto', async () => {
    const barcode = `SEARCH-${Date.now()}`;
    await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Buscable por código', unitId: unidadId, price: 100, barcode });
    const res = await request(app)
      .get(`/api/products?search=${barcode}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].name).toBe('Buscable por código');
  });
});

describe('Importación CSV', () => {
  it('importa filas válidas, reporta filas malas y no duplica al reimportar', async () => {
    const stamp = Date.now();
    const csv = [
      'nombre,sku,codigo_barras,categoria,unidad,precio,costo,stock_inicial',
      `Frijol negro 1lb,CSV-A-${stamp},,Granos,LIBRA,8.50,6.00,50`,
      `Arroz blanco 1lb,CSV-B-${stamp},,Granos,LIBRA,6.00,4.50,30.5`,
      `SinUnidadValida,CSV-C-${stamp},,Granos,NOEXISTE,1.00,0.50,5`,
      `X,CSV-D-${stamp},,,UNIDAD,1.00,0.50,0`,
    ].join('\n');

    const res = await request(app)
      .post(`/api/products/import?storeId=${storeAId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Content-Type', 'text/csv')
      .send(csv);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(2);
    expect(res.body.errors).toHaveLength(2); // unidad inválida + nombre corto

    // Stock inicial en kardex
    const frijol = await prismaAdmin.product.findFirstOrThrow({
      where: { sku: `CSV-A-${stamp}` },
    });
    const movement = await prismaAdmin.inventoryMovement.findFirstOrThrow({
      where: { productId: frijol.id, type: 'INITIAL' },
    });
    expect(movement.qty.toFixed(3)).toBe('50.000');

    // Reimportar: actualiza sin crear ni duplicar stock
    const again = await request(app)
      .post(`/api/products/import?storeId=${storeAId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Content-Type', 'text/csv')
      .send(csv);
    expect(again.body.created).toBe(0);
    expect(again.body.updated).toBe(2);
    const movementCount = await prismaAdmin.inventoryMovement.count({
      where: { productId: frijol.id },
    });
    expect(movementCount).toBe(1);
  });

  it('importa 1,000 productos en menos de 30 s (criterio Fase 1)', async () => {
    const stamp = Date.now();
    const lines = ['nombre,sku,codigo_barras,categoria,unidad,precio,costo,stock_inicial'];
    for (let i = 0; i < 1000; i++) {
      lines.push(`Producto masivo ${i},MASS-${stamp}-${i},,Masivos,UNIDAD,10.00,7.00,5`);
    }
    const startedAt = Date.now();
    const res = await request(app)
      .post(`/api/products/import?storeId=${storeAId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Content-Type', 'text/csv')
      .send(lines.join('\n'));
    const elapsed = Date.now() - startedAt;
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1000);
    expect(res.body.errors).toHaveLength(0);
    expect(elapsed).toBeLessThan(30_000);
  }, 45_000);
});
