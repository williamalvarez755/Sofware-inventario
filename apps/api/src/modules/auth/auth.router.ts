import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginSchema, refreshSchema } from '@minimarket/shared';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { unauthorized } from '../../lib/errors.js';
import {
  loginTenantUser,
  revokeSession,
  rotateRefreshToken,
} from './auth.service.js';

export const authRouter = Router();

// Rate limit en memoria: suficiente con una instancia (D-020).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Demasiados intentos. Espere unos minutos.' } },
});

authRouter.post('/login', loginLimiter, validate(loginSchema), async (req, res) => {
  res.json(await loginTenantUser(req.body.email, req.body.password, req));
});

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
      select: { id: true, name: true, email: true, phone: true, mustChangePassword: true },
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
