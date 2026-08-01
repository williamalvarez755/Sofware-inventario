import { Router, type Request, type Response } from 'express';
import {
  auditQuerySchema,
  CRITICAL_ACTIONS,
  PERMISSIONS,
  reportRangeSchema,
  salesReportSchema,
} from '@minimarket/shared';
import { csvMoney, toCsv } from '../../lib/csv.js';
import { forbidden } from '../../lib/errors.js';
import { canViewCosts } from '../../lib/store-access.js';
import { requireAuth } from '../../middleware/auth.js';
import { loadMemberships, requirePermission } from '../../middleware/permissions.js';
import {
  getAuditReport,
  getCashSessionsReport,
  getDashboard,
  getExpensesByCategory,
  getFinancialSummary,
  getInventoryReport,
  getProfitByProduct,
  getPurchasesBySupplier,
  getSalesReport,
  getVoidedSales,
  refreshDailyStats,
} from './reports.service.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth, loadMemberships, requirePermission(PERMISSIONS.REPORTS_VIEW));

/**
 * Tiendas sobre las que el usuario puede reportar. El storeId del query solo
 * puede REDUCIR este conjunto, nunca ampliarlo: si pide una tienda ajena
 * recibe 403 en lugar de datos de otro. OWNER ve todas las del tenant.
 */
async function visibleStoreIds(req: Request, requested?: string): Promise<string[]> {
  const isOwner = req.memberships!.some((m) => m.role === 'OWNER');
  const allowed = isOwner
    ? (await req.db!.store.findMany({ select: { id: true } })).map((s) => s.id)
    : [...new Set(req.memberships!.map((m) => m.storeId))];

  if (requested) {
    if (!allowed.includes(requested)) throw forbidden('STORE_ACCESS_DENIED', 'No tiene acceso a esta tienda');
    return [requested];
  }
  return allowed;
}

function sendCsv(res: Response, filename: string, columns: { key: string; label: string }[], rows: Record<string, unknown>[]) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(columns, rows));
}

// ─────────────────────────── Dashboard ───────────────────────────

reportsRouter.get('/dashboard', async (req, res) => {
  const query = reportRangeSchema.parse(req.query);
  const storeIds = await visibleStoreIds(req, query.storeId);
  res.json(
    await getDashboard(
      req.auth!.tenantId!,
      { storeIds, from: query.from, to: query.to },
      canViewCosts(req.memberships!),
    ),
  );
});

// ─────────────────────── Utilidades por producto ───────────────────────

reportsRouter.get('/profit-by-product', async (req, res) => {
  const query = reportRangeSchema.parse(req.query);
  if (!canViewCosts(req.memberships!)) {
    throw forbidden('PERMISSION_DENIED', 'No tiene permiso para ver costos ni utilidades');
  }
  const storeIds = await visibleStoreIds(req, query.storeId);
  const rows = await getProfitByProduct(req.auth!.tenantId!, {
    storeIds,
    from: query.from,
    to: query.to,
  });

  if (query.format === 'csv') {
    return sendCsv(
      res,
      `utilidades_${query.from}_${query.to}.csv`,
      [
        { key: 'sku', label: 'SKU' },
        { key: 'name', label: 'Producto' },
        { key: 'category', label: 'Categoría' },
        { key: 'qty', label: 'Cantidad vendida' },
        { key: 'revenue', label: 'Venta (Q)' },
        { key: 'cost', label: 'Costo (Q)' },
        { key: 'profit', label: 'Utilidad (Q)' },
        { key: 'marginPct', label: 'Margen %' },
      ],
      rows.map((r) => ({
        ...r,
        revenue: csvMoney(r.revenue),
        cost: csvMoney(r.cost),
        profit: csvMoney(r.profit),
      })),
    );
  }
  res.json(rows);
});

// ─────────────────────────── Ventas ───────────────────────────

reportsRouter.get('/sales', async (req, res) => {
  const query = salesReportSchema.parse(req.query);
  const storeIds = await visibleStoreIds(req, query.storeId);
  const includeCosts = canViewCosts(req.memberships!);
  const rows = await getSalesReport(
    req.auth!.tenantId!,
    { storeIds, from: query.from, to: query.to },
    query.groupBy,
    includeCosts,
  );

  if (query.format === 'csv') {
    const columns = [
      { key: 'label', label: 'Concepto' },
      { key: 'salesCount', label: 'Ventas' },
      { key: 'total', label: 'Total (Q)' },
      ...(includeCosts ? [{ key: 'profit', label: 'Utilidad (Q)' }] : []),
    ];
    return sendCsv(
      res,
      `ventas_${query.groupBy}_${query.from}_${query.to}.csv`,
      columns,
      rows.map((r) => ({
        ...r,
        total: csvMoney(r.total),
        ...('profit' in r ? { profit: csvMoney(r.profit as string) } : {}),
      })),
    );
  }
  res.json(rows);
});

