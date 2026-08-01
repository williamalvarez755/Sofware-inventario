/**
 * Suite de AISLAMIENTO multi-tenant — la más importante del proyecto.
 * Prueba las dos capas (CLAUDE.md §2.2):
 *   1. RLS puro: el rol runtime sin contexto no ve NADA; con contexto de A no
 *      ve datos de B, ni puede escribir filas de B (WITH CHECK).
 *   2. API: un usuario de A jamás recibe recursos de B ni accede a plataforma.
 * Requiere BD migrada y seedeada (npm run db:migrate && npm run db:seed).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { forTenant, prismaAdmin, prismaRuntime } from '../src/lib/prisma.js';

const app = createApp();
let tenantA: { id: string };
let tenantB: { id: string };

beforeAll(async () => {
  tenantA = await prismaAdmin.tenant.findUniqueOrThrow({ where: { slug: 'tienda-uno' } });
  tenantB = await prismaAdmin.tenant.findUniqueOrThrow({ where: { slug: 'tienda-dos' } });
});

describe('Capa 2: RLS en PostgreSQL (rol runtime, sin filtros de aplicación)', () => {
  it('sin contexto de tenant no devuelve ninguna fila', async () => {
    const stores = await prismaRuntime.store.findMany();
    expect(stores).toHaveLength(0);
  });

  it('con contexto de A solo devuelve filas de A', async () => {
    const dbA = forTenant(tenantA.id);
    const stores = await dbA.store.findMany();
    expect(stores.length).toBeGreaterThan(0);
    expect(stores.every((s) => s.tenantId === tenantA.id)).toBe(true);

    const users = await dbA.user.findMany();
    expect(users.every((u) => u.tenantId === tenantA.id)).toBe(true);
  });

  it('con contexto de A, buscar una tienda de B por id devuelve null', async () => {
    const storeB = await prismaAdmin.store.findFirstOrThrow({
      where: { tenantId: tenantB.id },
    });
    const found = await forTenant(tenantA.id).store.findUnique({ where: { id: storeB.id } });
    expect(found).toBeNull();
  });

  it('con contexto de A, INSERTAR una fila con tenant_id de B es rechazado (WITH CHECK)', async () => {
    await expect(
      forTenant(tenantA.id).store.create({
        data: {
          id: '01912345-0000-7000-8000-00000000dead',
          tenantId: tenantB.id,
          name: 'Tienda intrusa',
        },
      }),
    ).rejects.toThrow();
  });

  it('con contexto de A, ACTUALIZAR datos de B no afecta ninguna fila', async () => {
    const result = await forTenant(tenantA.id).store.updateMany({
      where: { tenantId: tenantB.id },
      data: { name: 'Hackeada' },
    });
    expect(result.count).toBe(0);
  });
});

describe('Capa 1: API', () => {
  async function loginAs(email: string) {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: process.env.SEED_DEMO_PASSWORD ?? 'Demo!2026' });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }

  it('un owner de A solo ve tiendas de A', async () => {
    const token = await loginAs('owner1@demo.local');
    const res = await request(app).get('/api/stores').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const storesB = await prismaAdmin.store.findMany({ where: { tenantId: tenantB.id } });
    const idsB = new Set(storesB.map((s) => s.id));
    expect(res.body.length).toBeGreaterThan(0);
    for (const store of res.body) expect(idsB.has(store.id)).toBe(false);
  });

  it('un usuario de tenant NO accede a endpoints de plataforma', async () => {
    const token = await loginAs('owner1@demo.local');
    const res = await request(app)
      .get('/api/platform/tenants')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('un trabajador no puede crear tiendas (RBAC)', async () => {
    const token = await loginAs('worker1@demo.local');
    const res = await request(app)
      .post('/api/stores')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sucursal pirata' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });
});
