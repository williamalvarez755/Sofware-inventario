import { Router, type Request } from 'express';
import { twoFactorDisableSchema, twoFactorEnableSchema } from '@minimarket/shared';
import { unauthorized } from '../../lib/errors.js';
import { prismaAdmin } from '../../lib/prisma.js';
import { requireAuth, requirePlatformAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../audit/audit.service.js';
import {
  countRecoveryCodes,
  disableTwoFactor,
  enableTwoFactor,
  getTwoFactorRecord,
  startTwoFactorSetup,
  type Principal,
} from './twofactor.service.js';

/** Resuelve el principal (usuario de tenant o super admin) desde req.auth. */
async function principalOf(req: Request): Promise<Principal> {
  if (req.auth?.kind === 'platform') {
    const admin = await prismaAdmin.platformUser.findUnique({
      where: { id: req.auth.userId },
      select: { id: true, email: true },
    });
    if (!admin) throw unauthorized();
    return { kind: 'platform', id: admin.id, email: admin.email };
  }
  const user = await prismaAdmin.user.findUnique({
    where: { id: req.auth!.userId },
    select: { id: true, email: true, tenantId: true },
  });
  if (!user) throw unauthorized();
  return { kind: 'user', id: user.id, email: user.email, tenantId: user.tenantId };
}

function auditIds(principal: Principal) {
  return principal.kind === 'platform'
    ? { platformUserId: principal.id }
    : { userId: principal.id, tenantId: principal.tenantId };
}

/** Rutas compartidas por ambos tipos de principal. */
function buildRoutes(router: Router) {
  router.get('/status', async (req, res) => {
    const principal = await principalOf(req);
    const record = await getTwoFactorRecord(principal);
    res.json({
      enabled: Boolean(record.totpEnabledAt),
      enabledAt: record.totpEnabledAt,
      recoveryCodesLeft: record.totpEnabledAt ? await countRecoveryCodes(principal) : 0,
    });
  });

  router.post('/setup', async (req, res) => {
    const principal = await principalOf(req);
    res.json(await startTwoFactorSetup(principal));
  });

  router.post('/enable', validate(twoFactorEnableSchema), async (req, res) => {
    const principal = await principalOf(req);
    const result = await enableTwoFactor(principal, req.body.code);
    await audit(prismaAdmin, { ...auditIds(principal), action: 'auth.2fa_enabled' }, req);
    res.json(result);
  });

  router.post('/disable', validate(twoFactorDisableSchema), async (req, res) => {
    const principal = await principalOf(req);
    await disableTwoFactor(principal, req.body.password, req.body.code);
    await audit(prismaAdmin, { ...auditIds(principal), action: 'auth.2fa_disabled' }, req);
    res.status(204).end();
  });
}

export const twoFactorRouter = Router();
twoFactorRouter.use(requireAuth);
buildRoutes(twoFactorRouter);

export const platformTwoFactorRouter = Router();
platformTwoFactorRouter.use(requirePlatformAuth);
buildRoutes(platformTwoFactorRouter);
