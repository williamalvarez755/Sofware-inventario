/**
 * Gastos (CLAUDE.md §6.2/§6.4): justificación obligatoria; si el gasto sale
 * de la caja abierta genera EXPENSE_OUT en el ledger de la sesión (impacta el
 * arqueo). El monto es inmutable — solo categoría/descripción se editan, con
 * auditoría antes/después. DELETE bloqueado por trigger.
 */
import { v7 as uuidv7 } from 'uuid';
import type { Request } from 'express';
import type { ExpenseCreateInput } from '@minimarket/shared';
import { AppError, notFound } from '../../lib/errors.js';
import { withTenantTx, type TenantClient } from '../../lib/prisma.js';
import { audit } from '../audit/audit.service.js';
import {
  insertCashMovement,
  lockOpenSession,
  sessionExpectedAmount,
} from '../cash/cash.service.js';

export function createExpense(
  tenantId: string,
  userId: string,
  input: ExpenseCreateInput,
  req: Request,
) {
  return withTenantTx(tenantId, async (tx) => {
    const category = await tx.expenseCategory.findFirst({
      where: { id: input.categoryId, deletedAt: null },
    });
    if (!category) throw notFound('Categoría de gasto no encontrada');

    const expenseId = uuidv7();

    if (input.cashSessionId) {
      const session = await lockOpenSession(tx, input.cashSessionId);
      if (session.storeId !== input.storeId) {
        throw new AppError(409, 'SESSION_STORE_MISMATCH', 'La sesión de caja es de otra tienda');
      }
      const available = await sessionExpectedAmount(tx, input.cashSessionId);
      if (available < BigInt(input.amount)) {
        throw new AppError(409, 'INSUFFICIENT_CASH', 'No hay suficiente efectivo en caja');
      }
    }

    const expense = await tx.expense.create({
      data: {
        id: expenseId,
        tenantId,
        storeId: input.storeId,
        categoryId: input.categoryId,
        cashSessionId: input.cashSessionId ?? null,
        userId,
        amount: BigInt(input.amount),
        description: input.description,
      },
    });

    if (input.cashSessionId) {
      await insertCashMovement(tx, {
        tenantId,
        storeId: input.storeId,
        cashSessionId: input.cashSessionId,
        type: 'EXPENSE_OUT',
        amount: -BigInt(input.amount),
        userId,
        reason: `${category.name}: ${input.description}`,
        refType: 'expense',
        refId: expenseId,
      });
    }

    await audit(tx, {
      tenantId,
      storeId: input.storeId,
      userId,
      action: 'expense.create',
      entityType: 'expense',
      entityId: expenseId,
      after: {
        category: category.name,
        amount: input.amount,
        description: input.description,
        fromCash: Boolean(input.cashSessionId),
      },
    }, req);
    return expense;
  });
}

export function updateExpense(
  tenantId: string,
  userId: string,
  expenseId: string,
  input: { categoryId?: string; description?: string },
  req: Request,
) {
  return withTenantTx(tenantId, async (tx) => {
    const before = await tx.expense.findFirst({ where: { id: expenseId } });
    if (!before) throw notFound('Gasto no encontrado');
    if (input.categoryId) {
      const category = await tx.expenseCategory.findFirst({
        where: { id: input.categoryId, deletedAt: null },
      });
      if (!category) throw notFound('Categoría de gasto no encontrada');
    }
    const updated = await tx.expense.update({
      where: { id: expenseId },
      data: {
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
        ...(input.description ? { description: input.description } : {}),
      },
    });
    await audit(tx, {
      tenantId,
      storeId: before.storeId,
      userId,
      action: 'expense.update',
      entityType: 'expense',
      entityId: expenseId,
      before: { categoryId: before.categoryId, description: before.description },
      after: { categoryId: updated.categoryId, description: updated.description },
    }, req);
    return updated;
  });
}

export async function listExpenses(
  db: TenantClient,
  opts: { storeId: string; categoryId?: string; page: number },
) {
  const PAGE_SIZE = 50;
  const where = {
    storeId: opts.storeId,
    ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
  };
  const [rows, total] = await Promise.all([
    db.expense.findMany({
      where,
      orderBy: { expensedAt: 'desc' },
      skip: (opts.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { category: { select: { id: true, name: true } } },
    }),
    db.expense.count({ where }),
  ]);
  return { total, page: opts.page, pageSize: PAGE_SIZE, rows };
}
