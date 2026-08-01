import { Router } from 'express';
import { v7 as uuidv7 } from 'uuid';
import { PERMISSIONS, supplierSchema, supplierUpdateSchema } from '@minimarket/shared';
import { AppError, notFound } from '../../lib/errors.js';
import { withTenantTx } from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../audit/audit.service.js';

export const suppliersRouter = Router();
suppliersRouter.use(requireAuth, requirePermission(PERMISSIONS.SUPPLIERS_MANAGE));

suppliersRouter.get('/', async (req, res) => {
  const search = String(req.query.search ?? '').trim();
  res.json(
    await req.db!.supplier.findMany({
      where: {
        deletedAt: null,
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
      include: { _count: { select: { purchases: true } } },
    }),
  );
});

/** Ficha: datos + productos que suministra con último costo. */
suppliersRouter.get('/:id', async (req, res) => {
  const supplier = await req.db!.supplier.findFirst({
    where: { id: req.params.id as string, deletedAt: null },
    include: {
      productLinks: {
        include: { product: { select: { id: true, name: true, sku: true } } },
        orderBy: { lastPurchaseAt: 'desc' },
      },
    },
  });
  if (!supplier) throw notFound('Proveedor no encontrado');
  res.json(supplier);
});

suppliersRouter.post('/', validate(supplierSchema), async (req, res) => {
  const tenantId = req.auth!.tenantId!;
  const supplier = await withTenantTx(tenantId, async (tx) => {
    const created = await tx.supplier.create({
      data: { id: uuidv7(), tenantId, ...req.body },
    });
    await audit(tx, {
      tenantId,
      userId: req.auth!.userId,
      action: 'supplier.create',
      entityType: 'supplier',
      entityId: created.id,
      after: { name: created.name },
    }, req);
    return created;
  });
  res.status(201).json(supplier);
});

suppliersRouter.patch('/:id', validate(supplierUpdateSchema), async (req, res) => {
  const tenantId = req.auth!.tenantId!;
  const id = req.params.id as string;
  const supplier = await withTenantTx(tenantId, async (tx) => {
    const before = await tx.supplier.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('Proveedor no encontrado');
    const updated = await tx.supplier.update({ where: { id }, data: req.body });
    await audit(tx, {
      tenantId,
      userId: req.auth!.userId,
      action: 'supplier.update',
      entityType: 'supplier',
      entityId: id,
      before: { name: before.name, isActive: before.isActive },
      after: { name: updated.name, isActive: updated.isActive },
    }, req);
    return updated;
  });
  res.json(supplier);
});

/** Sin compras: soft delete. Con historial: solo puede inactivarse. */
suppliersRouter.delete('/:id', async (req, res) => {
  const tenantId = req.auth!.tenantId!;
  const id = req.params.id as string;
  await withTenantTx(tenantId, async (tx) => {
    const purchases = await tx.purchase.count({ where: { supplierId: id } });
    if (purchases > 0) {
      throw new AppError(
        409,
        'SUPPLIER_HAS_PURCHASES',
        'El proveedor tiene compras registradas: inactívelo en lugar de eliminarlo',
      );
    }
    const updated = await tx.supplier.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (updated.count === 0) throw notFound('Proveedor no encontrado');
    await audit(tx, {
      tenantId,
      userId: req.auth!.userId,
      action: 'supplier.delete',
      entityType: 'supplier',
      entityId: id,
    }, req);
  });
  res.status(204).end();
});
