import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatQ } from '@minimarket/shared';
import { api, ApiError, downloadCsv } from '../api/client';
import { Page } from '../components/Nav';
import { Button, Cell, Empty, Field, Notice, Row, Select, Table } from '../components/ui';

interface StoreRow { id: string; name: string }
type Column = { key: string; label: string; money?: boolean; pct?: boolean };

/** Cada reporte declara su endpoint y sus columnas: la tabla es una sola. */
const REPORTS: Record<
  string,
  { label: string; path: string; needsRange: boolean; file: string; columns: Column[] }
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

  // Columnas que el API no devolvió (costos ocultos por rol) se omiten.
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
    <Page
      title="Reportes"
      subtitle="Todo sale de los movimientos registrados"
      wide
      actions={
        <Button variant="outline" icon="descargar" onClick={exportCsv} disabled={rows.length === 0}>
          Exportar CSV
        </Button>
      }
    >
      <div className="glass mb-4 flex flex-wrap items-end gap-3 rounded-2xl p-4">
        <Select
          label="Reporte"
          value={reportKey}
          onChange={(e) => setReportKey(e.target.value)}
          className="w-56"
        >
          {Object.entries(REPORTS).map(([key, r]) => (
            <option key={key} value={key}>{r.label}</option>
          ))}
        </Select>

        {reportKey === 'sales' && (
          <Select
            label="Agrupar por"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className="w-40"
          >
            <option value="day">Día</option>
            <option value="user">Usuario</option>
            <option value="category">Categoría</option>
            <option value="product">Producto</option>
            <option value="store">Tienda</option>
          </Select>
        )}

        <Select
          label="Tienda"
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          className="w-44"
        >
          <option value="">Todas</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>

        {report.needsRange && (
          <>
            <Field label="Desde" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            <Field label="Hasta" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </>
        )}
      </div>

      {error && <div className="mb-4"><Notice tone="danger" icon="alerta">{error}</Notice></div>}

      <Table head={columns.map((c) => c.label)}>
        {rows.map((row, i) => (
          <Row key={i}>
            {columns.map((c) => {
              const value = row[c.key];
              return (
                <Cell
                  key={c.key}
                  align={c.money || c.pct ? 'right' : 'left'}
                  mono={c.money || c.pct}
                >
                  {value === null || value === undefined
                    ? '—'
                    : c.money
                      ? formatQ(BigInt(String(value)))
                      : c.pct
                        ? `${value}%`
                        : String(value)}
                </Cell>
              );
            })}
          </Row>
        ))}
        {rows.length === 0 && (
          <tr>
            <Cell colSpan={columns.length}>
              <Empty icon="reportes">
                {loading ? 'Cargando…' : 'Sin datos para los filtros seleccionados'}
              </Empty>
            </Cell>
          </tr>
        )}
      </Table>
    </Page>
  );
}
