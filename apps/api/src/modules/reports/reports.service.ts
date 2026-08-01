/**
 * Reportes (CLAUDE.md §6 y requisitos de reportería).
 *
 * Reglas que este módulo respeta:
 *  - TODO corre dentro de withTenantTx → RLS garantiza el aislamiento aunque
 *    un filtro se olvide; además cada consulta filtra por las tiendas que el
 *    usuario puede ver (resueltas desde sus membresías, nunca desde el query).
 *  - Las cifras salen de los LEDGERS (kardex, caja, líneas de venta), nunca de
 *    campos calculados al vuelo: por eso los tests de reconciliación cuadran.
 *  - Fechas: el negocio opera en America/Guatemala (UTC-6, sin DST). Los
 *    timestamps se guardan en UTC, así que el bucketing por día convierte
 *    explícitamente con AT TIME ZONE — un corte de caja de las 23:30 pertenece
 *    a su día local, no al siguiente día UTC.
 *  - Dinero: BigInt en centavos de principio a fin.
 */
import { Prisma } from '@prisma/client';
import { withTenantTx } from '../../lib/prisma.js';

const TZ = 'America/Guatemala';

export interface RangeParams {
  storeIds: string[]; // tiendas visibles para el usuario (ya autorizadas)
  from: string; // YYYY-MM-DD (día local inclusive)
  to: string; // YYYY-MM-DD (día local inclusive)
}

/** Límites del rango como timestamptz: [inicio del día `from`, inicio del día siguiente a `to`). */
function bounds(from: string, to: string) {
  return {
    start: Prisma.sql`(${from}::date)::timestamp AT TIME ZONE ${TZ}`,
    end: Prisma.sql`((${to}::date + 1)::timestamp AT TIME ZONE ${TZ})`,
  };
}

function storeFilter(column: Prisma.Sql, storeIds: string[]): Prisma.Sql {
  return Prisma.sql`${column} = ANY(${storeIds}::uuid[])`;
}

// ─────────────────────────── Dashboard ───────────────────────────

export interface DashboardTotals {
  salesCount: number;
  salesTotal: string;
  costTotal: string;
  profitTotal: string;
  voidedCount: number;
  voidedTotal: string;
  expensesTotal: string;
  purchasesTotal: string;
  ticketAverage: string;
}

