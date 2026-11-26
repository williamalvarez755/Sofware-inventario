/**
 * Usuarios de la tienda.
 *
 * El valor de estas pruebas no está en el CRUD: está en las tres reglas que
 * impiden que alguien se quede con el negocio o lo deje sin dueño. Antes de
 * este módulo, el RBAC completo existía pero era inalcanzable —`users.manage`
 * no lo consumía ningún endpoint— y el dueño terminaba prestando su cuenta.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { prismaAdmin } from '../src/lib/prisma.js';

const app = createApp();
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo!2026';

let ownerToken: string;
let workerToken: string;
let storeId: string;
let tenantId: string;
let storeAjenaId: string;

async function login(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return res.body.accessToken;
}

const unico = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

beforeAll(async () => {
  ownerToken = await login('owner1@demo.local');
  workerToken = await login('worker1@demo.local');
  const tenant = await prismaAdmin.tenant.findUniqueOrThrow({ where: { slug: 'tienda-uno' } });
  tenantId = tenant.id;
  storeId = (
    await prismaAdmin.store.findFirstOrThrow({ where: { tenantId, name: 'Central' } })
  ).id;
  // Una tienda de OTRO negocio, para probar que no se puede asignar.
  const otro = await prismaAdmin.tenant.findUniqueOrThrow({ where: { slug: 'tienda-dos' } });
  storeAjenaId = (await prismaAdmin.store.findFirstOrThrow({ where: { tenantId: otro.id } })).id;
});

describe('Crear usuarios de tienda', () => {
  it('el dueño crea un cajero y recibe su contraseña una sola vez', async () => {
    const username = `cajero-${unico()}`;
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Cajero de prueba', username, role: 'WORKER', storeIds: [storeId] });

    expect(res.status).toBe(201);
    expect(res.body.username).toBe(username);
    expect(typeof res.body.password).toBe('string');
    expect(res.body.password.length).toBeGreaterThanOrEqual(10);

    // Nace obligado a cambiarla: la conocen dos personas hasta entonces.
    const creado = await prismaAdmin.user.findUniqueOrThrow({ where: { username } });
    expect(creado.mustChangePassword).toBe(true);
    expect(creado.isActive).toBe(true);

    // Y puede entrar de verdad con ella.
    const entrada = await request(app)
      .post('/api/auth/login')
      .send({ username, password: res.body.password });
    expect(entrada.status).toBe(200);
  });

  it('un cajero sin correo recibe uno interno, no el del dueño', async () => {
    // `users.email` es obligatorio y único global (D-018), pero un cajero de
    // barrio no tiene correo. Reusar el del dueño rompería la unicidad y la
    // trazabilidad.
    const username = `sincorreo-${unico()}`;
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Sin correo', username, role: 'WORKER', storeIds: [storeId] });

    const creado = await prismaAdmin.user.findUniqueOrThrow({ where: { username } });
    expect(creado.email).toBe(`${username}@tienda-uno.local`);
  });

  it('un nombre de usuario repetido se rechaza con 409', async () => {
    const username = `repetido-${unico()}`;
    const base = { name: 'Uno', role: 'WORKER' as const, storeIds: [storeId] };
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...base, username });

    const segundo = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...base, username });
    expect(segundo.status).toBe(409);
  });

  it('un trabajador no puede crear usuarios', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${workerToken}`)
      .send({ name: 'X', username: `x-${unico()}`, role: 'WORKER', storeIds: [storeId] });
    expect(res.status).toBe(403);
  });
});

describe('Escalada de privilegios', () => {
  it('un encargado NO puede crear un dueño', async () => {
    // Es la regla que impide que quien administra usuarios se quede con el
    // negocio creándose un segundo OWNER.
    const encargadoUser = `encargado-${unico()}`;
    const creado = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Encargado',
        username: encargadoUser,
        role: 'STORE_ADMIN',
        storeIds: [storeId],
      });
    expect(creado.status).toBe(201);

    // El encargado cambia su clave temporal para poder operar.
    const primera = await request(app)
      .post('/api/auth/login')
      .send({ username: encargadoUser, password: creado.body.password });
    const nueva = 'Encargado!2026';
    await request(app)
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${primera.body.accessToken}`)
      .send({ currentPassword: creado.body.password, newPassword: nueva });

    const sesion = await request(app)
      .post('/api/auth/login')
      .send({ username: encargadoUser, password: nueva });
    const tokenEncargado = sesion.body.accessToken;

    // Tiene users.manage, así que puede crear cajeros...
    const cajero = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({ name: 'Su cajero', username: `suyo-${unico()}`, role: 'WORKER', storeIds: [storeId] });
    expect(cajero.status).toBe(201);

    // ...pero NO un dueño.
    const intento = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({ name: 'Dueño falso', username: `falso-${unico()}`, role: 'OWNER', storeIds: [storeId] });
    expect(intento.status).toBe(403);
    expect(intento.body.error.code).toBe('ROLE_ESCALATION_DENIED');
  });

  it('no se puede asignar una tienda de otro negocio', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Intruso',
        username: `intruso-${unico()}`,
        role: 'WORKER',
        storeIds: [storeAjenaId],
      });
    expect(res.status).toBe(403);
  });
});

describe('No dejar el negocio sin dueño ni sin acceso', () => {
  it('el dueño no puede desactivarse a sí mismo', async () => {
    const yo = await prismaAdmin.user.findUniqueOrThrow({ where: { email: 'owner1@demo.local' } });
    const res = await request(app)
      .patch(`/api/users/${yo.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_AUTO_DESACTIVAR');
  });

  it('desactivar a alguien lo saca de todos sus dispositivos en el acto', async () => {
    const username = `despedido-${unico()}`;
    const creado = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Se va', username, role: 'WORKER', storeIds: [storeId] });

    const sesion = await request(app)
      .post('/api/auth/login')
      .send({ username, password: creado.body.password });
    expect(sesion.status).toBe(200);

    await request(app)
      .patch(`/api/users/${creado.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ isActive: false });

    // No basta con que no pueda volver a entrar: la sesión abierta muere.
    const refresco = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: sesion.body.refreshToken });
    expect(refresco.status).toBe(401);
  });

  it('reiniciar la contraseña cierra las sesiones y obliga a cambiarla', async () => {
    const username = `olvidadizo-${unico()}`;
    const creado = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Olvidó su clave', username, role: 'WORKER', storeIds: [storeId] });

    const sesion = await request(app)
      .post('/api/auth/login')
      .send({ username, password: creado.body.password });

    const reinicio = await request(app)
      .post(`/api/users/${creado.body.id}/password`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(reinicio.status).toBe(200);
    expect(reinicio.body.password).not.toBe(creado.body.password);

    const refresco = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: sesion.body.refreshToken });
    expect(refresco.status).toBe(401);

    const nueva = await request(app)
      .post('/api/auth/login')
      .send({ username, password: reinicio.body.password });
    expect(nueva.status).toBe(200);
  });
});

describe('Aislamiento entre negocios', () => {
  it('el listado solo trae usuarios del propio negocio', async () => {
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);

    const ids: string[] = res.body.map((u: { id: string }) => u.id);
    const ajenos = await prismaAdmin.user.count({
      where: { id: { in: ids }, tenantId: { not: tenantId } },
    });
    expect(ajenos).toBe(0);
    expect(res.body.every((u: { stores: unknown[] }) => Array.isArray(u.stores))).toBe(true);
  });

  it('el listado no filtra material de autenticación', async () => {
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${ownerToken}`);
    const cuerpo = JSON.stringify(res.body);
    expect(cuerpo).not.toContain('passwordHash');
    expect(cuerpo).not.toContain('supervisorPinHash');
  });
});
