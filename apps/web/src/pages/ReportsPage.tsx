import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatQ } from '@minimarket/shared';
import { api, ApiError, downloadCsv } from '../api/client';
import { Nav } from '../components/Nav';

interface StoreRow { id: string; name: string }
type Cell = { key: string; label: string; money?: boolean; pct?: boolean };

/** Cada reporte declara su endpoint y sus columnas: la tabla es una sola. */
const REPORTS: Record<
  string,
  { label: string; path: string; needsRange: boolean; file: string; columns: Cell[] }
> = {
  profit: {
    label: 'Utilidades por producto',
    path: 'profit-by-product',
    needsRange: true,
    file: 'utilidades',
    columns: [
      { key: 'name', label: 'Producto' },
      { key: 'category', label: 'Categoría' },
      { key: 'qty', label: 'Cantidad' },
      { key: 'revenue', label: 'Venta', money: true },
      { key: 'cost', label: 'Costo', money: true },
      { key: 'profit', label: 'Utilidad', money: true },
      { key: 'marginPct', label: 'Margen', pct: true },
    ],
  },
  sales: {
    label: 'Ventas',
    path: 'sales',
    needsRange: true,
    file: 'ventas',
    columns: [
      { key: 'label', label: 'Concepto' },
      { key: 'salesCount', label: 'Ventas' },
      { key: 'total', label: 'Total', money: true },
      { key: 'profit', label: 'Utilidad', money: true },
    ],
  },
  expenses: {
    label: 'Gastos por tipo',
    path: 'expenses',
    needsRange: true,
    file: 'gastos',
    columns: [
      { key: 'category', label: 'Categoría' },
      { key: 'count', label: 'Cantidad' },
      { key: 'total', label: 'Total', money: true },
      { key: 'fromCash', label: 'Pagado de caja', money: true },
    ],
  },
  cash: {
    label: 'Movimientos de caja',
    path: 'cash-sessions',
    needsRange: true,
    file: 'caja',
    columns: [
      { key: 'store', label: 'Tienda' },
      { key: 'register', label: 'Caja' },
      { key: 'openedBy', label: 'Abrió' },
      { key: 'salesCount', label: 'Ventas' },
      { key: 'salesIn', label: 'Efectivo ventas', money: true },
      { key: 'withdrawals', label: 'Retiros', money: true },
      { key: 'expectedAmount', label: 'Esperado', money: true },
      { key: 'countedAmount', label: 'Contado', money: true },
      { key: 'difference', label: 'Diferencia', money: true },
    ],
  },
  inventory: {
    label: 'Inventario actual',
    path: 'inventory',
    needsRange: false,
    file: 'inventario',
    columns: [
      { key: 'name', label: 'Producto' },
      { key: 'store', label: 'Tienda' },
      { key: 'stockQty', label: 'Existencia' },
      { key: 'minStock', label: 'Mínimo' },
      { key: 'price', label: 'Precio', money: true },
      { key: 'avgCost', label: 'Costo prom.', money: true },
      { key: 'stockValue', label: 'Valor', money: true },
    ],
  },
  purchases: {
    label: 'Compras por proveedor',
    path: 'purchases-by-supplier',
    needsRange: true,
    file: 'compras',
    columns: [
      { key: 'supplier', label: 'Proveedor' },
      { key: 'purchasesCount', label: 'Compras' },
      { key: 'total', label: 'Total', money: true },
      { key: 'voidedCount', label: 'Anuladas' },
    ],
  },
  voided: {
    label: 'Ventas anuladas',
    path: 'voided-sales',
    needsRange: true,
    file: 'ventas_anuladas',
    columns: [
      { key: 'number', label: 'Comprobante' },
      { key: 'store', label: 'Tienda' },
      { key: 'total', label: 'Total', money: true },
      { key: 'cashier', label: 'Cajero' },
      { key: 'voidedBy', label: 'Anuló' },
      { key: 'authorizedBy', label: 'Autorizó' },
      { key: 'reason', label: 'Motivo' },
    ],
  },
  financial: {
    label: 'Resumen financiero',
    path: 'financial-summary',
    needsRange: true,
    file: 'resumen_financiero',
    columns: [
      { key: 'store', label: 'Tienda' },
      { key: 'salesTotal', label: 'Ingresos', money: true },
      { key: 'costTotal', label: 'Costo de venta', money: true },
      { key: 'grossProfit', label: 'Utilidad bruta', money: true },
      { key: 'expensesTotal', label: 'Gastos', money: true },
      { key: 'netResult', label: 'Resultado', money: true },
    ],
  },
};

function gtDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'America/Guatemala',
  });
}

const inputCls =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

export function ReportsPage() {
  const [reportKey, setReportKey] = useState('profit');
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState('');
  const [from, setFrom] = useState(gtDate(-29));
  const [to, setTo] = useState(gtDate());
  const [groupBy, setGroupBy] = useState('day');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const report = REPORTS[reportKey]!;

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (report.needsRange) {
      params.set('from', from);
      params.set('to', to);
    }
    if (storeId) params.set('storeId', storeId);
    if (reportKey === 'sales') params.set('groupBy', groupBy);
    return params;
  }, [report.needsRange, from, to, storeId, reportKey, groupBy]);

  useEffect(() => {
    api<StoreRow[]>('/api/stores').then(setStores).catch(() => setStores([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await api<Record<string, unknown>[]>(`/api/reports/${report.path}?${query}`));
    } catch (e) {
      setRows([]);
      setError(
        e instanceof ApiError && e.status === 403
          ? 'No tiene permiso para ver este reporte'
          : 'Error cargando el reporte',
      );
    } finally {
      setLoading(false);
    }
  }, [report.path, query]);

  useEffect(() => {
    load();
  }, [load]);

  // Columnas que el API no devolvió (p. ej. costos ocultos al rol) se omiten.
  const columns = report.columns.filter(
    (c) => rows.length === 0 || rows.some((r) => r[c.key] !== undefined),
  );

  async function exportCsv() {
    const params = new URLSearchParams(query);
    params.set('format', 'csv');
    try {
      await downloadCsv(
        `/api/reports/${report.path}?${params}`,
        `${report.file}_${report.needsRange ? `${from}_${to}` : gtDate()}.csv`,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al exportar');
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Nav />
      <main className="mx-auto max-w-6xl p-6">
        <h1 className="text-xl font-bold text-slate-800">Reportes</h1>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs font-medium text-slate-500">Reporte</span>
            <select value={reportKey} onChange={(e) => setReportKey(e.target.value)} className={inputCls + ' mt-1'}>
              {Object.entries(REPORTS).map(([key, r]) => (
                <option key={key} value={key}>{r.label}</option>
              ))}
            </select>
          </label>

          {reportKey === 'sales' && (
            <label className="text-sm">
              <span className="block text-xs font-medium text-slate-500">Agrupar por</span>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className={inputCls + ' mt-1'}>
                <option value="day">Día</option>
                <option value="user">Usuario</option>
                <option value="category">Categoría</option>
                <option value="product">Producto</option>
                <option value="store">Tienda</option>
              </select>
            </label>
          )}

          <label className="text-sm">
            <span className="block text-xs font-medium text-slate-500">Tienda</span>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={inputCls + ' mt-1'}>
              <option value="">Todas</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>

          {report.needsRange && (
            <>
              <label className="text-sm">
                <span className="block text-xs font-medium text-slate-500">Desde</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls + ' mt-1'} />
              </label>
              <label className="text-sm">
                <span className="block text-xs font-medium text-slate-500">Hasta</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls + ' mt-1'} />
              </label>
            </>
          )}

          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="ml-auto rounded-lg border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
          >
            Exportar CSV
          </button>
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                {columns.map((c) => (
                  <th key={c.key} className={`px-4 py-3 ${c.money || c.pct ? 'text-right' : ''}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                  {columns.map((c) => {
                    const value = row[c.key];
                    return (
                      <td
                        key={c.key}
                        className={`px-4 py-2.5 ${
                          c.money || c.pct ? 'text-right tabular-nums text-slate-800' : 'text-slate-600'
                        }`}
                      >
                        {value === null || value === undefined
                          ? '—'
                          : c.money
                            ? formatQ(BigInt(String(value)))
                            : c.pct
                              ? `${value}%`
                              : String(value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-400">
                    Sin datos para los filtros seleccionados
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-400">
                    Cargando…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
