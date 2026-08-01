import { Router } from 'express';
import { PERMISSIONS, storeCreateSchema } from '@minimarket/shared';
import { requireAuth } from '../../middleware/auth.js';
import { loadMemberships, requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { createStore, listVisibleStores } from './stores.service.js';

export const storesRouter = Router();
storesRouter.use(requireAuth);

storesRouter.get('/', loadMemberships, async (req, res) => {
  res.json(await listVisibleStores(req.db!, req.memberships!));
});

storesRouter.post(
  '/',
  requirePermission(PERMISSIONS.STORES_MANAGE),
  validate(storeCreateSchema),
  async (req, res) => {
    const store = await createStore(req.auth!.tenantId!, req.auth!.userId, req.body, req);
    res.status(201).json(store);
  },
);
