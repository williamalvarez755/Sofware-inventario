import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatQ } from '@minimarket/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Nav } from '../components/Nav';
import { SalesChart, type DayPoint } from '../components/SalesChart';

interface StoreRow {
  id: string;
  name: string;
}
interface Dashboard {
  salesCount: number;
  salesTotal: string;
  costTotal: string;
  profitTotal: string;
  voidedCount: number;
  voidedTotal: string;
  expensesTotal: string;
  purchasesTotal: string;
  ticketAverage: string;
  series: DayPoint[];
}
interface LowStockRow {
  productId: string;
  name: string;
  store: string;
  stockQty: string;
  minStock: string;
}

/** Rango en horario de Guatemala (el negocio, no el navegador). */
function gtDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' });
}

const RANGES = [
  { label: 'Hoy', days: 0 },
  { label: '7 días', days: 6 },
  { label: '30 días', days: 29 },
];

export function DashboardPage() {
  const { me } = useAuth();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState<string>(''); // '' = todas
  const [rangeDays, setRangeDays] = useState(6);
  const [data, setData] = useState<Dashboard | null>(null);
  const [low, setLow] = useState<LowStockRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canSeeReports = me?.memberships.some((m) => m.role !== 'WORKER') ?? false;

  useEffect(() => {
    api<StoreRow[]>('/api/stores').then(setStores).catch(() => setStores([]));
  }, []);

  const load = useCallback(async () => {
    if (!canSeeReports) return;
    const params = new URLSearchParams({ from: gtDate(-rangeDays), to: gtDate() });
    if (storeId) params.set('storeId', storeId);
    setError(null);
    try {
      const [dashboard, lowStock] = await Promise.all([
        api<Dashboard>(`/api/reports/dashboard?${params}`),
        api<LowStockRow[]>(`/api/reports/inventory?lowOnly=true${storeId ? `&storeId=${storeId}` : ''}`),
      ]);
      setData(dashboard);
      setLow(lowStock.slice(0, 8));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error cargando el resumen');
    }
  }, [storeId, rangeDays, canSeeReports]);

  useEffect(() => {
    load();
  }, [load]);

  if (!me) return null;

  return (
    <div className="min-h-screen bg-slate-100">
      <Nav />
      <main className="mx-auto max-w-5xl p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Resumen del negocio</h1>
            <p className="text-sm text-slate-500">{me.user.name}</p>
          </div>
          {canSeeReports && (
            <div className="ml-auto flex flex-wrap gap-2">
              <select
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              >
                <option value="">Todas mis tiendas</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <div className="flex overflow-hidden rounded-lg border border-slate-300">
                {RANGES.map((r) => (
                  <button
                    key={r.days}
                    onClick={() => setRangeDays(r.days)}
                    className={`px-3 py-2 text-sm font-medium ${
                      rangeDays === r.days ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {!canSeeReports && (
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="font-semibold text-slate-800">Su turno</h2>
            <p className="mt-1 text-sm text-slate-500">
              Vaya a <Link to="/pos" className="font-medium text-emerald-700">POS</Link> para vender o a{' '}
              <Link to="/caja" className="font-medium text-emerald-700">Caja</Link> para ver los movimientos de su turno.
            </p>
          </div>
        )}

        {canSeeReports && data && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Ventas" value={formatQ(BigInt(data.salesTotal))} hint={`${data.salesCount} venta(s)`} />
              <StatTile label="Utilidad bruta" value={formatQ(BigInt(data.profitTotal))} hint={`Ticket prom. ${formatQ(BigInt(data.ticketAverage))}`} accent />
              <StatTile label="Gastos" value={formatQ(BigInt(data.expensesTotal))} hint={`Compras ${formatQ(BigInt(data.purchasesTotal))}`} />
              <StatTile
                label="Anuladas"
                value={formatQ(BigInt(data.voidedTotal))}
                hint={`${data.voidedCount} venta(s)`}
                warn={data.voidedCount > 0}
              />
            </div>

            <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold text-slate-800">Ventas por día</h2>
                <Link to="/reportes" className="text-sm font-medium text-emerald-700 hover:text-emerald-900">
                  Ver reportes →
                </Link>
              </div>
              <SalesChart data={data.series} />
            </section>

            <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-semibold text-slate-800">
                Stock bajo {low.length > 0 && <span className="text-red-600">({low.length})</span>}
              </h2>
              {low.length === 0 && (
                <p className="mt-2 text-sm text-slate-400">Todo el inventario está sobre su mínimo.</p>
              )}
              <div className="mt-2 divide-y divide-slate-50">
                {low.map((r) => (
                  <div key={`${r.store}-${r.productId}`} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <p className="text-slate-700">{r.name}</p>
                      <p className="text-xs text-slate-400">{r.store}</p>
                    </div>
                    <span className="font-semibold text-red-600">
                      {r.stockQty} / mín. {r.minStock}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function StatTile({
  label, value, hint, accent, warn,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${
          warn ? 'text-red-600' : accent ? 'text-emerald-700' : 'text-slate-900'
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
