/**
 * Revisión de seguridad automatizada (Fase 6).
 *
 * Estas pruebas existen para que las garantías no dependan de que alguien se
 * acuerde: cabeceras, no filtración de material de autenticación, ocultamiento
 * de costos, mensajes de error que no revelan de más y validación de entrada.
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

async function login(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return res.body.accessToken;
}

beforeAll(async () => {
  ownerToken = await login('owner1@demo.local');
  workerToken = await login('worker1@demo.local');
  // La tienda donde el trabajador SÍ es miembro (otras suites crean tiendas
  // sueltas en este tenant; tomar "la primera" sería no determinista).
  const worker = await prismaAdmin.user.findUniqueOrThrow({
    where: { email: 'worker1@demo.local' },
  });
  const membership = await prismaAdmin.storeMember.findFirstOrThrow({
    where: { userId: worker.id, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  storeId = membership.storeId;
});

describe('Cabeceras de seguridad', () => {
  it('envía CSP restrictiva, HSTS y anti-sniffing; oculta el motor del servidor', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('No filtración de material de autenticación', () => {
  it('el login no devuelve hashes, secretos de 2FA ni PIN', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner1@demo.local', password: PASSWORD });
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/\$argon2/);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('totpSecret');
    expect(body).not.toContain('supervisorPinHash');
  });

  it('/me no expone campos sensibles del usuario', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${ownerToken}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/\$argon2/);
    expect(body).not.toContain('totpSecret');
    expect(body).not.toContain('supervisorPinHash');
  });

  it('el rol de runtime NO puede leer material de autenticación', async () => {
    const forbidden = ['recovery_codes', 'refresh_tokens', 'platform_users', 'user_totp'];
    for (const table of forbidden) {
      const [row] = await prismaAdmin.$queryRawUnsafe<{ puede: boolean }[]>(
        `SELECT has_table_privilege('app_runtime', 'public.${table}', 'SELECT') AS puede`,
      );
      expect(row!.puede, `app_runtime no debe leer ${table}`).toBe(false);
    }
  });

  it('el runtime SÍ puede leer users normalmente (sin trampas por columna)', async () => {
    // D-033: el secreto vive en user_totp, así que `users` es una tabla normal
    // para el runtime — ninguna consulta futura se romperá por permisos.
    const [row] = await prismaAdmin.$queryRaw<{ puede: boolean }[]>`
      SELECT has_table_privilege('app_runtime', 'public.users', 'SELECT') AS puede`;
    expect(row!.puede).toBe(true);
  });
});

describe('Mensajes de error', () => {
  it('un identificador inválido da 400, no 500, y no revela el motor', async () => {
    const res = await request(app)
      .get('/api/products/no-es-un-uuid')
      .set('Authorization', `Bearer ${ownerToken}`);
    // Un escáner probando URLs al azar no debe generar "errores internos"
    expect(res.status).toBe(400);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/at .*\.ts:\d+/); // sin stack trace
    expect(body.toLowerCase()).not.toContain('prisma');
    expect(body.toLowerCase()).not.toContain('postgres');
  });

  it('el login fallido no distingue entre correo inexistente y contraseña mala', async () => {
    const noExiste = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nadie@ninguna-parte.gt', password: 'x' });
    const malaClave = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner1@demo.local', password: 'incorrecta' });
    expect(noExiste.status).toBe(malaClave.status);
    expect(noExiste.body.error.message).toBe(malaClave.body.error.message);
  });

  it('una ruta inexistente responde 404 sin pistas', async () => {
    const res = await request(app).get('/api/no-existe');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('Validación de entrada', () => {
  it('rechaza cuerpos malformados sin caerse', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "roto"');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('rechaza tipos inesperados en lugar de confiar en ellos', async () => {
    const res = await request(app)
      .post('/api/inventory/adjustments')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ storeId, productId: storeId, type: 'WASTE', qty: 'muchos', reason: 'prueba' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('un intento de inyección SQL se trata como texto, no como consulta', async () => {
    const payload = "'; DROP TABLE sales; --";
    const res = await request(app)
      .get(`/api/products?storeId=${storeId}&search=${encodeURIComponent(payload)}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    // La tabla sigue existiendo y con datos
    expect(await prismaAdmin.sale.count()).toBeGreaterThan(0);
  });

  it('limita el tamaño del cuerpo para no agotar memoria', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'a@b.gt', password: 'x'.repeat(2 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });
});

describe('Ocultamiento de costos al trabajador', () => {
  it('ningún endpoint devuelve costos ni utilidades a un WORKER', async () => {
    const endpoints = [
      `/api/products?storeId=${storeId}`,
      `/api/inventory/low-stock?storeId=${storeId}`,
    ];
    for (const path of endpoints) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${workerToken}`);
      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body, `${path} no debe exponer costos`).not.toContain('avgCost');
      expect(body).not.toContain('unitCost');
      expect(body).not.toContain('profit');
    }
  });

  it('el módulo de compras completo está cerrado para el WORKER', async () => {
    for (const path of ['/api/purchases?storeId=' + storeId, '/api/suppliers']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${workerToken}`);
      expect(res.status).toBe(403);
    }
  });
});

describe('Sesiones', () => {
  it('un token manipulado se rechaza', async () => {
    const [header, payload] = ownerToken.split('.');
    const forged = `${header}.${payload}.firmaInventada`;
    const res = await request(app).get('/api/stores').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('sin token no se accede a nada del negocio', async () => {
    for (const path of ['/api/stores', '/api/products', '/api/sales?storeId=' + storeId]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
  });

  it('desactivar a un empleado revoca sus sesiones al instante', async () => {
    const user = await prismaAdmin.user.findUniqueOrThrow({ where: { email: 'worker2@demo.local' } });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'worker2@demo.local', password: PASSWORD });
    const refreshToken = login.body.refreshToken;

    await prismaAdmin.user.update({ where: { id: user.id }, data: { isActive: false } });
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(401);

    await prismaAdmin.user.update({ where: { id: user.id }, data: { isActive: true } });
  });
});
