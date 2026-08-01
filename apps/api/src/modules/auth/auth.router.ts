import { Router } from 'express';
import { loginSchema, refreshSchema, twoFactorLoginSchema } from '@minimarket/shared';
import { requireAuth } from '../../middleware/auth.js';
import {
  authIpLimiter,
  passwordAttemptLimiter,
  twoFactorLimiter,
} from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { unauthorized } from '../../lib/errors.js';
import {
  completeTwoFactorLogin,
  loginTenantUser,
  revokeSession,
  rotateRefreshToken,
} from './auth.service.js';

export const authRouter = Router();

// Rate limit en memoria: suficiente con una instancia (D-020).
// Cubos separados por cuenta y por conexión — ver middleware/rate-limit.ts.
authRouter.post(
  '/login',
  authIpLimiter,
  passwordAttemptLimiter,
  validate(loginSchema),
  async (req, res) => {
    res.json(await loginTenantUser(req.body.identifier, req.body.password, req));
  },
);

/** Segundo paso del login cuando el usuario tiene 2FA activo. */
authRouter.post(
  '/2fa/login',
  twoFactorLimiter,
  validate(twoFactorLoginSchema),
  async (req, res) => {
    res.json(await completeTwoFactorLogin(req.body.challengeToken, req.body.code, req));
  },
);

authRouter.post('/refresh', validate(refreshSchema), async (req, res) => {
  res.json(await rotateRefreshToken(req.body.refreshToken, req));
});

authRouter.post('/logout', validate(refreshSchema), async (req, res) => {
  await revokeSession(req.body.refreshToken, req);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const db = req.db!;
  const { userId, tenantId } = req.auth!;
  const [user, tenant, memberships] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        phone: true,
        mustChangePassword: true,
      },
    }),
    db.tenant.findUnique({ where: { id: tenantId! }, select: { id: true, name: true } }),
    db.storeMember.findMany({
      where: { userId, isActive: true },
      select: { role: true, store: { select: { id: true, name: true } } },
    }),
  ]);
  if (!user) throw unauthorized();
  res.json({ user, tenant, memberships });
});
