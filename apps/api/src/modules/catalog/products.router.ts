import express, { Router } from 'express';
import { v7 as uuidv7 } from 'uuid';
import {
  barcodeSchema,
  PERMISSIONS,
  productCreateSchema,
  productListQuerySchema,
  productUpdateSchema,
  storeProductSchema,
} from '@minimarket/shared';
import { AppError, notFound } from '../../lib/errors.js';
import { withTenantTx } from '../../lib/prisma.js';
import { assertStoreAccess, canViewCosts } from '../../lib/store-access.js';
import { requireAuth } from '../../middleware/auth.js';
import { loadMemberships, requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import {
  assertBarcodeFree,
  createProduct,
  findByBarcode,
  getProduct,
  importProductsCsv,
  listProducts,
  updateProduct,
} from './products.service.js';

export const productsRouter = Router();
productsRouter.use(requireAuth, loadMemberships);

productsRouter.get('/', async (req, res) => {
  const query = productListQuerySchema.parse(req.query);
  if (query.storeId) assertStoreAccess(req.memberships!, query.storeId);
  res.json(await listProducts(req.db!, query, canViewCosts(req.memberships!)));
});

/**
 * Consulta por código escaneado. Va ANTES de `/:id` para que un código como
 * "barcode" no se interprete como identificador. Devuelve 404 cuando nadie lo
 * tiene: es la señal que usa la pantalla de productos para ofrecer el alta.
 */
productsRouter.get('/barcode/:code', async (req, res) => {
  const storeId = typeof req.query.storeId === 'string' ? req.query.storeId : undefined;
  if (storeId) assertStoreAccess(req.memberships!, storeId);
  const product = await findByBarcode(
    req.db!,
    String(req.params.code).trim(),
    storeId,
    canViewCosts(req.memberships!),
  );
  if (!product) throw notFound('Ningún producto tiene ese código');
  res.json(product);
});

productsRouter.get('/:id', async (req, res) => {
  res.json(await getProduct(req.db!, req.params.id as string, canViewCosts(req.memberships!)));
});

productsRouter.post(
  '/',
  requirePermission(PERMISSIONS.PRODUCTS_MANAGE),
  validate(productCreateSchema),
  async (req, res) => {
    if (req.body.initial) assertStoreAccess(req.memberships!, req.body.initial.storeId);
    const product = await createProduct(req.auth!.tenantId!, req.auth!.userId, req.body, req);
    res.status(201).json(product);
  },
);

productsRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.PRODUCTS_MANAGE),
  validate(productUpdateSchema),
  async (req, res) => {
    res.json(
      await updateProduct(req.auth!.tenantId!, req.auth!.userId, req.params.id as string, req.body, req),
    );
  },
);

productsRouter.post(
  '/:id/barcodes',
  requirePermission(PERMISSIONS.PRODUCTS_MANAGE),
  validate(barcodeSchema),
  async (req, res) => {
    const tenantId = req.auth!.tenantId!;
    const productId = req.params.id as string;
    const barcode = await withTenantTx(tenantId, async (tx) => {
      const product = await tx.product.findFirst({ where: { id: productId, deletedAt: null } });
      if (!product) throw notFound('Producto no encontrado');
      await assertBarcodeFree(tx, req.body.barcode);
      return tx.productBarcode.create({
        data: { id: uuidv7(), tenantId, productId, barcode: req.body.barcode },
      });
    });
    res.status(201).json(barcode);
  },
);

productsRouter.delete(
  '/:id/barcodes/:barcodeId',
  requirePermission(PERMISSIONS.PRODUCTS_MANAGE),
  async (req, res) => {
    const deleted = await req.db!.productBarcode.deleteMany({
      where: { id: req.params.barcodeId as string, productId: req.params.id as string },
    });
    if (deleted.count === 0) throw notFound('Código no encontrado');
    res.status(204).end();
  },
);

/** Configuración del producto EN una tienda: mínimo, precio override, activo. */
productsRouter.patch(
  '/:id/stores/:storeId',
  requirePermission(PERMISSIONS.PRODUCTS_MANAGE),
  validate(storeProductSchema),
  async (req, res) => {
    const storeId = req.params.storeId as string;
    const productId = req.params.id as string;
    assertStoreAccess(req.memberships!, storeId);
    const tenantId = req.auth!.tenantId!;
    const updated = await withTenantTx(tenantId, async (tx) => {
      await tx.$executeRaw`
        INSERT INTO store_products (id, tenant_id, store_id, product_id, updated_at)
        VALUES (${uuidv7()}::uuid, ${tenantId}::uuid, ${storeId}::uuid, ${productId}::uuid, now())
        ON CONFLICT (store_id, product_id) DO NOTHING`;
      return tx.storeProduct.update({
        where: { storeId_productId: { storeId, productId } },
        data: {
          ...(req.body.minStock !== undefined ? { minStock: req.body.minStock } : {}),
          ...(req.body.priceOverride !== undefined
            ? { priceOverride: req.body.priceOverride === null ? null : BigInt(req.body.priceOverride) }
            : {}),
          ...(req.body.isActive !== undefined ? { isActive: req.body.isActive } : {}),
        },
      });
    });
    res.json(updated);
  },
);

/** Importación CSV: body = texto CSV crudo. ?storeId= destino del stock inicial. */
productsRouter.post(
  '/import',
  requirePermission(PERMISSIONS.PRODUCTS_MANAGE),
  express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }),
  async (req, res) => {
    const storeId = String(req.query.storeId ?? '');
    if (!storeId) throw new AppError(400, 'VALIDATION', 'storeId es requerido');
    assertStoreAccess(req.memberships!, storeId);
    if (typeof req.body !== 'string' || !req.body.length) {
      throw new AppError(400, 'VALIDATION', 'Envíe el CSV como texto (Content-Type: text/csv)');
    }
    res.json(
      await importProductsCsv(req.auth!.tenantId!, req.auth!.userId, storeId, req.body, req),
    );
  },
);
