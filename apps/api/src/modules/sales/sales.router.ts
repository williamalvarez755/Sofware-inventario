import { Router } from 'express';
import {
  PERMISSIONS,
  saleCreateSchema,
  salesListQuerySchema,
  voidSaleSchema,
} from '@minimarket/shared';
import { notFound } from '../../lib/errors.js';
import { assertStoreAccess } from '../../lib/store-access.js';
import { requireAuth } from '../../middleware/auth.js';
import { loadMemberships, requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { createSale, getReceipt, listSales, voidSale } from './sales.service.js';

export const salesRouter = Router();
salesRouter.use(requireAuth, loadMemberships);

salesRouter.post(
  '/',
  requirePermission(PERMISSIONS.SALES_CREATE),
  validate(saleCreateSchema),
  async (req, res) => {
    assertStoreAccess(req.memberships!, req.body.storeId);
    const result = await createSale(req.auth!.tenantId!, req.auth!.userId, req.body, req);
    const receipt = await getReceipt(req.db!, result.saleId);
    res.status(result.idempotent ? 200 : 201).json({ ...result, receipt });
  },
);

salesRouter.get('/', async (req, res) => {
  const query = salesListQuerySchema.parse(req.query);
  assertStoreAccess(req.memberships!, query.storeId);
  res.json(await listSales(req.db!, query));
});

salesRouter.get('/:id/receipt', async (req, res) => {
  const receipt = await getReceipt(req.db!, req.params.id as string);
  const sale = await req.db!.sale.findFirst({
    where: { id: req.params.id as string },
    select: { storeId: true },
  });
  if (!sale) throw notFound('Venta no encontrada');
  assertStoreAccess(req.memberships!, sale.storeId);
  res.json(receipt);
});

/** Anulación: admins directo; trabajadores con PIN de supervisor (en el servicio). */
salesRouter.post('/:id/void', validate(voidSaleSchema), async (req, res) => {
  res.json(
    await voidSale(
      req.auth!.tenantId!,
      req.auth!.userId,
      req.params.id as string,
      req.body,
      req.memberships!,
      req,
    ),
  );
});
