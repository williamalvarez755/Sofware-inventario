import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatQ } from '@minimarket/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { Page } from '../components/Nav';
import { SalesChart, type DayPoint } from '../components/SalesChart';
import {
  Button,
  Empty,
  Notice,
  Panel,
  SectionTitle,
  Select,
  Stat,
  cx,
} from '../components/ui';

interface StoreRow { id: string; name: string }
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

/** Rango en horario de Guatemala: el negocio, no el navegador. */
function gtDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'America/Guatemala',
  });
}

const RANGES = [
  { label: 'Hoy', days: 0 },
  { label: '7 días', days: 6 },
  { label: '30 días', days: 29 },
];

export function DashboardPage() {
  const { me } = useAuth();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState('');
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
        api<LowStockRow[]>(
          `/api/reports/inventory?lowOnly=true${storeId ? `&storeId=${storeId}` : ''}`,
        ),
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
    <Page
      title="Resumen del negocio"
      subtitle={me.user.name}
      actions={
        canSeeReports && (
          <>
            <Select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              aria-label="Tienda"
              className="w-48"
            >
              <option value="">Todas mis tiendas</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
            <div className="glass flex overflow-hidden rounded-xl p-1">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  onClick={() => setRangeDays(r.days)}
                  aria-pressed={rangeDays === r.days}
                  className={cx(
                    'rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                    rangeDays === r.days
                      ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-ink))]'
                      : 'text-[hsl(var(--text-2))] hover:text-[hsl(var(--text-1))]',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </>
        )
      }
    >
      {error && (
        <div className="mb-4">
          <Notice tone="danger" icon="alerta">{error}</Notice>
        </div>
      )}

      {!canSeeReports && (
        <Panel className="p-8 text-center">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent))]">
            <Icon name="punto-venta" size={24} />
          </span>
          <h2 className="font-display text-lg font-semibold text-[hsl(var(--text-1))]">
            Su turno
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-[hsl(var(--text-3))]">
            Vaya al punto de venta para cobrar, o a caja para ver los movimientos de su turno.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Link to="/pos">
              <Button variant="primary" icon="punto-venta">Ir al punto de venta</Button>
            </Link>
            <Link to="/caja">
              <Button variant="outline" icon="caja">Mi caja</Button>
            </Link>
          </div>
        </Panel>
      )}

      {canSeeReports && data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Ventas"
              value={formatQ(BigInt(data.salesTotal))}
              hint={`${data.salesCount} venta(s)`}
              icon="punto-venta"
            />
            <Stat
              label="Utilidad bruta"
              value={formatQ(BigInt(data.profitTotal))}
              hint={`Ticket promedio ${formatQ(BigInt(data.ticketAverage))}`}
              tone="accent"
              icon="reportes"
            />
            <Stat
              label="Gastos"
              value={formatQ(BigInt(data.expensesTotal))}
              hint={`Compras ${formatQ(BigInt(data.purchasesTotal))}`}
              icon="gastos"
            />
            <Stat
              label="Anuladas"
              value={formatQ(BigInt(data.voidedTotal))}
              hint={`${data.voidedCount} venta(s)`}
              tone={data.voidedCount > 0 ? 'danger' : 'neutral'}
              icon="alerta"
            />
          </div>

          <Panel className="mt-4 p-5">
            <SectionTitle
              action={
                <Link
                  to="/reportes"
                  className="flex items-center gap-1 text-[13px] font-medium text-[hsl(var(--accent-strong))] hover:underline"
                >
                  Ver reportes <Icon name="flecha-derecha" size={14} />
                </Link>
              }
            >
              Ventas por día
            </SectionTitle>
            <SalesChart data={data.series} />
          </Panel>

          <Panel className="mt-4 p-5">
            <SectionTitle>
              Stock bajo{' '}
              {low.length > 0 && <span className="text-red-400">({low.length})</span>}
            </SectionTitle>
            {low.length === 0 ? (
              <Empty icon="cheque">Todo el inventario está sobre su mínimo</Empty>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {low.map((r) => (
                  <div
                    key={`${r.store}-${r.productId}`}
                    className="flex items-center justify-between py-2.5"
                  >
                    <div>
                      <p className="text-sm text-[hsl(var(--text-1))]">{r.name}</p>
                      <p className="text-xs text-[hsl(var(--text-3))]">{r.store}</p>
                    </div>
                    <span className="money text-sm font-semibold text-red-400">
                      {r.stockQty} / mín. {r.minStock}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}
    </Page>
  );
}
