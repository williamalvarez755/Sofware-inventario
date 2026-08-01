import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  impersonateSchema,
  loginSchema,
  planSchema,
  subscriptionSchema,
  tenantOnboardSchema,
  tenantStatusSchema,
} from '@minimarket/shared';
import { requirePlatformAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { loginPlatformUser } from '../auth/auth.service.js';
import { onboardTenant } from './onboarding.service.js';
import {
  createPlan,
  createSubscription,
  getGlobalAudit,
  getGlobalMetrics,
  getTenantDetail,
  impersonateTenant,
  listPlans,
  listTenants,
  setTenantStatus,
  updatePlan,
} from './platform.service.js';

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

// Todo lo que sigue exige sesión de super admin.
platformRouter.use(requirePlatformAuth);

// ─────────────────────────── Métricas ───────────────────────────

platformRouter.get('/metrics', async (_req, res) => {
  res.json(await getGlobalMetrics());
});

// ─────────────────────────── Tenants ───────────────────────────

platformRouter.get('/tenants', async (_req, res) => {
  res.json(await listTenants());
});

platformRouter.get('/tenants/:id', async (req, res) => {
  res.json(await getTenantDetail(req.params.id as string));
});

/** Onboarding completo: tenant + dueño + tienda + caja + suscripción. */
platformRouter.post('/tenants', validate(tenantOnboardSchema), async (req, res) => {
  res.status(201).json(await onboardTenant(req.body, req.auth!.userId, req));
});

platformRouter.patch('/tenants/:id/status', validate(tenantStatusSchema), async (req, res) => {
  res.json(
    await setTenantStatus(
      req.params.id as string,
      req.body.status,
      req.body.reason,
      req.auth!.userId,
      req,
    ),
  );
});

platformRouter.post(
  '/tenants/:id/subscriptions',
  validate(subscriptionSchema),
  async (req, res) => {
    res
      .status(201)
      .json(await createSubscription(req.params.id as string, req.body, req.auth!.userId, req));
  },
);

/** "Ver como tenant": token de solo lectura, 15 min, auditado (D-028). */
platformRouter.post('/tenants/:id/impersonate', validate(impersonateSchema), async (req, res) => {
  res.json(
    await impersonateTenant(req.params.id as string, req.body.reason, req.auth!.userId, req),
  );
});

// ─────────────────────────── Planes ───────────────────────────

platformRouter.get('/plans', async (_req, res) => {
  res.json(await listPlans());
});

platformRouter.post('/plans', validate(planSchema), async (req, res) => {
  res.status(201).json(await createPlan(req.body, req.auth!.userId, req));
});

platformRouter.patch('/plans/:id', validate(planSchema.partial()), async (req, res) => {
  res.json(await updatePlan(req.params.id as string, req.body, req.auth!.userId, req));
});

// ─────────────────────── Auditoría global ───────────────────────

platformRouter.get('/audit', async (req, res) => {
  res.json(
    await getGlobalAudit({
      tenantId: req.query.tenantId ? String(req.query.tenantId) : undefined,
      action: req.query.action ? String(req.query.action) : undefined,
      page: Math.max(1, Number(req.query.page ?? 1)),
    }),
  );
});
