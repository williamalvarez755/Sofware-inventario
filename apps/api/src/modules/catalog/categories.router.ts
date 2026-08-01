import { Router } from 'express';
import { v7 as uuidv7 } from 'uuid';
import { categorySchema, PERMISSIONS } from '@minimarket/shared';
import { AppError, notFound } from '../../lib/errors.js';
import { withTenantTx } from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../audit/audit.service.js';

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

categoriesRouter.get('/', async (req, res) => {
  res.json(
    await req.db!.category.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  );
});

categoriesRouter.post(
  '/',
  requirePermission(PERMISSIONS.PRODUCTS_MANAGE),
  validate(categorySchema),
  async (req, res) => {
    const tenantId = req.auth!.tenantId!;
    const category = await withTenantTx(tenantId, async (tx) => {
      const created = await tx.category.create({
        data: { id: uuidv7(), tenantId, name: req.body.name },
      });
      await audit(tx, {
        tenantId,
        userId: req.auth!.userId,
        action: 'category.create',
        entityType: 'category',
        entityId: created.id,
        after: { name: created.name },
      }, req);
      return created;
    });
    res.status(201).json(category);
  },
);

categoriesRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.PRODUCTS_MANAGE),
  async (req, res) => {
    const tenantId = req.auth!.tenantId!;
    const id = req.params.id as string;
    await withTenantTx(tenantId, async (tx) => {
      const inUse = await tx.product.count({ where: { categoryId: id, deletedAt: null } });
      if (inUse > 0) {
        throw new AppError(409, 'CATEGORY_IN_USE', `La categoría tiene ${inUse} producto(s)`);
      }
      const updated = await tx.category.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (updated.count === 0) throw notFound('Categoría no encontrada');
      await audit(tx, {
        tenantId,
        userId: req.auth!.userId,
        action: 'category.delete',
        entityType: 'category',
        entityId: id,
      }, req);
    });
    res.status(204).end();
  },
);
