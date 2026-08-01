import { Router } from 'express';
import { v7 as uuidv7 } from 'uuid';
import {
  cashTxSchema,
  closeSessionSchema,
  openSessionSchema,
  PERMISSIONS,
  registerCreateSchema,
} from '@minimarket/shared';
import { notFound } from '../../lib/errors.js';
import { withTenantTx } from '../../lib/prisma.js';
import { assertStoreAccess } from '../../lib/store-access.js';
import { requireAuth } from '../../middleware/auth.js';
import { loadMemberships, requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../audit/audit.service.js';
import {
  closeSession,
  getCurrentSession,
  getSessionDetail,
  openSession,
  registerCashTx,
} from './cash.service.js';

export const cashRouter = Router();
cashRouter.use(requireAuth, loadMemberships);

// ── Cajas registradoras ──────────────────────────────────────────
cashRouter.get('/registers', async (req, res) => {
  const storeId = String(req.query.storeId ?? '');
  assertStoreAccess(req.memberships!, storeId);
  res.json(
    await req.db!.cashRegister.findMany({
      where: { storeId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, storeId: true },
    }),
  );
});

cashRouter.post(
  '/registers',
  requirePermission(PERMISSIONS.STORES_MANAGE),
  validate(registerCreateSchema),
  async (req, res) => {
    assertStoreAccess(req.memberships!, req.body.storeId);
    const tenantId = req.auth!.tenantId!;
    const register = await withTenantTx(tenantId, async (tx) => {
      const created = await tx.cashRegister.create({
        data: { id: uuidv7(), tenantId, storeId: req.body.storeId, name: req.body.name },
      });
      await audit(tx, {
        tenantId,
        storeId: req.body.storeId,
        userId: req.auth!.userId,
        action: 'cash.register_create',
        entityType: 'cash_register',
        entityId: created.id,
        after: { name: created.name },
      }, req);
      return created;
    });
    res.status(201).json(register);
  },
);

// ── Sesiones ─────────────────────────────────────────────────────
cashRouter.get('/sessions/current', async (req, res) => {
  const registerId = String(req.query.registerId ?? '');
  const register = await req.db!.cashRegister.findFirst({ where: { id: registerId } });
  if (!register) throw notFound('Caja registradora no encontrada');
  assertStoreAccess(req.memberships!, register.storeId);
  res.json(await getCurrentSession(req.db!, registerId));
});

cashRouter.get('/sessions/:id', async (req, res) => {
  const detail = await getSessionDetail(req.db!, req.params.id as string);
  assertStoreAccess(req.memberships!, detail.storeId);
  res.json(detail);
});

cashRouter.post(
  '/sessions',
  requirePermission(PERMISSIONS.CASH_OPEN),
  validate(openSessionSchema),
  async (req, res) => {
    const register = await req.db!.cashRegister.findFirst({
      where: { id: req.body.cashRegisterId },
    });
    if (!register) throw notFound('Caja registradora no encontrada');
    assertStoreAccess(req.memberships!, register.storeId);
    res
      .status(201)
      .json(await openSession(req.auth!.tenantId!, req.auth!.userId, req.body, req));
  },
);

cashRouter.post(
  '/sessions/:id/close',
  requirePermission(PERMISSIONS.CASH_CLOSE),
  validate(closeSessionSchema),
  async (req, res) => {
    const detail = await getSessionDetail(req.db!, req.params.id as string);
    assertStoreAccess(req.memberships!, detail.storeId);
    res.json(
      await closeSession(req.auth!.tenantId!, req.auth!.userId, req.params.id as string, req.body, req),
    );
  },
);

cashRouter.post(
  '/sessions/:id/withdrawals',
  requirePermission(PERMISSIONS.CASH_WITHDRAW),
  validate(cashTxSchema),
  async (req, res) => {
    res.status(201).json(
      await registerCashTx(
        req.auth!.tenantId!,
        req.auth!.userId,
        req.params.id as string,
        'WITHDRAWAL',
        req.body,
        req.memberships!,
        req,
      ),
    );
  },
);

cashRouter.post(
  '/sessions/:id/deposits',
  requirePermission(PERMISSIONS.CASH_WITHDRAW),
  validate(cashTxSchema),
  async (req, res) => {
    res.status(201).json(
      await registerCashTx(
        req.auth!.tenantId!,
        req.auth!.userId,
        req.params.id as string,
        'DEPOSIT_IN',
        req.body,
        req.memberships!,
        req,
      ),
    );
  },
);
