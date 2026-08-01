/**
 * Auth: login, refresh rotativo, detección de reuso, logout y suspensión
 * de tenant por el super admin. Requiere BD migrada + seedeada.
 */
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prismaAdmin } from '../src/lib/prisma.js';
import { invalidateTenantCache } from '../src/middleware/auth.js';

const app = createApp();
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo!2026';

async function login(email: string, password = DEMO_PASSWORD) {
  return request(app).post('/api/auth/login').send({ email, password });
}

describe('Login', () => {
  it('acepta credenciales válidas y entrega tokens + contexto', async () => {
    const res = await login('owner1@demo.local');
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.tenant.name).toBe('Tienda La Bendición');
  });

  it('rechaza contraseña incorrecta con 401 y deja bitácora', async () => {
    const res = await login('owner1@demo.local', 'incorrecta');
    expect(res.status).toBe(401);
    const log = await prismaAdmin.auditLog.findFirst({
      where: { action: 'auth.login_failed' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
  });

  it('el login exitoso queda en bitácora', async () => {
    const log = await prismaAdmin.auditLog.findFirst({
      where: { action: 'auth.login' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log!.tenantId).not.toBeNull();
  });
});

describe('Refresh rotativo', () => {
  it('rota el token y detecta reuso revocando la familia completa', async () => {
    const { body } = await login('owner2@demo.local');
    const firstRefresh = body.refreshToken as string;

    // Rotación normal
    const rotated = await request(app).post('/api/auth/refresh').send({ refreshToken: firstRefresh });
    expect(rotated.status).toBe(200);
    const secondRefresh = rotated.body.refreshToken as string;
    expect(secondRefresh).not.toBe(firstRefresh);

    // Reuso del token viejo → 401 y familia revocada
    const reuse = await request(app).post('/api/auth/refresh').send({ refreshToken: firstRefresh });
    expect(reuse.status).toBe(401);

    // El token "bueno" (segundo) también quedó revocado por seguridad
    const afterReuse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: secondRefresh });
    expect(afterReuse.status).toBe(401);

    const log = await prismaAdmin.auditLog.findFirst({
      where: { action: 'auth.refresh_reuse_detected' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
  });

  it('logout revoca la sesión: el refresh posterior falla', async () => {
    const { body } = await login('owner2@demo.local');
    await request(app).post('/api/auth/logout').send({ refreshToken: body.refreshToken });
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: body.refreshToken });
    expect(res.status).toBe(401);
  });
});

describe('Suspensión de tenant (super admin)', () => {
  const SUPER = {
    email: process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@minimarket.local',
    password: process.env.SEED_SUPERADMIN_PASSWORD ?? 'SuperAdmin!2026',
  };
  let tenantBId: string;

  afterAll(async () => {
    // Reactivar tenant B pase lo que pase, para no dejar el seed sucio.
    if (tenantBId) {
      await prismaAdmin.tenant.update({
        where: { id: tenantBId },
        data: { status: 'ACTIVE', suspendedReason: null },
      });
      invalidateTenantCache(tenantBId);
    }
  });

  it('suspender bloquea el login y las llamadas del tenant; reactivar lo restaura', async () => {
    const platformLogin = await request(app).post('/api/platform/auth/login').send(SUPER);
    expect(platformLogin.status).toBe(200);
    const platformToken = platformLogin.body.accessToken as string;

    const tenantB = await prismaAdmin.tenant.findUniqueOrThrow({ where: { slug: 'tienda-dos' } });
    tenantBId = tenantB.id;

    // Token emitido ANTES de la suspensión
    const preLogin = await login('owner2@demo.local');
    const preToken = preLogin.body.accessToken as string;

    const suspend = await request(app)
      .patch(`/api/platform/tenants/${tenantB.id}/status`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ status: 'SUSPENDED', reason: 'Mora de prueba' });
    expect(suspend.status).toBe(200);

    // Login bloqueado
    const blockedLogin = await login('owner2@demo.local');
    expect(blockedLogin.status).toBe(403);
    expect(blockedLogin.body.error.code).toBe('TENANT_SUSPENDED');

    // Token previo bloqueado (cache invalidada por el PATCH)
    const blockedCall = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${preToken}`);
    expect(blockedCall.status).toBe(403);

    // El tenant A sigue operando normal
    const loginA = await login('owner1@demo.local');
    expect(loginA.status).toBe(200);

    // Reactivación
    const reactivate = await request(app)
      .patch(`/api/platform/tenants/${tenantB.id}/status`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ status: 'ACTIVE', reason: 'Pago recibido' });
    expect(reactivate.status).toBe(200);
    const loginAgain = await login('owner2@demo.local');
    expect(loginAgain.status).toBe(200);
  });
});
