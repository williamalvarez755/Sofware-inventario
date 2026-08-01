/**
 * Módulo de plataforma (super admin). Usa prismaAdmin: opera POR ENCIMA de los
 * tenants (rol de conexión distinto, sin contexto RLS) y todo queda auditado.
 */
import { v7 as uuidv7 } from 'uuid';
import type { Request } from 'express';
import type { SubscriptionStatus, TenantStatus } from '@prisma/client';
import { AppError, notFound } from '../../lib/errors.js';
import { prismaAdmin } from '../../lib/prisma.js';
import { signAccessToken } from '../../lib/tokens.js';
import { invalidateTenantCache } from '../../middleware/auth.js';
import { audit } from '../audit/audit.service.js';

export async function listTenants() {
  const tenants = await prismaAdmin.tenant.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { stores: true, users: true } },
      subscriptions: {
        orderBy: { periodEnd: 'desc' },
        take: 1,
        include: { plan: { select: { code: true, name: true } } },
      },
    },
  });
  return tenants.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    suspendedReason: t.suspendedReason,
    stores: t._count.stores,
    users: t._count.users,
    subscription: t.subscriptions[0] ?? null,
    createdAt: t.createdAt,
  }));
}

export async function setTenantStatus(
  tenantId: string,
  status: TenantStatus,
  reason: string,
  platformUserId: string,
  req: Request,
) {
  const before = await prismaAdmin.tenant.findUnique({ where: { id: tenantId } });
  if (!before) throw notFound('Tenant no encontrado');

  const updated = await prismaAdmin.$transaction(async (tx) => {
    const tenant = await tx.tenant.update({
      where: { id: tenantId },
      data: { status, suspendedReason: status === 'ACTIVE' ? null : reason },
    });
    await audit(tx, {
      tenantId,
      platformUserId,
      action: 'platform.tenant_status',
      entityType: 'tenant',
      entityId: tenantId,
      before: { status: before.status, suspendedReason: before.suspendedReason },
      after: { status, reason },
    }, req);
    return tenant;
  });

  invalidateTenantCache(tenantId); // efecto inmediato, sin esperar el TTL
  return { id: updated.id, status: updated.status, suspendedReason: updated.suspendedReason };
}

// ─────────────────────── Ficha de un tenant ───────────────────────