export function getDashboard(tenantId: string, params: RangeParams, includeCosts: boolean) {
  const { start, end } = bounds(params.from, params.to);
  return withTenantTx(tenantId, async (tx) => {
    const [totals] = await tx.$queryRaw<
      {
        sales_count: number;
        sales_total: bigint;
        cost_total: bigint;
        voided_count: number;
        voided_total: bigint;
      }[]
    >(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE s.status = 'COMPLETED')::int AS sales_count,
        COALESCE(SUM(s.total) FILTER (WHERE s.status = 'COMPLETED'), 0)::bigint AS sales_total,
        COALESCE((
          SELECT ROUND(SUM(si.qty * si.unit_cost_at_sale))
          FROM sale_items si
          JOIN sales s2 ON s2.id = si.sale_id
          WHERE s2.status = 'COMPLETED'
            AND ${storeFilter(Prisma.sql`s2.store_id`, params.storeIds)}
            AND s2.created_at >= ${start} AND s2.created_at < ${end}
        ), 0)::bigint AS cost_total,
        COUNT(*) FILTER (WHERE s.status = 'VOIDED')::int AS voided_count,
        COALESCE(SUM(s.total) FILTER (WHERE s.status = 'VOIDED'), 0)::bigint AS voided_total
      FROM sales s
      WHERE ${storeFilter(Prisma.sql`s.store_id`, params.storeIds)}
        AND s.created_at >= ${start} AND s.created_at < ${end}`);

    const [expenses] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM expenses
      WHERE ${storeFilter(Prisma.sql`store_id`, params.storeIds)}
        AND expensed_at >= ${start} AND expensed_at < ${end}`);

    const [purchases] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT COALESCE(SUM(total), 0)::bigint AS total FROM purchases
      WHERE status = 'RECEIVED' AND ${storeFilter(Prisma.sql`store_id`, params.storeIds)}
        AND purchased_at >= ${start} AND purchased_at < ${end}`);

    const series = await tx.$queryRaw<
      { day: Date; sales_count: number; sales_total: bigint; profit_total: bigint }[]
    >(Prisma.sql`
      SELECT
        (s.created_at AT TIME ZONE ${TZ})::date AS day,
        COUNT(DISTINCT s.id)::int AS sales_count,
        COALESCE(SUM(si.line_total), 0)::bigint AS sales_total,
        COALESCE(ROUND(SUM(si.line_total - si.qty * si.unit_cost_at_sale)), 0)::bigint AS profit_total
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.id
      WHERE s.status = 'COMPLETED'
        AND ${storeFilter(Prisma.sql`s.store_id`, params.storeIds)}
        AND s.created_at >= ${start} AND s.created_at < ${end}
      GROUP BY 1 ORDER BY 1`);

    const salesTotal = totals?.sales_total ?? 0n;
    const costTotal = totals?.cost_total ?? 0n;
    const count = totals?.sales_count ?? 0;

    const result: DashboardTotals & { series: unknown[] } = {
      salesCount: count,
      salesTotal: salesTotal.toString(),
      costTotal: includeCosts ? costTotal.toString() : '0',
      profitTotal: includeCosts ? (salesTotal - costTotal).toString() : '0',
      voidedCount: totals?.voided_count ?? 0,
      voidedTotal: (totals?.voided_total ?? 0n).toString(),
      expensesTotal: (expenses?.total ?? 0n).toString(),
      purchasesTotal: includeCosts ? (purchases?.total ?? 0n).toString() : '0',
      ticketAverage: count > 0 ? (salesTotal / BigInt(count)).toString() : '0',
      series: series.map((r) => ({
        day: r.day.toISOString().slice(0, 10),
        salesCount: r.sales_count,
        salesTotal: r.sales_total.toString(),
        ...(includeCosts ? { profitTotal: r.profit_total.toString() } : {}),
      })),
    };
    return result;
  });
}

// ─────────────────────── Utilidades por producto ───────────────────────

export function getProfitByProduct(tenantId: string, params: RangeParams) {
  const { start, end } = bounds(params.from, params.to);
  return withTenantTx(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<
      {
        product_id: string;
        name: string;
        sku: string;
        category: string | null;
        qty: string;
        revenue: bigint;
        cost: bigint;
        profit: bigint;
      }[]
    >(Prisma.sql`
      SELECT p.id AS product_id, p.name, p.sku, c.name AS category,
             SUM(si.qty)::text AS qty,
             SUM(si.line_total)::bigint AS revenue,
             ROUND(SUM(si.qty * si.unit_cost_at_sale))::bigint AS cost,
             ROUND(SUM(si.line_total - si.qty * si.unit_cost_at_sale))::bigint AS profit
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE s.status = 'COMPLETED'
        AND ${storeFilter(Prisma.sql`s.store_id`, params.storeIds)}
        AND s.created_at >= ${start} AND s.created_at < ${end}
      GROUP BY p.id, p.name, p.sku, c.name
      ORDER BY profit DESC`);

    return rows.map((r) => {
      const revenue = r.revenue;
      return {
        productId: r.product_id,
        name: r.name,
        sku: r.sku,
        category: r.category,
        qty: r.qty,
        revenue: revenue.toString(),
        cost: r.cost.toString(),
        profit: r.profit.toString(),
        // Margen bruto sobre venta, en puntos porcentuales con 1 decimal.
        marginPct: revenue > 0n ? Number((r.profit * 1000n) / revenue) / 10 : 0,
      };
    });
  });
}

// ─────────────────────────── Ventas ───────────────────────────

export type SalesGroupBy = 'day' | 'user' | 'category' | 'store' | 'product';

export function getSalesReport(
  tenantId: string,
  params: RangeParams,
  groupBy: SalesGroupBy,
  includeCosts: boolean,
) {
  const { start, end } = bounds(params.from, params.to);

  // Cada agrupación define su clave y etiqueta; el resto de la consulta es
  // idéntico, así que las cifras son consistentes entre vistas.
  const dimensions: Record<SalesGroupBy, { key: Prisma.Sql; label: Prisma.Sql; join: Prisma.Sql }> =
    {
      day: {
        key: Prisma.sql`(s.created_at AT TIME ZONE ${TZ})::date::text`,
        label: Prisma.sql`(s.created_at AT TIME ZONE ${TZ})::date::text`,
        join: Prisma.empty,
      },
      user: {
        key: Prisma.sql`u.id::text`,
        label: Prisma.sql`u.name`,
        join: Prisma.sql`JOIN users u ON u.id = s.user_id`,
      },
      category: {
        key: Prisma.sql`COALESCE(c.id::text, 'sin-categoria')`,
        label: Prisma.sql`COALESCE(c.name, 'Sin categoría')`,
        join: Prisma.sql`JOIN products p ON p.id = si.product_id
                         LEFT JOIN categories c ON c.id = p.category_id`,
      },
      store: {
        key: Prisma.sql`st.id::text`,
        label: Prisma.sql`st.name`,
        join: Prisma.sql`JOIN stores st ON st.id = s.store_id`,
      },
      product: {
        key: Prisma.sql`p.id::text`,
        label: Prisma.sql`p.name`,
        join: Prisma.sql`JOIN products p ON p.id = si.product_id`,
      },
    };
  const dim = dimensions[groupBy];

  return withTenantTx(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<
      { key: string; label: string; sales_count: number; total: bigint; profit: bigint }[]
    >(Prisma.sql`
      SELECT ${dim.key} AS key, ${dim.label} AS label,
             COUNT(DISTINCT s.id)::int AS sales_count,
             SUM(si.line_total)::bigint AS total,
             ROUND(SUM(si.line_total - si.qty * si.unit_cost_at_sale))::bigint AS profit
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.id
      ${dim.join}
      WHERE s.status = 'COMPLETED'
        AND ${storeFilter(Prisma.sql`s.store_id`, params.storeIds)}
        AND s.created_at >= ${start} AND s.created_at < ${end}
      GROUP BY 1, 2
      ORDER BY total DESC`);

    return rows.map((r) => ({
      key: r.key,
      label: r.label,
      salesCount: r.sales_count,
      total: r.total.toString(),
      ...(includeCosts ? { profit: r.profit.toString() } : {}),
    }));
  });
}

export function getVoidedSales(tenantId: string, params: RangeParams) {
  const { start, end } = bounds(params.from, params.to);
  return withTenantTx(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<
      {
        id: string;
        number: bigint;
        store: string;
        total: bigint;
        created_at: Date;
        voided_at: Date | null;
        void_reason: string | null;
        cashier: string | null;
        voided_by: string | null;
        authorized_by: string | null;
      }[]
    >(Prisma.sql`
      SELECT s.id, s.number, st.name AS store, s.total, s.created_at, s.voided_at, s.void_reason,
             cashier.name AS cashier, voider.name AS voided_by, auth.name AS authorized_by
      FROM sales s
      JOIN stores st ON st.id = s.store_id
      LEFT JOIN users cashier ON cashier.id = s.user_id
      LEFT JOIN users voider ON voider.id = s.voided_by
      LEFT JOIN users auth ON auth.id = s.void_authorized_by
      WHERE s.status = 'VOIDED'
        AND ${storeFilter(Prisma.sql`s.store_id`, params.storeIds)}
        AND s.voided_at >= ${start} AND s.voided_at < ${end}
      ORDER BY s.voided_at DESC`);

    return rows.map((r) => ({
      id: r.id,
      number: r.number.toString(),
      store: r.store,
      total: r.total.toString(),
      createdAt: r.created_at,
      voidedAt: r.voided_at,
      reason: r.void_reason,
      cashier: r.cashier,
      voidedBy: r.voided_by,
      authorizedBy: r.authorized_by,
    }));
  });
}

// ─────────────────────────── Gastos ───────────────────────────

export function getExpensesByCategory(tenantId: string, params: RangeParams) {
  const { start, end } = bounds(params.from, params.to);
  return withTenantTx(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<
      { category_id: string; category: string; count: number; total: bigint; from_cash: bigint }[]
    >(Prisma.sql`
      SELECT ec.id AS category_id, ec.name AS category,
             COUNT(*)::int AS count,
             SUM(e.amount)::bigint AS total,
             COALESCE(SUM(e.amount) FILTER (WHERE e.cash_session_id IS NOT NULL), 0)::bigint AS from_cash
      FROM expenses e
      JOIN expense_categories ec ON ec.id = e.category_id
      WHERE ${storeFilter(Prisma.sql`e.store_id`, params.storeIds)}
        AND e.expensed_at >= ${start} AND e.expensed_at < ${end}
      GROUP BY ec.id, ec.name
      ORDER BY total DESC`);

    return rows.map((r) => ({
      categoryId: r.category_id,
      category: r.category,
      count: r.count,
      total: r.total.toString(),
      fromCash: r.from_cash.toString(),
    }));
  });
}

// ─────────────────────────── Caja ───────────────────────────

export function getCashSessionsReport(tenantId: string, params: RangeParams) {
  const { start, end } = bounds(params.from, params.to);
  return withTenantTx(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<
      {
        id: string;
        store: string;
        register: string;
        status: string;
        opened_at: Date;
        closed_at: Date | null;
        opened_by: string | null;
        closed_by: string | null;
        opening_amount: bigint;
        expected_amount: bigint | null;
        counted_amount: bigint | null;
        difference: bigint | null;
        sales_in: bigint;
        withdrawals: bigint;
        expenses_out: bigint;
        sales_count: number;
      }[]
    >(Prisma.sql`
      SELECT cs.id, st.name AS store, cr.name AS register, cs.status::text,
             cs.opened_at, cs.closed_at,
             opener.name AS opened_by, closer.name AS closed_by,
             cs.opening_amount, cs.expected_amount, cs.counted_amount, cs.difference,
             COALESCE((SELECT SUM(cm.amount) FROM cash_movements cm
                       WHERE cm.cash_session_id = cs.id AND cm.type = 'SALE_IN'), 0)::bigint AS sales_in,
             COALESCE((SELECT SUM(-cm.amount) FROM cash_movements cm
                       WHERE cm.cash_session_id = cs.id AND cm.type = 'WITHDRAWAL'), 0)::bigint AS withdrawals,
             COALESCE((SELECT SUM(-cm.amount) FROM cash_movements cm
                       WHERE cm.cash_session_id = cs.id AND cm.type = 'EXPENSE_OUT'), 0)::bigint AS expenses_out,
             (SELECT COUNT(*) FROM sales s
              WHERE s.cash_session_id = cs.id AND s.status = 'COMPLETED')::int AS sales_count
      FROM cash_sessions cs
      JOIN stores st ON st.id = cs.store_id
      JOIN cash_registers cr ON cr.id = cs.cash_register_id
      LEFT JOIN users opener ON opener.id = cs.opened_by
      LEFT JOIN users closer ON closer.id = cs.closed_by
      WHERE ${storeFilter(Prisma.sql`cs.store_id`, params.storeIds)}
        AND cs.opened_at >= ${start} AND cs.opened_at < ${end}
      ORDER BY cs.opened_at DESC`);

    return rows.map((r) => ({
      id: r.id,
      store: r.store,
      register: r.register,
      status: r.status,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
      openedBy: r.opened_by,
      closedBy: r.closed_by,
      openingAmount: r.opening_amount.toString(),
      expectedAmount: r.expected_amount?.toString() ?? null,
      countedAmount: r.counted_amount?.toString() ?? null,
      difference: r.difference?.toString() ?? null,
      salesIn: r.sales_in.toString(),
      withdrawals: r.withdrawals.toString(),
      expensesOut: r.expenses_out.toString(),
      salesCount: r.sales_count,
    }));
  });
}

// ─────────────────────────── Inventario ───────────────────────────

export function getInventoryReport(
  tenantId: string,
  storeIds: string[],
  opts: { lowOnly: boolean },
  includeCosts: boolean,
) {
  return withTenantTx(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<
      {
        product_id: string;
        store: string;
        name: string;
        sku: string;
        category: string | null;
        unit: string;
        stock_qty: string;
        min_stock: string;
        avg_cost: bigint;
        stock_value: bigint;
        price: bigint;
        low: boolean;
      }[]
    >(Prisma.sql`
      SELECT sp.product_id, st.name AS store, p.name, p.sku, c.name AS category, un.code AS unit,
             sp.stock_qty::text, sp.min_stock::text, sp.avg_cost,
             ROUND(sp.stock_qty * sp.avg_cost)::bigint AS stock_value,
             COALESCE(sp.price_override, p.base_price) AS price,
             (sp.min_stock > 0 AND sp.stock_qty <= sp.min_stock) AS low
      FROM store_products sp
      JOIN products p ON p.id = sp.product_id
      JOIN stores st ON st.id = sp.store_id
      JOIN units un ON un.id = p.unit_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${storeFilter(Prisma.sql`sp.store_id`, storeIds)}
        AND sp.is_active AND p.deleted_at IS NULL
        ${opts.lowOnly ? Prisma.sql`AND sp.min_stock > 0 AND sp.stock_qty <= sp.min_stock` : Prisma.empty}
      ORDER BY low DESC, p.name ASC`);

    return rows.map((r) => ({
      productId: r.product_id,
      store: r.store,
      name: r.name,
      sku: r.sku,
      category: r.category,
      unit: r.unit,
      stockQty: r.stock_qty,
      minStock: r.min_stock,
      price: r.price.toString(),
      low: r.low,
      ...(includeCosts
        ? { avgCost: r.avg_cost.toString(), stockValue: r.stock_value.toString() }
        : {}),
    }));
  });
}

// ─────────────────────────── Compras ───────────────────────────

export function getPurchasesBySupplier(tenantId: string, params: RangeParams) {
  const { start, end } = bounds(params.from, params.to);
  return withTenantTx(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<
      {
        supplier_id: string;
        supplier: string;
        purchases_count: number;
        total: bigint;
        voided_count: number;
        last_purchase: Date | null;
      }[]
    >(Prisma.sql`
      SELECT sup.id AS supplier_id, sup.name AS supplier,
             COUNT(*) FILTER (WHERE pu.status = 'RECEIVED')::int AS purchases_count,
             COALESCE(SUM(pu.total) FILTER (WHERE pu.status = 'RECEIVED'), 0)::bigint AS total,
             COUNT(*) FILTER (WHERE pu.status = 'VOIDED')::int AS voided_count,
             MAX(pu.purchased_at) AS last_purchase
      FROM purchases pu
      JOIN suppliers sup ON sup.id = pu.supplier_id
      WHERE ${storeFilter(Prisma.sql`pu.store_id`, params.storeIds)}
        AND pu.purchased_at >= ${start} AND pu.purchased_at < ${end}
      GROUP BY sup.id, sup.name
      ORDER BY total DESC`);

    return rows.map((r) => ({
      supplierId: r.supplier_id,
      supplier: r.supplier,
      purchasesCount: r.purchases_count,
      total: r.total.toString(),
      voidedCount: r.voided_count,
      lastPurchase: r.last_purchase,
    }));
  });
}

// ───────────────────── Resumen financiero por tienda ─────────────────────

export function getFinancialSummary(tenantId: string, params: RangeParams) {
  const { start, end } = bounds(params.from, params.to);
  return withTenantTx(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<
      {
        store_id: string;
        store: string;
        sales_count: number;
        sales_total: bigint;
        cost_total: bigint;
        gross_profit: bigint;
        expenses_total: bigint;
        purchases_total: bigint;
        voided_total: bigint;
      }[]
    >(Prisma.sql`
      SELECT st.id AS store_id, st.name AS store,
        COALESCE(v.sales_count, 0)::int AS sales_count,
        COALESCE(v.sales_total, 0)::bigint AS sales_total,
        COALESCE(v.cost_total, 0)::bigint AS cost_total,
        COALESCE(v.sales_total - v.cost_total, 0)::bigint AS gross_profit,
        COALESCE(e.total, 0)::bigint AS expenses_total,
        COALESCE(pu.total, 0)::bigint AS purchases_total,
        COALESCE(v.voided_total, 0)::bigint AS voided_total
      FROM stores st
      LEFT JOIN (
        SELECT s.store_id,
               COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'COMPLETED') AS sales_count,
               COALESCE(SUM(si.line_total) FILTER (WHERE s.status = 'COMPLETED'), 0) AS sales_total,
               COALESCE(ROUND(SUM(si.qty * si.unit_cost_at_sale) FILTER (WHERE s.status = 'COMPLETED')), 0) AS cost_total,
               COALESCE(SUM(si.line_total) FILTER (WHERE s.status = 'VOIDED'), 0) AS voided_total
        FROM sales s JOIN sale_items si ON si.sale_id = s.id
        WHERE s.created_at >= ${start} AND s.created_at < ${end}
        GROUP BY s.store_id
      ) v ON v.store_id = st.id
      LEFT JOIN (
        SELECT store_id, SUM(amount) AS total FROM expenses
        WHERE expensed_at >= ${start} AND expensed_at < ${end}
        GROUP BY store_id
      ) e ON e.store_id = st.id
      LEFT JOIN (
        SELECT store_id, SUM(total) AS total FROM purchases
        WHERE status = 'RECEIVED' AND purchased_at >= ${start} AND purchased_at < ${end}
        GROUP BY store_id
      ) pu ON pu.store_id = st.id
      WHERE ${storeFilter(Prisma.sql`st.id`, params.storeIds)}
      ORDER BY sales_total DESC`);

    return rows.map((r) => ({
      storeId: r.store_id,
      store: r.store,
      salesCount: r.sales_count,
      salesTotal: r.sales_total.toString(),
      costTotal: r.cost_total.toString(),
      grossProfit: r.gross_profit.toString(),
      expensesTotal: r.expenses_total.toString(),
      purchasesTotal: r.purchases_total.toString(),
      voidedTotal: r.voided_total.toString(),
      // Resultado operativo del periodo: utilidad bruta menos gastos.
      netResult: (r.gross_profit - r.expenses_total).toString(),
    }));
  });
}

// ─────────────────────────── Auditoría ───────────────────────────

export function getAuditReport(
  tenantId: string,
  opts: {
    storeIds: string[];
    action?: string;
    userId?: string;
    from?: string;
    to?: string;
    page: number;
    criticalOnly: boolean;
    criticalActions: readonly string[];
  },
) {
  const PAGE_SIZE = 100;
  return withTenantTx(tenantId, async (tx) => {
    const conditions: Prisma.Sql[] = [
      // Las acciones sin tienda (login, cambios de catálogo) son del tenant:
      // RLS ya las acotó, así que se incluyen junto a las de tiendas visibles.
      Prisma.sql`(a.store_id IS NULL OR ${storeFilter(Prisma.sql`a.store_id`, opts.storeIds)})`,
    ];
    if (opts.action) conditions.push(Prisma.sql`a.action = ${opts.action}`);
    else if (opts.criticalOnly) {
      conditions.push(Prisma.sql`a.action = ANY(${[...opts.criticalActions]}::text[])`);
    }
    if (opts.userId) conditions.push(Prisma.sql`a.user_id = ${opts.userId}::uuid`);
    if (opts.from) {
      conditions.push(Prisma.sql`a.created_at >= (${opts.from}::date)::timestamp AT TIME ZONE ${TZ}`);
    }
    if (opts.to) {
      conditions.push(
        Prisma.sql`a.created_at < ((${opts.to}::date + 1)::timestamp AT TIME ZONE ${TZ})`,
      );
    }
    const where = Prisma.join(conditions, ' AND ');

    const rows = await tx.$queryRaw<
      {
        id: string;
        action: string;
        entity_type: string | null;
        entity_id: string | null;
        user_name: string | null;
        store: string | null;
        before: unknown;
        after: unknown;
        ip: string | null;
        created_at: Date;
      }[]
    >(Prisma.sql`
      SELECT a.id, a.action, a.entity_type, a.entity_id, u.name AS user_name, st.name AS store,
             a.before, a.after, a.ip::text, a.created_at
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN stores st ON st.id = a.store_id
      WHERE ${where}
      ORDER BY a.created_at DESC
      LIMIT ${PAGE_SIZE} OFFSET ${(opts.page - 1) * PAGE_SIZE}`);

    const [count] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS total FROM audit_logs a WHERE ${where}`);

    return {
      total: Number(count?.total ?? 0n),
      page: opts.page,
      pageSize: PAGE_SIZE,
      rows: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        user: r.user_name,
        store: r.store,
        before: r.before,
        after: r.after,
        ip: r.ip,
        createdAt: r.created_at,
      })),
    };
  });
}

