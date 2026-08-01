/**
 * Panel de plataforma (Fase 5). Lo que se prueba aquí:
 *  - ONBOARDING atómico: un cliente nuevo queda listo para vender, y si algo
 *    choca (slug o correo repetido) no queda nada a medias.
 *  - Los límites del plan contratado se aplican de verdad.
 *  - SUSPENSIÓN: bloquea al moroso sin tocar a los demás; registrar el pago
 *    lo reactiva.
 *  - IMPERSONACIÓN: solo lectura, auditada, sin refresh token y sin poder
 *    escalar a otro tenant.
 *  - Los endpoints de plataforma son inalcanzables con token de tenant.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prismaAdmin } from '../src/lib/prisma.js';

const app = createApp();
const SUPER = {
  email: process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@minimarket.local',
  password: process.env.SEED_SUPERADMIN_PASSWORD ?? 'SuperAdmin!2026',
};

let platformToken: string;
const stamp = Date.now();

/** Cliente nuevo creado por el onboarding; se reutiliza en varios tests. */
let newTenant: {
  tenantId: string;
  slug: string;
  owner: { email: string; temporaryPassword: string };
  storeId: string;
};

function asPlatform(method: 'get' | 'post' | 'patch', path: string) {
  return request(app)[method](`/api/platform${path}`).set('Authorization', `Bearer ${platformToken}`);
}

beforeAll(async () => {
  const login = await request(app).post('/api/platform/auth/login').send(SUPER);
  expect(login.status).toBe(200);
  platformToken = login.body.accessToken;
});

describe('Onboarding de un cliente nuevo', () => {
  it('deja al tendero listo para vender: dueño, tienda, caja, plan y categorías', async () => {
    const startedAt = Date.now();
    const res = await asPlatform('post', '/tenants').send({
      name: `Tienda Doña Mari ${stamp}`,
      slug: `dona-mari-${stamp}`,
      planCode: 'basico',
      ownerName: 'María López',
      ownerEmail: `mari-${stamp}@demo.local`,
      storeName: 'La Esquina',
      taxRegime: 'PEQUENO_CONTRIBUYENTE',
      trialDays: 30,
    });
    expect(res.status).toBe(201);
    newTenant = res.body;
    expect(res.body.owner.temporaryPassword).toMatch(/^[a-z]{6}-\d{4}$/);
    expect(Date.now() - startedAt).toBeLessThan(5000); // criterio: alta rápida

    const tenantId = res.body.tenantId;
    const [stores, members, registers, categories, subscription] = await Promise.all([
      prismaAdmin.store.count({ where: { tenantId } }),
      prismaAdmin.storeMember.count({ where: { tenantId, role: 'OWNER' } }),
      prismaAdmin.cashRegister.count({ where: { tenantId } }),
      prismaAdmin.expenseCategory.count({ where: { tenantId } }),
      prismaAdmin.subscription.findFirstOrThrow({ where: { tenantId } }),
    ]);
    expect(stores).toBe(1);
    expect(members).toBe(1);
    expect(registers).toBe(1);
    expect(categories).toBe(4);
    expect(subscription.status).toBe('TRIAL');

    // Y el onboarding quedó en la bitácora global
    const log = await prismaAdmin.auditLog.findFirst({
      where: { action: 'platform.tenant_onboard', entityId: tenantId },
    });
    expect(log).not.toBeNull();
    expect(log!.platformUserId).not.toBeNull();
  });

  it('el dueño entra con la contraseña temporal y debe cambiarla', async () => {
    const login = await request(app).post('/api/auth/login').send({
      email: newTenant.owner.email,
      password: newTenant.owner.temporaryPassword,
    });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    expect(login.body.tenant.id).toBe(newTenant.tenantId);

    // Ve su tienda y ninguna otra
    const stores = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(stores.body).toHaveLength(1);
    expect(stores.body[0].name).toBe('La Esquina');
  });

  it('rechaza slug y correo repetidos sin dejar nada a medias', async () => {
    const before = await prismaAdmin.tenant.count();

    const dupSlug = await asPlatform('post', '/tenants').send({
      name: 'Otra tienda',
      slug: newTenant.slug,
      planCode: 'basico',
      ownerName: 'Otro Dueño',
      ownerEmail: `otro-${stamp}@demo.local`,
      storeName: 'Sucursal',
    });
    expect(dupSlug.status).toBe(409);
    expect(dupSlug.body.error.code).toBe('SLUG_TAKEN');

    const dupEmail = await asPlatform('post', '/tenants').send({
      name: 'Tercera tienda',
      slug: `tercera-${stamp}`,
      planCode: 'basico',
      ownerName: 'Tercer Dueño',
      ownerEmail: newTenant.owner.email,
      storeName: 'Sucursal',
    });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.error.code).toBe('EMAIL_TAKEN');

    expect(await prismaAdmin.tenant.count()).toBe(before);
    // Ni tenant huérfano ni usuario suelto
    expect(await prismaAdmin.tenant.findUnique({ where: { slug: `tercera-${stamp}` } })).toBeNull();
  });

  it('el plan contratado limita de verdad: "basico" permite una sola tienda', async () => {
    const login = await request(app).post('/api/auth/login').send({
      email: newTenant.owner.email,
      password: newTenant.owner.temporaryPassword,
    });
    const res = await request(app)
      .post('/api/stores')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ name: 'Segunda sucursal' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PLAN_LIMIT_STORES');
  });
});