export async function getTenantDetail(tenantId: string) {
  const tenant = await prismaAdmin.tenant.findUnique({
    where: { id: tenantId },
    include: {
      subscriptions: {
        orderBy: { periodEnd: 'desc' },
        include: { plan: { select: { code: true, name: true, maxStores: true, maxUsers: true } } },
      },
      stores: { select: { id: true, name: true, isActive: true, createdAt: true } },
      users: {
        select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!tenant) throw notFound('Tenant no encontrado');

  // Actividad real del negocio: lo que distingue a un cliente vivo de uno
  // que se dio de alta y nunca volvió.
  const [activity] = await prismaAdmin.$queryRaw<
    { sales_30d: number; sales_total_30d: bigint; last_sale: Date | null; products: number }[]
  >`
    SELECT
      COUNT(*) FILTER (WHERE s.created_at > now() - interval '30 days' AND s.status = 'COMPLETED')::int AS sales_30d,
      COALESCE(SUM(s.total) FILTER (WHERE s.created_at > now() - interval '30 days' AND s.status = 'COMPLETED'), 0)::bigint AS sales_total_30d,
      MAX(s.created_at) FILTER (WHERE s.status = 'COMPLETED') AS last_sale,
      (SELECT COUNT(*) FROM products p WHERE p.tenant_id = ${tenantId}::uuid AND p.deleted_at IS NULL)::int AS products
    FROM sales s WHERE s.tenant_id = ${tenantId}::uuid`;

  return {
    ...tenant,
    activity: {
      sales30d: activity?.sales_30d ?? 0,
      salesTotal30d: (activity?.sales_total_30d ?? 0n).toString(),
      lastSale: activity?.last_sale ?? null,
      products: activity?.products ?? 0,
    },
  };
}

// ─────────────────────────── Planes ───────────────────────────

export function listPlans() {
  return prismaAdmin.plan.findMany({
    orderBy: { monthlyPrice: 'asc' },
    include: { _count: { select: { subscriptions: true } } },
  });
}

export async function createPlan(
  input: { code: string; name: string; maxStores: number; maxUsers: number; monthlyPrice: number },
  platformUserId: string,
  req: Request,
) {
  const existing = await prismaAdmin.plan.findUnique({ where: { code: input.code } });
  if (existing) throw new AppError(409, 'PLAN_CODE_TAKEN', 'Ya existe un plan con ese código');

  const plan = await prismaAdmin.$transaction(async (tx) => {
    const created = await tx.plan.create({
      data: {
        id: uuidv7(),
        code: input.code,
        name: input.name,
        maxStores: input.maxStores,
        maxUsers: input.maxUsers,
        monthlyPrice: BigInt(input.monthlyPrice),
      },
    });
    await audit(tx, {
      platformUserId,
      action: 'platform.plan_create',
      entityType: 'plan',
      entityId: created.id,
      after: { code: created.code, monthlyPrice: created.monthlyPrice.toString() },
    }, req);
    return created;
  });
  return plan;
}

export async function updatePlan(
  planId: string,
  input: Partial<{ name: string; maxStores: number; maxUsers: number; monthlyPrice: number; isActive: boolean }>,
  platformUserId: string,
  req: Request,
) {
  const before = await prismaAdmin.plan.findUnique({ where: { id: planId } });
  if (!before) throw notFound('Plan no encontrado');

  return prismaAdmin.$transaction(async (tx) => {
    const updated = await tx.plan.update({
      where: { id: planId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.maxStores !== undefined ? { maxStores: input.maxStores } : {}),
        ...(input.maxUsers !== undefined ? { maxUsers: input.maxUsers } : {}),
        ...(input.monthlyPrice !== undefined ? { monthlyPrice: BigInt(input.monthlyPrice) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await audit(tx, {
      platformUserId,
      action: 'platform.plan_update',
      entityType: 'plan',
      entityId: planId,
      before: {
        name: before.name,
        maxStores: before.maxStores,
        monthlyPrice: before.monthlyPrice.toString(),
      },
      after: {
        name: updated.name,
        maxStores: updated.maxStores,
        monthlyPrice: updated.monthlyPrice.toString(),
      },
    }, req);
    return updated;
  });
}

// ─────────────────────── Suscripciones ───────────────────────

/**
 * Renueva/cambia la suscripción. El periodo arranca donde termina el vigente
 * (o hoy si ya venció), para que renovar temprano no regale ni quite días.
 */
export async function createSubscription(
  tenantId: string,
  input: {
    planCode: string;
    months: number;
    amount?: number;
    status: SubscriptionStatus;
    paymentNote?: string;
  },
  platformUserId: string,
  req: Request,
) {
  const [tenant, plan] = await Promise.all([
    prismaAdmin.tenant.findUnique({ where: { id: tenantId } }),
    prismaAdmin.plan.findUnique({ where: { code: input.planCode } }),
  ]);
  if (!tenant) throw notFound('Tenant no encontrado');
  if (!plan) throw notFound('Plan no encontrado');

  const current = await prismaAdmin.subscription.findFirst({
    where: { tenantId, status: { in: ['TRIAL', 'ACTIVE'] } },
    orderBy: { periodEnd: 'desc' },
  });
  const today = new Date();
  const start = current && current.periodEnd > today ? current.periodEnd : today;
  const end = new Date(start);
  end.setMonth(end.getMonth() + input.months);

  return prismaAdmin.$transaction(async (tx) => {
    const subscription = await tx.subscription.create({
      data: {
        id: uuidv7(),
        tenantId,
        planId: plan.id,
        status: input.status,
        periodStart: start,
        periodEnd: end,
        amount: BigInt(input.amount ?? Number(plan.monthlyPrice) * input.months),
        paymentNote: input.paymentNote ?? null,
        createdBy: platformUserId,
      },
      include: { plan: { select: { code: true, name: true } } },
    });

    // Registrar un pago reactiva al cliente que estaba suspendido por mora.
    if (tenant.status === 'SUSPENDED' && input.status === 'ACTIVE') {
      await tx.tenant.update({
        where: { id: tenantId },
        data: { status: 'ACTIVE', suspendedReason: null },
      });
      invalidateTenantCache(tenantId);
    }

    await audit(tx, {
      tenantId,
      platformUserId,
      action: 'platform.subscription_create',
      entityType: 'subscription',
      entityId: subscription.id,
      after: {
        plan: plan.code,
        months: input.months,
        amount: subscription.amount.toString(),
        status: input.status,
        periodEnd: end.toISOString().slice(0, 10),
      },
    }, req);
    return subscription;
  });
}

// ─────────────────────── Métricas globales ───────────────────────

export async function getGlobalMetrics() {
  const [tenants] = await prismaAdmin.$queryRaw<
    { total: number; active: number; suspended: number; cancelled: number }[]
  >`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
           COUNT(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended,
           COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled
    FROM tenants`;

  const [scale] = await prismaAdmin.$queryRaw<{ stores: number; users: number; products: number }[]>`
    SELECT (SELECT COUNT(*) FROM stores)::int AS stores,
           (SELECT COUNT(*) FROM users WHERE is_active)::int AS users,
           (SELECT COUNT(*) FROM products WHERE deleted_at IS NULL)::int AS products`;

  // Volumen transaccionado por los clientes: la métrica que dice si la
  // plataforma se está usando de verdad, no solo si hay altas.
  const [volume] = await prismaAdmin.$queryRaw<
    { sales_30d: number; volume_30d: bigint; sales_today: number }[]
  >`
    SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS sales_30d,
           COALESCE(SUM(total) FILTER (WHERE created_at > now() - interval '30 days'), 0)::bigint AS volume_30d,
           COUNT(*) FILTER (WHERE created_at > date_trunc('day', now()))::int AS sales_today
    FROM sales WHERE status = 'COMPLETED'`;

  // MRR: suma del precio mensual de los planes con suscripción vigente.
  const [mrr] = await prismaAdmin.$queryRaw<{ mrr: bigint; paying: number }[]>`
    SELECT COALESCE(SUM(p.monthly_price), 0)::bigint AS mrr, COUNT(*)::int AS paying
    FROM (
      SELECT DISTINCT ON (s.tenant_id) s.tenant_id, s.plan_id, s.status
      FROM subscriptions s
      JOIN tenants t ON t.id = s.tenant_id
      WHERE s.period_end >= CURRENT_DATE AND t.status = 'ACTIVE'
      ORDER BY s.tenant_id, s.period_end DESC
    ) vigentes
    JOIN plans p ON p.id = vigentes.plan_id
    WHERE vigentes.status = 'ACTIVE'`;

  // Clientes que requieren atención comercial.
  const attention = await prismaAdmin.$queryRaw<
    { id: string; name: string; slug: string; reason: string; period_end: Date | null }[]
  >`
    SELECT t.id, t.name, t.slug,
           CASE
             WHEN sub.period_end IS NULL THEN 'sin suscripción'
             WHEN sub.period_end < CURRENT_DATE THEN 'suscripción vencida'
             WHEN sub.period_end < CURRENT_DATE + 7 THEN 'vence esta semana'
             ELSE 'sin ventas en 14 días'
           END AS reason,
           sub.period_end
    FROM tenants t
    LEFT JOIN LATERAL (
      SELECT s.period_end FROM subscriptions s
      WHERE s.tenant_id = t.id ORDER BY s.period_end DESC LIMIT 1
    ) sub ON TRUE
    WHERE t.status = 'ACTIVE'
      AND (
        sub.period_end IS NULL
        OR sub.period_end < CURRENT_DATE + 7
        OR NOT EXISTS (
          SELECT 1 FROM sales sa
          WHERE sa.tenant_id = t.id AND sa.created_at > now() - interval '14 days'
        )
      )
    ORDER BY sub.period_end NULLS FIRST
    LIMIT 20`;

  return {
    tenants: tenants ?? { total: 0, active: 0, suspended: 0, cancelled: 0 },
    scale: scale ?? { stores: 0, users: 0, products: 0 },
    volume: {
      sales30d: volume?.sales_30d ?? 0,
      volume30d: (volume?.volume_30d ?? 0n).toString(),
      salesToday: volume?.sales_today ?? 0,
    },
    revenue: { mrr: (mrr?.mrr ?? 0n).toString(), payingTenants: mrr?.paying ?? 0 },
    needsAttention: attention.map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      reason: a.reason,
      periodEnd: a.period_end,
    })),
  };
}

// ─────────────────────── Auditoría global ───────────────────────

export async function getGlobalAudit(opts: {
  tenantId?: string;
  action?: string;
  page: number;
}) {
  const PAGE_SIZE = 100;
  const where = {
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
    ...(opts.action ? { action: opts.action } : {}),
  };
  const [rows, total] = await Promise.all([
    prismaAdmin.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (opts.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prismaAdmin.auditLog.count({ where }),
  ]);

  // Los nombres se resuelven aparte: audit_logs no tiene FKs (es append-only y
  // debe sobrevivir al borrado lógico de cualquier entidad).
  const tenantIds = [...new Set(rows.map((r) => r.tenantId).filter(Boolean))] as string[];
  const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];
  const platformIds = [...new Set(rows.map((r) => r.platformUserId).filter(Boolean))] as string[];
  const [tenants, users, admins] = await Promise.all([
    prismaAdmin.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }),
    prismaAdmin.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    prismaAdmin.platformUser.findMany({
      where: { id: { in: platformIds } },
      select: { id: true, name: true },
    }),
  ]);
  const tenantById = new Map(tenants.map((t) => [t.id, t.name]));
  const userById = new Map(users.map((u) => [u.id, u.name]));
  const adminById = new Map(admins.map((a) => [a.id, a.name]));

  return {
    total,
    page: opts.page,
    pageSize: PAGE_SIZE,
    rows: rows.map((r) => ({
      id: r.id,
      action: r.action,
      tenant: r.tenantId ? (tenantById.get(r.tenantId) ?? '—') : null,
      actor: r.platformUserId
        ? `${adminById.get(r.platformUserId) ?? 'Plataforma'} (plataforma)`
        : (userById.get(r.userId ?? '') ?? '—'),
      impersonating: r.impersonating,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
      ip: r.ip,
      createdAt: r.createdAt,
    })),
  };
}

// ─────────────────────── Impersonación (D-028) ───────────────────────

/**
 * "Ver como tenant": emite un token de SOLO LECTURA y vida corta (15 min) que
 * actúa como el dueño del negocio. No genera refresh token — cuando expira,
 * el super admin vuelve a pedirlo dejando otra huella en la bitácora.
 */
export async function impersonateTenant(
  tenantId: string,
  reason: string,
  platformUserId: string,
  req: Request,
) {
  const tenant = await prismaAdmin.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, status: true },
  });
  if (!tenant) throw notFound('Tenant no encontrado');

  const owner = await prismaAdmin.storeMember.findFirst({
    where: { tenantId, role: 'OWNER', isActive: true, user: { isActive: true } },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) {
    throw new AppError(
      409,
      'NO_OWNER',
      'El tenant no tiene un dueño activo al cual representar',
    );
  }

  await audit(prismaAdmin, {
    tenantId,
    platformUserId,
    impersonating: true,
    action: 'platform.impersonate',
    entityType: 'tenant',
    entityId: tenantId,
    after: { reason, asUser: owner.user.email },
  }, req);

  return {
    accessToken: signAccessToken(
      { sub: owner.user.id, kind: 'user', ten: tenantId, imp: platformUserId },
      15,
    ),
    tenant: { id: tenant.id, name: tenant.name, status: tenant.status },
    actingAs: { id: owner.user.id, name: owner.user.name, email: owner.user.email },
    readOnly: true,
    expiresInMinutes: 15,
  };
}