reportsRouter.get('/voided-sales', async (req, res) => {
  const query = reportRangeSchema.parse(req.query);
  const storeIds = await visibleStoreIds(req, query.storeId);
  const rows = await getVoidedSales(req.auth!.tenantId!, {
    storeIds,
    from: query.from,
    to: query.to,
  });

  if (query.format === 'csv') {
    return sendCsv(
      res,
      `ventas_anuladas_${query.from}_${query.to}.csv`,
      [
        { key: 'number', label: 'Comprobante' },
        { key: 'store', label: 'Tienda' },
        { key: 'total', label: 'Total (Q)' },
        { key: 'cashier', label: 'Cajero' },
        { key: 'voidedBy', label: 'Anulada por' },
        { key: 'authorizedBy', label: 'Autorizada por' },
        { key: 'reason', label: 'Motivo' },
        { key: 'voidedAt', label: 'Fecha de anulación' },
      ],
      rows.map((r) => ({ ...r, total: csvMoney(r.total) })),
    );
  }
  res.json(rows);
});

// ─────────────────────────── Gastos ───────────────────────────

reportsRouter.get('/expenses', async (req, res) => {
  const query = reportRangeSchema.parse(req.query);
  const storeIds = await visibleStoreIds(req, query.storeId);
  const rows = await getExpensesByCategory(req.auth!.tenantId!, {
    storeIds,
    from: query.from,
    to: query.to,
  });

  if (query.format === 'csv') {
    return sendCsv(
      res,
      `gastos_${query.from}_${query.to}.csv`,
      [
        { key: 'category', label: 'Categoría' },
        { key: 'count', label: 'Cantidad' },
        { key: 'total', label: 'Total (Q)' },
        { key: 'fromCash', label: 'Pagado de caja (Q)' },
      ],
      rows.map((r) => ({ ...r, total: csvMoney(r.total), fromCash: csvMoney(r.fromCash) })),
    );
  }
  res.json(rows);
});

// ─────────────────────────── Caja ───────────────────────────

reportsRouter.get('/cash-sessions', async (req, res) => {
  const query = reportRangeSchema.parse(req.query);
  const storeIds = await visibleStoreIds(req, query.storeId);
  const rows = await getCashSessionsReport(req.auth!.tenantId!, {
    storeIds,
    from: query.from,
    to: query.to,
  });

  if (query.format === 'csv') {
    return sendCsv(
      res,
      `caja_${query.from}_${query.to}.csv`,
      [
        { key: 'store', label: 'Tienda' },
        { key: 'register', label: 'Caja' },
        { key: 'openedAt', label: 'Apertura' },
        { key: 'closedAt', label: 'Cierre' },
        { key: 'openedBy', label: 'Abrió' },
        { key: 'closedBy', label: 'Cerró' },
        { key: 'salesCount', label: 'Ventas' },
        { key: 'openingAmount', label: 'Fondo inicial (Q)' },
        { key: 'salesIn', label: 'Ventas efectivo (Q)' },
        { key: 'withdrawals', label: 'Retiros (Q)' },
        { key: 'expensesOut', label: 'Gastos (Q)' },
        { key: 'expectedAmount', label: 'Esperado (Q)' },
        { key: 'countedAmount', label: 'Contado (Q)' },
        { key: 'difference', label: 'Diferencia (Q)' },
      ],
      rows.map((r) => ({
        ...r,
        openingAmount: csvMoney(r.openingAmount),
        salesIn: csvMoney(r.salesIn),
        withdrawals: csvMoney(r.withdrawals),
        expensesOut: csvMoney(r.expensesOut),
        expectedAmount: r.expectedAmount ? csvMoney(r.expectedAmount) : '',
        countedAmount: r.countedAmount ? csvMoney(r.countedAmount) : '',
        difference: r.difference ? csvMoney(r.difference) : '',
      })),
    );
  }
  res.json(rows);
});

// ─────────────────────────── Inventario ───────────────────────────

reportsRouter.get('/inventory', async (req, res) => {
  const storeId = req.query.storeId ? String(req.query.storeId) : undefined;
  const storeIds = await visibleStoreIds(req, storeId);
  const lowOnly = req.query.lowOnly === 'true';
  const includeCosts = canViewCosts(req.memberships!);
  const rows = await getInventoryReport(req.auth!.tenantId!, storeIds, { lowOnly }, includeCosts);

  if (req.query.format === 'csv') {
    const columns = [
      { key: 'store', label: 'Tienda' },
      { key: 'sku', label: 'SKU' },
      { key: 'name', label: 'Producto' },
      { key: 'category', label: 'Categoría' },
      { key: 'unit', label: 'Unidad' },
      { key: 'stockQty', label: 'Existencia' },
      { key: 'minStock', label: 'Mínimo' },
      { key: 'price', label: 'Precio (Q)' },
      ...(includeCosts
        ? [
            { key: 'avgCost', label: 'Costo promedio (Q)' },
            { key: 'stockValue', label: 'Valor inventario (Q)' },
          ]
        : []),
    ];
    return sendCsv(
      res,
      lowOnly ? 'stock_bajo.csv' : 'inventario.csv',
      columns,
      rows.map((r) => ({
        ...r,
        price: csvMoney(r.price),
        ...('avgCost' in r
          ? {
              avgCost: csvMoney(r.avgCost as string),
              stockValue: csvMoney(r.stockValue as string),
            }
          : {}),
      })),
    );
  }
  res.json(rows);
});

