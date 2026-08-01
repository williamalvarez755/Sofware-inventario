import { Router } from 'express';
import { adjustmentSchema, kardexQuerySchema, PERMISSIONS } from '@minimarket/shared';
import { requireAuth } from '../../middleware/auth.js';
import { loadMemberships, requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { assertStoreAccess, canViewCosts } from '../../lib/store-access.js';
import { getKardex, getLowStock, registerAdjustment } from './inventory.service.js';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.post(
  '/adjustments',
  requirePermission(PERMISSIONS.INVENTORY_ADJUST),
  validate(adjustmentSchema),
  async (req, res) => {
    assertStoreAccess(req.memberships!, req.body.storeId);
    const result = await registerAdjustment(req.auth!.tenantId!, req.auth!.userId, req.body, req);
    res.status(201).json(result);
  },
);

inventoryRouter.get('/kardex', loadMemberships, async (req, res) => {
  const query = kardexQuerySchema.parse(req.query);
  assertStoreAccess(req.memberships!, query.storeId);
  res.json(
    await getKardex(
      req.db!,
      query.storeId,
      query.productId,
      query.page,
      canViewCosts(req.memberships!),
    ),
  );
});

inventoryRouter.get('/low-stock', loadMemberships, async (req, res) => {
  const storeId = String(req.query.storeId ?? '');
  assertStoreAccess(req.memberships!, storeId);
  res.json(await getLowStock(req.auth!.tenantId!, storeId));
});
