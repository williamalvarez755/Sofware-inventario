/**
 * 2FA TOTP. Lo importante que se prueba:
 *  - Activar exige probar un código real (nadie se queda fuera por un QR que
 *    nunca escaneó) y el secreto nunca sale del servidor sin cifrar.
 *  - El login queda en dos pasos y el token de desafío no sirve como acceso.
 *  - Los códigos de recuperación funcionan UNA vez — el tendero que pierde el
 *    teléfono no pierde su negocio.
 *  - Desactivar exige contraseña + segundo factor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import * as OTPAuth from 'otpauth';
import { createApp } from '../src/app.js';
import { prismaAdmin } from '../src/lib/prisma.js';

const app = createApp();
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo!2026';
const EMAIL = 'owner2@demo.local'; // tenant B: no interfiere con otras suites

let token: string;
let userId: string;

/** Genera el código válido en este instante, como haría la app del teléfono. */
function codeFor(secret: string, email: string, offsetSeconds = 0): string {
  return new OTPAuth.TOTP({
    issuer: 'MiniMarket',
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate({ timestamp: Date.now() + offsetSeconds * 1000 });
}

async function currentSecret(): Promise<string> {
  const row = await prismaAdmin.userTotp.findUniqueOrThrow({ where: { userId } });
  return row.secret;
}

async function login(password = PASSWORD) {
  return request(app).post('/api/auth/login').send({ email: EMAIL, password });
}

beforeAll(async () => {
  const user = await prismaAdmin.user.findUniqueOrThrow({ where: { email: EMAIL } });
  userId = user.id;
  // Estado limpio por si una corrida anterior dejó 2FA activo
  await prismaAdmin.userTotp.deleteMany({ where: { userId } });
  await prismaAdmin.recoveryCode.deleteMany({ where: { userId } });
  const res = await login();
  token = res.body.accessToken;
});

afterAll(async () => {
  await prismaAdmin.userTotp.deleteMany({ where: { userId } });
  await prismaAdmin.recoveryCode.deleteMany({ where: { userId } });
});

describe('Activación', () => {
  it('el setup entrega QR como data URL, sin mandar el secreto a terceros', async () => {
    const res = await request(app)
      .post('/api/auth/2fa/setup')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.qrDataUrl).toMatch(/^data:image\/png;base64,/); // generado local
    expect(res.body.otpauthUri).toContain('otpauth://totp/');
    expect(res.body.otpauthUri).toContain('MiniMarket');
    expect(res.body.secret).toMatch(/^[A-Z2-7]+$/); // base32

    // Aún NO está activo: el login sigue siendo de un paso
    const status = await request(app)
      .get('/api/auth/2fa/status')
      .set('Authorization', `Bearer ${token}`);
    expect(status.body.enabled).toBe(false);
    const stillOneStep = await login();
    expect(stillOneStep.body.accessToken).toBeTruthy();
  });

  it('rechaza activar con un código incorrecto', async () => {
    const res = await request(app)
      .post('/api/auth/2fa/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOTP_INVALID');
  });

  it('activa con un código real y entrega 8 códigos de recuperación', async () => {
    const secret = await currentSecret();
    const res = await request(app)
      .post('/api/auth/2fa/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: codeFor(secret, EMAIL) });
    expect(res.status).toBe(200);
    expect(res.body.recoveryCodes).toHaveLength(8);
    expect(res.body.recoveryCodes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

    // Se guardan hasheados, nunca en claro
    const stored = await prismaAdmin.recoveryCode.findMany({ where: { userId } });
    expect(stored).toHaveLength(8);
    expect(stored[0]!.codeHash).toMatch(/^\$argon2/);
    expect(stored.some((s) => res.body.recoveryCodes.includes(s.codeHash))).toBe(false);

    const log = await prismaAdmin.auditLog.findFirst({
      where: { action: 'auth.2fa_enabled', userId },
    });
    expect(log).not.toBeNull();
  });
});

describe('Login en dos pasos', () => {
  it('la contraseña sola ya no basta: devuelve un desafío, no una sesión', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.requiresTwoFactor).toBe(true);
    expect(res.body.challengeToken).toBeTruthy();
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();
  });

  it('el token de desafío NO sirve como token de acceso', async () => {
    const challenge = (await login()).body.challengeToken;
    const res = await request(app).get('/api/stores').set('Authorization', `Bearer ${challenge}`);
    expect(res.status).toBe(401);
  });

  it('completa el login con el código del teléfono', async () => {
    const secret = await currentSecret();
    const challenge = (await login()).body.challengeToken;
    const res = await request(app)
      .post('/api/auth/2fa/login')
      .send({ challengeToken: challenge, code: codeFor(secret, EMAIL) });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.recoveryCodesLeft).toBe(8);

    const stores = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(stores.status).toBe(200);
  });

  it('tolera relojes desfasados hasta ±30 s y rechaza más allá', async () => {
    const secret = await currentSecret();
    const ok = await request(app)
      .post('/api/auth/2fa/login')
      .send({
        challengeToken: (await login()).body.challengeToken,
        code: codeFor(secret, EMAIL, -30),
      });
    expect(ok.status).toBe(200);

    const tooFar = await request(app)
      .post('/api/auth/2fa/login')
      .send({
        challengeToken: (await login()).body.challengeToken,
        code: codeFor(secret, EMAIL, -300), // 5 minutos atrás
      });
    expect(tooFar.status).toBe(401);
  });

  it('un código incorrecto no abre sesión y queda en bitácora', async () => {
    const res = await request(app)
      .post('/api/auth/2fa/login')
      .send({ challengeToken: (await login()).body.challengeToken, code: '123456' });
    expect(res.status).toBe(401);
    const log = await prismaAdmin.auditLog.findFirst({
      where: { action: 'auth.login_2fa_failed', userId },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
  });
});

describe('Códigos de recuperación', () => {
  it('sirven para entrar y se consumen: el mismo código no funciona dos veces', async () => {
    // Se desactiva un momento para poder re-activar y capturar los códigos en
    // claro (solo se muestran una vez, como en producción).
    await prismaAdmin.userTotp.update({ where: { userId }, data: { enabledAt: null } });
    const secret = await currentSecret();
    const access = (await login()).body; // 2FA inactivo → sesión directa
    const enable = await request(app)
      .post('/api/auth/2fa/enable')
      .set('Authorization', `Bearer ${access.accessToken}`)
      .send({ code: codeFor(secret, EMAIL) });
    expect(enable.status).toBe(200);
    const recovery: string[] = enable.body.recoveryCodes;

    const first = await request(app)
      .post('/api/auth/2fa/login')
      .send({ challengeToken: (await login()).body.challengeToken, code: recovery[0]! });
    expect(first.status).toBe(200);
    expect(first.body.recoveryCodesLeft).toBe(7); // se consumió uno

    const reuse = await request(app)
      .post('/api/auth/2fa/login')
      .send({ challengeToken: (await login()).body.challengeToken, code: recovery[0]! });
    expect(reuse.status).toBe(401);

    // Otro código del lote sí funciona
    const second = await request(app)
      .post('/api/auth/2fa/login')
      .send({ challengeToken: (await login()).body.challengeToken, code: recovery[1]! });
    expect(second.status).toBe(200);
    expect(second.body.recoveryCodesLeft).toBe(6);
  });
});

describe('Desactivación', () => {
  it('exige contraseña Y segundo factor', async () => {
    const secret = await currentSecret();
    const session = await request(app)
      .post('/api/auth/2fa/login')
      .send({ challengeToken: (await login()).body.challengeToken, code: codeFor(secret, EMAIL) });
    const access = session.body.accessToken;

    const wrongPassword = await request(app)
      .post('/api/auth/2fa/disable')
      .set('Authorization', `Bearer ${access}`)
      .send({ password: 'incorrecta', code: codeFor(secret, EMAIL) });
    expect(wrongPassword.status).toBe(400);
    expect(wrongPassword.body.error.code).toBe('INVALID_PASSWORD');

    const wrongCode = await request(app)
      .post('/api/auth/2fa/disable')
      .set('Authorization', `Bearer ${access}`)
      .send({ password: PASSWORD, code: '000000' });
    expect(wrongCode.status).toBe(400);

    const ok = await request(app)
      .post('/api/auth/2fa/disable')
      .set('Authorization', `Bearer ${access}`)
      .send({ password: PASSWORD, code: codeFor(secret, EMAIL) });
    expect(ok.status).toBe(204);

    // Vuelve al login de un paso y no quedan códigos huérfanos
    const back = await login();
    expect(back.body.accessToken).toBeTruthy();
    expect(await prismaAdmin.recoveryCode.count({ where: { userId } })).toBe(0);
  });
});
