/**
 * Caja (CLAUDE.md §6.2): sesiones por turno, ledger inmutable, arqueo al centavo.
 * expected = Σ cash_movements.amount de la sesión (apertura + entradas − salidas).
 * Los cierres toman FOR UPDATE sobre la sesión y las ventas toman FOR SHARE:
 * un cierre espera a las ventas en vuelo — el arqueo nunca pierde movimientos.
 */
import { v7 as uuidv7 } from 'uuid';
import type { Request } from 'express';
import type { CashMovementType, Prisma } from '@prisma/client';
import type { CashTxInput } from '@minimarket/shared';
import { roleHasPermission, type Role } from '@minimarket/shared';
import { AppError, notFound } from '../../lib/errors.js';
import { withTenantTx, type TenantClient } from '../../lib/prisma.js';
import { assertStoreAccess, type MembershipLike } from '../../lib/store-access.js';
import { audit } from '../audit/audit.service.js';
import { verifyAuthorizer } from '../auth/pin.service.js';

type Tx = Prisma.TransactionClient;

export async function insertCashMovement(
  tx: Tx,
  data: {
    tenantId: string;
    storeId: string;
    cashSessionId: string;
    type: CashMovementType;
    amount: bigint; // con signo
    userId: string;
    reason?: string;
    refType?: string;
    refId?: string;
    authorizedBy?: string;
  },
): Promise<void> {
  await tx.cashMovement.create({
    data: {
      id: uuidv7(),
      tenantId: data.tenantId,
      storeId: data.storeId,
      cashSessionId: data.cashSessionId,
      type: data.type,
      amount: data.amount,
      reason: data.reason ?? null,
      refType: data.refType ?? null,
      refId: data.refId ?? null,
      userId: data.userId,
      authorizedBy: data.authorizedBy ?? null,
    },
  });
}

export async function sessionExpectedAmount(tx: Tx, sessionId: string): Promise<bigint> {
  const rows = await tx.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(amount), 0)::bigint AS total
    FROM cash_movements WHERE cash_session_id = ${sessionId}::uuid`;
  return rows[0]?.total ?? 0n;
}

/** Bloquea la sesión en modo compartido y valida que siga OPEN (para ventas y movimientos). */
export async function lockOpenSession(
  tx: Tx,
  sessionId: string,
): Promise<{ id: string; storeId: string }> {
  const rows = await tx.$queryRaw<{ id: string; store_id: string; status: string }[]>`
    SELECT id, store_id, status FROM cash_sessions WHERE id = ${sessionId}::uuid FOR SHARE`;
  const session = rows[0];
  if (!session) throw notFound('Sesión de caja no encontrada');
  if (session.status !== 'OPEN') {
    throw new AppError(409, 'SESSION_CLOSED', 'La sesión de caja ya está cerrada');
  }
  return { id: session.id, storeId: session.store_id };
}

export function openSession(
  tenantId: string,
  userId: string,
  input: { cashRegisterId: string; openingAmount: number },
  req: Request,
) {
  return withTenantTx(tenantId, async (tx) => {
    const register = await tx.cashRegister.findFirst({
      where: { id: input.cashRegisterId, isActive: true },
    });
    if (!register) throw notFound('Caja registradora no encontrada');

    let session;
    try {
      session = await tx.cashSession.create({
        data: {
          id: uuidv7(),
          tenantId,
          storeId: register.storeId,
          cashRegisterId: register.id,
          openedBy: userId,
          openingAmount: BigInt(input.openingAmount),
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new AppError(409, 'SESSION_ALREADY_OPEN', 'Esta caja ya tiene una sesión abierta');
      }
      throw e;
    }
    await insertCashMovement(tx, {
      tenantId,
      storeId: register.storeId,
      cashSessionId: session.id,
      type: 'OPENING',
      amount: BigInt(input.openingAmount),
      userId,
      reason: 'Apertura de caja',
    });
    await audit(tx, {
      tenantId,
      storeId: register.storeId,
      userId,
      action: 'cash.open',
      entityType: 'cash_session',
      entityId: session.id,
      after: { openingAmount: input.openingAmount },
    }, req);
    return session;
  });
}

export function closeSession(
  tenantId: string,
  userId: string,
  sessionId: string,
  input: { countedAmount: number; countedDetail?: Record<string, number>; notes?: string },
  req: Request,
) {
  return withTenantTx(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; store_id: string; status: string }[]>`
      SELECT id, store_id, status FROM cash_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
    const row = rows[0];
    if (!row) throw notFound('Sesión de caja no encontrada');
    if (row.status !== 'OPEN') {
      throw new AppError(409, 'SESSION_CLOSED', 'La sesión ya fue cerrada');
    }

    const expected = await sessionExpectedAmount(tx, sessionId);
    const counted = BigInt(input.countedAmount);
    const difference = counted - expected;

    const session = await tx.cashSession.update({
      where: { id: sessionId },
      data: {
        status: 'CLOSED',
        closedBy: userId,
        closedAt: new Date(),
        expectedAmount: expected,
        countedAmount: counted,
        countedDetail: input.countedDetail ?? undefined,
        difference,
        notes: input.notes ?? null,
      },
    });
    await audit(tx, {
      tenantId,
      storeId: row.store_id,
      userId,
      action: 'cash.close',
      entityType: 'cash_session',
      entityId: sessionId,
      after: {
        expected: expected.toString(),
        counted: counted.toString(),
        difference: difference.toString(),
      },
    }, req);
    return session;
  });
}

