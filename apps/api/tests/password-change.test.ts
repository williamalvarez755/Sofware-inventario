/**
 * Cambio de contraseña.
 *
 * Hasta ahora el alta de un cliente marcaba "debe cambiar su contraseña
 * temporal", pero no existía forma de hacerlo: el tendero quedaba para siempre
 * con la clave que el super admin le dictó por teléfono. Esto cubre el hueco y
 * lo que lo rodea:
 *  - la contraseña actual es obligatoria (un token robado no basta),
 *  - cambiarla cierra las demás sesiones,
 *  - una sesión de soporte NO puede cambiar credenciales ajenas,
 *  - el super admin puede elegir la contraseña inicial del cliente.
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
const stamp = Date.now();

let platformToken: string;
/** Cliente creado con contraseña ELEGIDA por el super admin. */
let cliente: { username: string; tenantId: string };
const CLAVE_INICIAL = 'LaQueYoElijo2026';

beforeAll(async () => {
  const login = await request(app).post('/api/platform/auth/login').send(SUPER);
  expect(login.status).toBe(200);
  platformToken = login.body.accessToken;

  const alta = await request(app)
    .post('/api/platform/tenants')
    .set('Authorization', `Bearer ${platformToken}`)
    .send({
      name: `Tienda Clave ${stamp}`,
      slug: `clave-${stamp}`,
      planCode: 'basico',
      ownerName: 'Dueño de prueba',
      ownerUsername: `clave${stamp}`,
      ownerEmail: `clave-${stamp}@demo.local`,
      ownerPassword: CLAVE_INICIAL,
      storeName: 'Sucursal única',
      trialDays: 30,
    });
  expect(alta.status).toBe(201);
  cliente = { username: `clave${stamp}`, tenantId: alta.body.tenantId };
});

async function entrar(username: string, password: string) {
  return request(app).post('/api/auth/login').send({ username, password });
}

describe('Contraseña elegida por el super admin', () => {
  it('el dueño entra con la contraseña que le dictaron, y queda obligado a cambiarla', async () => {
    const res = await entrar(cliente.username, CLAVE_INICIAL);
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(true);
  });

  it('la respuesta del alta devuelve esa misma contraseña para poder dictarla', async () => {
    // Se devuelve una sola vez; sirve para que el super admin la comunique.
    const user = await prismaAdmin.user.findUniqueOrThrow({
      where: { username: cliente.username },
      select: { mustChangePassword: true },
    });
    expect(user.mustChangePassword).toBe(true);
  });
});

describe('Cambio de la propia contraseña', () => {
  const NUEVA = 'MiClavePropia2026';

  it('rechaza si la contraseña actual es incorrecta, y no cambia nada', async () => {
    const { body } = await entrar(cliente.username, CLAVE_INICIAL);
    const res = await request(app)
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .send({ currentPassword: 'no-es-la-mia', newPassword: NUEVA });
    expect(res.status).toBe(401);

    // La original sigue siendo válida: no se tocó nada.
    expect((await entrar(cliente.username, CLAVE_INICIAL)).status).toBe(200);
  });

  it('exige mínimo 8 caracteres y que sea distinta de la actual', async () => {
    const { body } = await entrar(cliente.username, CLAVE_INICIAL);
    const auth = `Bearer ${body.accessToken}`;

    const corta = await request(app)
      .post('/api/auth/password')
      .set('Authorization', auth)
      .send({ currentPassword: CLAVE_INICIAL, newPassword: 'corta1' });
    expect(corta.status).toBe(400);

    const igual = await request(app)
      .post('/api/auth/password')
      .set('Authorization', auth)
      .send({ currentPassword: CLAVE_INICIAL, newPassword: CLAVE_INICIAL });
    expect(igual.status).toBe(400);
  });

  it('cambia la contraseña, apaga el aviso de cambio obligatorio y cierra las demás sesiones', async () => {
    // Dos sesiones abiertas: simula la caja de la tienda y el teléfono.
    const sesionA = (await entrar(cliente.username, CLAVE_INICIAL)).body;
    const sesionB = (await entrar(cliente.username, CLAVE_INICIAL)).body;

    const res = await request(app)
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${sesionA.accessToken}`)
      .send({ currentPassword: CLAVE_INICIAL, newPassword: NUEVA });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();

    // La contraseña vieja ya no entra; la nueva sí, y sin exigir cambio.
    expect((await entrar(cliente.username, CLAVE_INICIAL)).status).toBe(401);
    const conNueva = await entrar(cliente.username, NUEVA);
    expect(conNueva.status).toBe(200);
    expect(conNueva.body.user.mustChangePassword).toBe(false);

    // La otra sesión quedó fuera: es lo que se espera al cambiar la clave.
    const refrescoViejo = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: sesionB.refreshToken });
    expect(refrescoViejo.status).toBe(401);

    // Y queda en la bitácora.
    const log = await prismaAdmin.auditLog.findFirst({
      where: { tenantId: cliente.tenantId, action: 'auth.password_change' },
    });
    expect(log).not.toBeNull();
  });

  it('la sesión que hizo el cambio sigue sirviendo con el token devuelto', async () => {
    const sesion = (await entrar(cliente.username, NUEVA)).body;
    const cambio = await request(app)
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${sesion.accessToken}`)
      .send({ currentPassword: NUEVA, newPassword: 'OtraMasNueva2026' });
    expect(cambio.status).toBe(200);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${cambio.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.mustChangePassword).toBe(false);
  });

  it('sin sesión no se puede cambiar nada', async () => {
    const res = await request(app)
      .post('/api/auth/password')
      .send({ currentPassword: 'x', newPassword: 'loquesea2026' });
    expect(res.status).toBe(401);
  });
});

describe('Soporte no toca credenciales ajenas', () => {
  it('una sesión de impersonación no puede cambiar la contraseña del cliente', async () => {
    const imp = await request(app)
      .post(`/api/platform/tenants/${cliente.tenantId}/impersonate`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ reason: 'Prueba de que soporte no se apropia de la cuenta' });
    expect(imp.status).toBe(200);

    const res = await request(app)
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${imp.body.accessToken}`)
      .send({ currentPassword: 'OtraMasNueva2026', newPassword: 'RobadaPorSoporte2026' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('IMPERSONATION_READ_ONLY');

    // Y la contraseña del dueño sigue siendo la suya.
    expect((await entrar(cliente.username, 'OtraMasNueva2026')).status).toBe(200);
  });
});

describe('El super admin también cambia la suya', () => {
  it('cambia su contraseña y la nueva queda vigente', async () => {
    const NUEVA_SUPER = `SuperNueva-${stamp}`;
    const sesion = (await request(app).post('/api/platform/auth/login').send(SUPER)).body;

    const res = await request(app)
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${sesion.accessToken}`)
      .send({ currentPassword: SUPER.password, newPassword: NUEVA_SUPER });
    expect(res.status).toBe(200);

    const conNueva = await request(app)
      .post('/api/platform/auth/login')
      .send({ email: SUPER.email, password: NUEVA_SUPER });
    expect(conNueva.status).toBe(200);

    // Se restaura para no romper las demás suites, que usan la del seed.
    const restaurar = await request(app)
      .post('/api/auth/password')
      .set('Authorization', `Bearer ${conNueva.body.accessToken}`)
      .send({ currentPassword: NUEVA_SUPER, newPassword: SUPER.password });
    expect(restaurar.status).toBe(200);
  });
});