// ─────────────────────────── Compras ───────────────────────────

reportsRouter.get('/purchases-by-supplier', async (req, res) => {
  const query = reportRangeSchema.parse(req.query);
  if (!canViewCosts(req.memberships!)) {
    throw forbidden('PERMISSION_DENIED', 'No tiene permiso para ver compras');
  }
  const storeIds = await visibleStoreIds(req, query.storeId);
  const rows = await getPurchasesBySupplier(req.auth!.tenantId!, {
    storeIds,
    from: query.from,
    to: query.to,
  });

  if (query.format === 'csv') {
    return sendCsv(
      res,
      `compras_proveedor_${query.from}_${query.to}.csv`,
      [
        { key: 'supplier', label: 'Proveedor' },
        { key: 'purchasesCount', label: 'Compras' },
        { key: 'total', label: 'Total (Q)' },
        { key: 'voidedCount', label: 'Anuladas' },
        { key: 'lastPurchase', label: 'Última compra' },
      ],
      rows.map((r) => ({ ...r, total: csvMoney(r.total) })),
    );
  }
  res.json(rows);
});

// ───────────────────── Resumen financiero ─────────────────────

reportsRouter.get('/financial-summary', async (req, res) => {
  const query = reportRangeSchema.parse(req.query);
  if (!canViewCosts(req.memberships!)) {
    throw forbidden('PERMISSION_DENIED', 'No tiene permiso para ver el resumen financiero');
  }
  const storeIds = await visibleStoreIds(req, query.storeId);
  const rows = await getFinancialSummary(req.auth!.tenantId!, {
    storeIds,
    from: query.from,
    to: query.to,
  });

  if (query.format === 'csv') {
    return sendCsv(
      res,
      `resumen_financiero_${query.from}_${query.to}.csv`,
      [
        { key: 'store', label: 'Tienda' },
        { key: 'salesCount', label: 'Ventas' },
        { key: 'salesTotal', label: 'Ingresos (Q)' },
        { key: 'costTotal', label: 'Costo de venta (Q)' },
        { key: 'grossProfit', label: 'Utilidad bruta (Q)' },
        { key: 'expensesTotal', label: 'Gastos (Q)' },
        { key: 'netResult', label: 'Resultado (Q)' },
        { key: 'purchasesTotal', label: 'Compras (Q)' },
        { key: 'voidedTotal', label: 'Anulado (Q)' },
      ],
      rows.map((r) => ({
        ...r,
        salesTotal: csvMoney(r.salesTotal),
        costTotal: csvMoney(r.costTotal),
        grossProfit: csvMoney(r.grossProfit),
        expensesTotal: csvMoney(r.expensesTotal),
        netResult: csvMoney(r.netResult),
        purchasesTotal: csvMoney(r.purchasesTotal),
        voidedTotal: csvMoney(r.voidedTotal),
      })),
    );
  }
  res.json(rows);
});

// ─────────────────────────── Auditoría ───────────────────────────

reportsRouter.get('/audit', async (req, res) => {
  const query = auditQuerySchema.parse(req.query);
  if (!req.memberships!.some((m) => m.role === 'OWNER' || m.role === 'STORE_ADMIN')) {
    throw forbidden('PERMISSION_DENIED', 'No tiene permiso para ver la auditoría');
  }
  const storeIds = await visibleStoreIds(req, query.storeId);
  res.json(
    await getAuditReport(req.auth!.tenantId!, {
      storeIds,
      action: query.action,
      userId: query.userId,
      from: query.from,
      to: query.to,
      page: query.page,
      criticalOnly: req.query.criticalOnly === 'true',
      criticalActions: CRITICAL_ACTIONS,
    }),
  );
});

// ─────────────── Agregados diarios (recómputo idempotente) ───────────────

reportsRouter.post('/daily-stats/refresh', async (req, res) => {
  const query = reportRangeSchema.parse(req.body);
  const storeIds = await visibleStoreIds(req, query.storeId);
  res.json(
    await refreshDailyStats(req.auth!.tenantId!, {
      storeIds,
      from: query.from,
      to: query.to,
    }),
  );
});
