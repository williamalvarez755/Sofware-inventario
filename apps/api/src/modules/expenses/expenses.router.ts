import { Router } from 'express';
import { v7 as uuidv7 } from 'uuid';
import {
  expenseCategorySchema,
  expenseCreateSchema,
  expensesListQuerySchema,
  expenseUpdateSchema,
  PERMISSIONS,
} from '@minimarket/shared';
import { withTenantTx } from '../../lib/prisma.js';
import { assertStoreAccess } from '../../lib/store-access.js';
import { requireAuth } from '../../middleware/auth.js';
import { loadMemberships, requirePermission } from '../../middleware/permissions.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../audit/audit.service.js';
import { createExpense, listExpenses, updateExpense } from './expenses.service.js';

export const expensesRouter = Router();
expensesRouter.use(requireAuth, loadMemberships);

// ── Categorías ───────────────────────────────────────────────────
expensesRouter.get('/categories', async (req, res) => {
  res.json(
    await req.db!.expenseCategory.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  );
});

expensesRouter.post(
  '/categories',
  requirePermission(PERMISSIONS.EXPENSE_CATEGORIES_MANAGE),
  validate(expenseCategorySchema),
  async (req, res) => {
    const tenantId = req.auth!.tenantId!;
    const category = await withTenantTx(tenantId, async (tx) => {
      const created = await tx.expenseCategory.create({
        data: { id: uuidv7(), tenantId, name: req.body.name },
      });
      await audit(tx, {
        tenantId,
        userId: req.auth!.userId,
        action: 'expense_category.create',
        entityType: 'expense_category',
        entityId: created.id,
        after: { name: created.name },
      }, req);
      return created;
    });
    res.status(201).json(category);
  },
);

// ── Gastos ───────────────────────────────────────────────────────
expensesRouter.get('/', async (req, res) => {
  const query = expensesListQuerySchema.parse(req.query);
  assertStoreAccess(req.memberships!, query.storeId);
  res.json(await listExpenses(req.db!, query));
});

expensesRouter.post(
  '/',
  requirePermission(PERMISSIONS.EXPENSES_CREATE),
  validate(expenseCreateSchema),
  async (req, res) => {
    assertStoreAccess(req.memberships!, req.body.storeId);
    res
      .status(201)
      .json(await createExpense(req.auth!.tenantId!, req.auth!.userId, req.body, req));
  },
);

expensesRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.EXPENSE_CATEGORIES_MANAGE),
  validate(expenseUpdateSchema),
  async (req, res) => {
    res.json(
      await updateExpense(req.auth!.tenantId!, req.auth!.userId, req.params.id as string, req.body, req),
    );
  },
);
