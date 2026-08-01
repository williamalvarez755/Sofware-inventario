import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginSchema, tenantStatusSchema } from '@minimarket/shared';
import { requirePlatformAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { loginPlatformUser } from '../auth/auth.service.js';
import { listTenants, setTenantStatus } from './platform.service.js';

export const platformRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Demasiados intentos.' } },
});

platformRouter.post('/auth/login', loginLimiter, validate(loginSchema), async (req, res) => {
  res.json(await loginPlatformUser(req.body.email, req.body.password, req));
});

platformRouter.get('/tenants', requirePlatformAuth, async (_req, res) => {
  res.json(await listTenants());
});

platformRouter.patch(
  '/tenants/:id/status',
  requirePlatformAuth,
  validate(tenantStatusSchema),
  async (req, res) => {
    res.json(
      await setTenantStatus(
        req.params.id as string,
        req.body.status,
        req.body.reason,
        req.auth!.userId,
        req,
      ),
    );
  },
);