/** Retiro (requiere autorización) o depósito de efectivo en la sesión. */
export function registerCashTx(
  tenantId: string,
  userId: string,
  sessionId: string,
  kind: 'WITHDRAWAL' | 'DEPOSIT_IN',
  input: CashTxInput,
  memberships: MembershipLike[],
  req: Request,
) {
  return withTenantTx(tenantId, async (tx) => {
    const session = await lockOpenSession(tx, sessionId);
    // El permiso dice QUÉ puede hacer; la membresía dice DÓNDE. Sin esta
    // comprobación, un encargado de una sucursal podría mover el efectivo de
    // otra con solo conocer el id de su sesión de caja.
    assertStoreAccess(memberships, session.storeId);

    let authorizedBy: string | undefined;
    if (kind === 'WITHDRAWAL') {
      const selfAuthorized = memberships.some(
        (m) =>
          (m.role === 'OWNER' || m.storeId === session.storeId) &&
          roleHasPermission(m.role as Role, 'cash.authorize'),
      );
      authorizedBy = selfAuthorized
        ? userId
        : await verifyAuthorizer(tx, {
            email: input.authorizerEmail,
            pin: input.authorizerPin,
            storeId: session.storeId,
            permission: 'cash.authorize',
          });

      const available = await sessionExpectedAmount(tx, sessionId);
      if (available < BigInt(input.amount)) {
        throw new AppError(409, 'INSUFFICIENT_CASH', 'No hay suficiente efectivo en caja');
      }
    }

    const amount = kind === 'WITHDRAWAL' ? -BigInt(input.amount) : BigInt(input.amount);
    await insertCashMovement(tx, {
      tenantId,
      storeId: session.storeId,
      cashSessionId: sessionId,
      type: kind,
      amount,
      userId,
      reason: input.reason,
      authorizedBy,
    });
    await audit(tx, {
      tenantId,
      storeId: session.storeId,
      userId,
      action: kind === 'WITHDRAWAL' ? 'cash.withdrawal' : 'cash.deposit',
      entityType: 'cash_session',
      entityId: sessionId,
      after: { amount: input.amount, reason: input.reason, authorizedBy },
    }, req);
    return { expectedAmount: (await sessionExpectedAmount(tx, sessionId)).toString() };
  });
}

/** Sesión abierta de una caja (o null) con su resumen para la barra del POS. */
export async function getCurrentSession(db: TenantClient, cashRegisterId: string) {
  const session = await db.cashSession.findFirst({
    where: { cashRegisterId, status: 'OPEN' },
  });
  if (!session) return null;
  return getSessionDetail(db, session.id);
}

export async function getSessionDetail(db: TenantClient, sessionId: string) {
  const session = await db.cashSession.findFirst({
    where: { id: sessionId },
    include: {
      register: { select: { id: true, name: true, storeId: true } },
      movements: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!session) throw notFound('Sesión de caja no encontrada');
  const expected = session.movements.reduce((acc, m) => acc + m.amount, 0n);
  const salesCount = await db.sale.count({
    where: { cashSessionId: sessionId, status: 'COMPLETED' },
  });
  return { ...session, expectedSoFar: expected.toString(), salesCount };
}