// ──────────────── Agregados diarios (dashboard instantáneo) ────────────────

/**
 * Recalcula daily_store_stats para el rango, de forma idempotente (D-020):
 * borra y reinserta las filas del periodo desde los ledgers. Al ser un
 * recómputo completo, correrlo dos veces da el mismo resultado — no hay
 * "drift" posible entre el agregado y la fuente de verdad.
 */
export function refreshDailyStats(tenantId: string, params: RangeParams) {
  const { start, end } = bounds(params.from, params.to);
  return withTenantTx(tenantId, async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM daily_store_stats
      WHERE ${storeFilter(Prisma.sql`store_id`, params.storeIds)}
        AND day >= ${params.from}::date AND day <= ${params.to}::date`);

    const inserted = await tx.$executeRaw(Prisma.sql`
      INSERT INTO daily_store_stats
        (tenant_id, store_id, day, sales_count, sales_total, cost_total, profit_total,
         voided_count, expenses_total, purchases_total)
      SELECT ${tenantId}::uuid, d.store_id, d.day,
             COALESCE(d.sales_count, 0), COALESCE(d.sales_total, 0),
             COALESCE(d.cost_total, 0), COALESCE(d.sales_total - d.cost_total, 0),
             COALESCE(d.voided_count, 0),
             COALESCE(e.total, 0), COALESCE(pu.total, 0)
      FROM (
        SELECT s.store_id, (s.created_at AT TIME ZONE ${TZ})::date AS day,
               COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'COMPLETED') AS sales_count,
               COALESCE(SUM(si.line_total) FILTER (WHERE s.status = 'COMPLETED'), 0) AS sales_total,
               COALESCE(ROUND(SUM(si.qty * si.unit_cost_at_sale) FILTER (WHERE s.status = 'COMPLETED')), 0) AS cost_total,
               COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'VOIDED') AS voided_count
        FROM sales s JOIN sale_items si ON si.sale_id = s.id
        WHERE ${storeFilter(Prisma.sql`s.store_id`, params.storeIds)}
          AND s.created_at >= ${start} AND s.created_at < ${end}
        GROUP BY 1, 2
      ) d
      LEFT JOIN (
        SELECT store_id, (expensed_at AT TIME ZONE ${TZ})::date AS day, SUM(amount) AS total
        FROM expenses
        WHERE ${storeFilter(Prisma.sql`store_id`, params.storeIds)}
          AND expensed_at >= ${start} AND expensed_at < ${end}
        GROUP BY 1, 2
      ) e ON e.store_id = d.store_id AND e.day = d.day
      LEFT JOIN (
        SELECT store_id, (purchased_at AT TIME ZONE ${TZ})::date AS day, SUM(total) AS total
        FROM purchases
        WHERE status = 'RECEIVED'
          AND ${storeFilter(Prisma.sql`store_id`, params.storeIds)}
          AND purchased_at >= ${start} AND purchased_at < ${end}
        GROUP BY 1, 2
      ) pu ON pu.store_id = d.store_id AND pu.day = d.day`);

    return { days: inserted };
  });
}