describe('Suscripciones y cobranza', () => {
  it('renovar extiende desde el vencimiento vigente, no desde hoy', async () => {
    const before = await prismaAdmin.subscription.findFirstOrThrow({
      where: { tenantId: newTenant.tenantId },
      orderBy: { periodEnd: 'desc' },
    });

    const res = await asPlatform('post', `/tenants/${newTenant.tenantId}/subscriptions`).send({
      planCode: 'basico',
      months: 1,
      status: 'ACTIVE',
      paymentNote: 'Transferencia recibida',
    });
    expect(res.status).toBe(201);
    // El nuevo periodo arranca donde terminaba el anterior
    expect(new Date(res.body.periodStart).toISOString().slice(0, 10)).toBe(
      before.periodEnd.toISOString().slice(0, 10),
    );
    expect(res.body.amount).toBe('25000'); // precio del plan básico
  });

  it('suspender bloquea al moroso sin afectar a los demás; el pago lo reactiva', async () => {
    const suspend = await asPlatform('patch', `/tenants/${newTenant.tenantId}/status`).send({
      status: 'SUSPENDED',
      reason: 'Mora de dos meses',
    });
    expect(suspend.status).toBe(200);

    // El moroso no entra
    const blocked = await request(app).post('/api/auth/login').send({
      email: newTenant.owner.email,
      password: newTenant.owner.temporaryPassword,
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('TENANT_SUSPENDED');

    // Los demás clientes siguen operando con normalidad
    const other = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner1@demo.local', password: process.env.SEED_DEMO_PASSWORD ?? 'Demo!2026' });
    expect(other.status).toBe(200);
    const stores = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${other.body.accessToken}`);
    expect(stores.status).toBe(200);

    // Registrar el pago lo reactiva sin tocar el estado a mano
    const payment = await asPlatform('post', `/tenants/${newTenant.tenantId}/subscriptions`).send({
      planCode: 'basico',
      months: 1,
      status: 'ACTIVE',
      paymentNote: 'Pago de la mora',
    });
    expect(payment.status).toBe(201);
    const back = await request(app).post('/api/auth/login').send({
      email: newTenant.owner.email,
      password: newTenant.owner.temporaryPassword,
    });
    expect(back.status).toBe(200);
  });
});

describe('Impersonación "ver como tenant" (D-028)', () => {
  let impersonationToken: string;

  it('emite un token de solo lectura y lo deja en la bitácora', async () => {
    const res = await asPlatform('post', `/tenants/${newTenant.tenantId}/impersonate`).send({
      reason: 'El cliente reporta que no ve sus productos',
    });
    expect(res.status).toBe(200);
    expect(res.body.readOnly).toBe(true);
    expect(res.body.expiresInMinutes).toBe(15);
    expect(res.body.actingAs.email).toBe(newTenant.owner.email);
    impersonationToken = res.body.accessToken;

    const log = await prismaAdmin.auditLog.findFirst({
      where: { action: 'platform.impersonate', entityId: newTenant.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.impersonating).toBe(true);
    expect(log!.after).toMatchObject({ reason: 'El cliente reporta que no ve sus productos' });
  });

  it('puede LEER los datos del cliente', async () => {
    const stores = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${impersonationToken}`);
    expect(stores.status).toBe(200);
    expect(stores.body[0].name).toBe('La Esquina');

    const products = await request(app)
      .get(`/api/products?storeId=${newTenant.storeId}`)
      .set('Authorization', `Bearer ${impersonationToken}`);
    expect(products.status).toBe(200);
  });

  it('NO puede escribir nada: ni vender, ni crear productos, ni tocar caja', async () => {
    const cases = [
      ['/api/products', { name: 'Producto pirata', unitId: '00000000-0000-0000-0000-000000000000', price: 100 }],
      ['/api/cash/sessions', { cashRegisterId: '00000000-0000-0000-0000-000000000000', openingAmount: 1000 }],
      ['/api/expenses', { storeId: newTenant.storeId, categoryId: '00000000-0000-0000-0000-000000000000', amount: 100, description: 'intento' }],
    ] as const;

    for (const [path, body] of cases) {
      const res = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${impersonationToken}`)
        .send(body);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('IMPERSONATION_READ_ONLY');
    }
  });

  it('no sirve para entrar al panel de plataforma ni para renovarse', async () => {
    const platform = await request(app)
      .get('/api/platform/tenants')
      .set('Authorization', `Bearer ${impersonationToken}`);
    expect(platform.status).toBe(403);

    // La impersonación NO emite refresh token: la sesión de soporte muere sola
    // a los 15 minutos. (Se compara antes/después: el tenant sí tiene tokens
    // de los ingresos legítimos de su propio dueño.)
    const before = await prismaAdmin.refreshToken.count({
      where: { tenantId: newTenant.tenantId },
    });
    await asPlatform('post', `/tenants/${newTenant.tenantId}/impersonate`).send({
      reason: 'Verificación de que no crea sesión persistente',
    });
    const after = await prismaAdmin.refreshToken.count({
      where: { tenantId: newTenant.tenantId },
    });
    expect(after).toBe(before);
  });

  it('permite entrar a un tenant SUSPENDIDO (para eso es soporte)', async () => {
    await asPlatform('patch', `/tenants/${newTenant.tenantId}/status`).send({
      status: 'SUSPENDED',
      reason: 'Prueba de soporte sobre cliente suspendido',
    });
    const res = await asPlatform('post', `/tenants/${newTenant.tenantId}/impersonate`).send({
      reason: 'Diagnóstico durante la suspensión',
    });
    expect(res.status).toBe(200);
    const stores = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(stores.status).toBe(200); // el super admin sí ve

    // ...mientras el dueño real sigue bloqueado
    const owner = await request(app).post('/api/auth/login').send({
      email: newTenant.owner.email,
      password: newTenant.owner.temporaryPassword,
    });
    expect(owner.status).toBe(403);

    await asPlatform('patch', `/tenants/${newTenant.tenantId}/status`).send({
      status: 'ACTIVE',
      reason: 'Fin de la prueba',
    });
  });
});

describe('Métricas, planes y auditoría global', () => {
  it('las métricas globales reflejan la realidad de la plataforma', async () => {
    const res = await asPlatform('get', '/metrics');
    expect(res.status).toBe(200);
    const tenantCount = await prismaAdmin.tenant.count();
    expect(res.body.tenants.total).toBe(tenantCount);
    expect(res.body.tenants.active).toBeGreaterThan(0);
    expect(res.body.scale.stores).toBeGreaterThan(0);
    expect(Number(res.body.volume.volume30d)).toBeGreaterThan(0);
    expect(res.body).toHaveProperty('revenue.mrr');
    expect(Array.isArray(res.body.needsAttention)).toBe(true);
  });

  it('la ficha del tenant muestra actividad real del negocio', async () => {
    const res = await asPlatform('get', `/tenants/${newTenant.tenantId}`);
    expect(res.status).toBe(200);
    expect(res.body.stores).toHaveLength(1);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.subscriptions.length).toBeGreaterThanOrEqual(2);
    expect(res.body.activity.sales30d).toBe(0); // recién creado, no ha vendido
  });

  it('crear y editar planes queda auditado', async () => {
    const created = await asPlatform('post', '/plans').send({
      code: `premium-${stamp}`,
      name: 'Plan Premium',
      maxStores: 10,
      maxUsers: 50,
      monthlyPrice: 90000,
    });
    expect(created.status).toBe(201);

    const updated = await asPlatform('patch', `/plans/${created.body.id}`).send({
      monthlyPrice: 95000,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.monthlyPrice).toBe('95000');

    const log = await prismaAdmin.auditLog.findFirst({
      where: { action: 'platform.plan_update', entityId: created.body.id },
    });
    expect(log!.before).toMatchObject({ monthlyPrice: '90000' });
    expect(log!.after).toMatchObject({ monthlyPrice: '95000' });

    const duplicate = await asPlatform('post', '/plans').send({
      code: `premium-${stamp}`,
      name: 'Duplicado',
      maxStores: 1,
      maxUsers: 1,
      monthlyPrice: 100,
    });
    expect(duplicate.status).toBe(409);
  });

  it('la auditoría global cruza tenants y distingue al actor de plataforma', async () => {
    const res = await asPlatform('get', '/audit');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    const tenantsSeen = new Set(res.body.rows.map((r: { tenant: string | null }) => r.tenant));
    expect(tenantsSeen.size).toBeGreaterThan(1); // visibilidad global real

    const impersonations = res.body.rows.filter(
      (r: { action: string }) => r.action === 'platform.impersonate',
    );
    expect(impersonations.length).toBeGreaterThan(0);
    expect(impersonations[0].impersonating).toBe(true);
    expect(impersonations[0].actor).toContain('plataforma');

    const filtered = await asPlatform('get', `/audit?tenantId=${newTenant.tenantId}`);
    expect(filtered.body.rows.every((r: { tenant: string }) => r.tenant !== null)).toBe(true);
  });
});

describe('Frontera plataforma / tenant', () => {
  it('un token de tenant no abre ningún endpoint de plataforma', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner1@demo.local', password: process.env.SEED_DEMO_PASSWORD ?? 'Demo!2026' });
    const token = login.body.accessToken;

    for (const [method, path] of [
      ['get', '/api/platform/metrics'],
      ['get', '/api/platform/tenants'],
      ['post', '/api/platform/plans'],
      ['get', '/api/platform/audit'],
    ] as const) {
      const res = await request(app)[method](path).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PLATFORM_ONLY');
    }
  });

  it('un token de plataforma no opera como tenant', async () => {
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${platformToken}`);
    expect(res.status).toBe(401);
  });
});
