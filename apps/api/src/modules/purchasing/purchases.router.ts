import { Router } from 'express';
import {
  PERMISSIONS,
  purchaseCreateSchema,
  purchasesListQuerySchema,
  voidPurchaseSchema,
} from '@minimarket/shared';
import { assertStoreAccess } from '../../lib/store-access.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { createPurchase, getPurchase, listPurchases, voidPurchase } from './purchases.service.js';

// Todo el módulo exige purchases.receive: las compras contienen costos,
// que un WORKER no debe ver (CLAUDE.md A10).
export const purchasesRouter = Router();
purchasesRouter.use(requireAuth, requirePermission(PERMISSIONS.PURCHASES_RECEIVE));

purchasesRouter.get('/', async (req, res) => {
  const query = purchasesListQuerySchema.parse(req.query);
  assertStoreAccess(req.memberships!, query.storeId);
  res.json(await listPurchases(req.db!, query));
});

purchasesRouter.get('/:id', async (req, res) => {
  const purchase = await getPurchase(req.db!, req.params.id as string);
  assertStoreAccess(req.memberships!, purchase.storeId);
  res.json(purchase);
});

purchasesRouter.post('/', validate(purchaseCreateSchema), async (req, res) => {
  assertStoreAccess(req.memberships!, req.body.storeId);
  res
    .status(201)
    .json(await createPurchase(req.auth!.tenantId!, req.auth!.userId, req.body, req));
});

purchasesRouter.post('/:id/void', validate(voidPurchaseSchema), async (req, res) => {
  const purchase = await getPurchase(req.db!, req.params.id as string);
  assertStoreAccess(req.memberships!, purchase.storeId);
  res.json(
    await voidPurchase(
      req.auth!.tenantId!,
      req.auth!.userId,
      req.params.id as string,
      req.body.reason,
      req,
    ),
  );
});
