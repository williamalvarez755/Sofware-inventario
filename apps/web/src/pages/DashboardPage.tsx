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

  /** Margen sobre la venta, en puntos enteros: solo si hay venta que dividir. */
  const margen =
    data && BigInt(data.salesTotal) > 0n
      ? Number((BigInt(data.profitTotal) * 100n) / BigInt(data.salesTotal))
      : null;

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
          {/* Cifra protagonista: lo primero que un dueño quiere saber al abrir
              la aplicación es cuánto vendió y cuánto le quedó. */}
          <Panel className="relative overflow-hidden p-6">
            <div
              className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full opacity-[0.16] blur-3xl"
              style={{ background: 'hsl(var(--accent))' }}
              aria-hidden
            />
            <div className="relative flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--text-3))]">
                  Vendido en el periodo
                </p>
                <p className="money mt-2 text-[46px] font-bold leading-none text-[hsl(var(--text-1))] sm:text-[56px]">
                  {formatQ(BigInt(data.salesTotal))}
                </p>
                <p className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[hsl(var(--text-2))]">
                  <span>{data.salesCount} venta(s)</span>
                  <span className="text-[hsl(var(--text-3))]">
                    Ticket promedio {formatQ(BigInt(data.ticketAverage))}
                  </span>
                </p>
              </div>
              <div className="rounded-2xl border border-[hsl(var(--accent)/0.28)] bg-[hsl(var(--accent)/0.09)] px-5 py-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--accent-strong))]">
                  Le quedó
                </p>
                <p className="money mt-1 text-[28px] font-bold leading-none text-[hsl(var(--accent-strong))]">
                  {formatQ(BigInt(data.profitTotal))}
                </p>
                <p className="mt-1 text-xs text-[hsl(var(--text-3))]">
                  {margen !== null ? `${margen}% de margen` : 'utilidad bruta'}
                </p>
              </div>
            </div>
          </Panel>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Stat
              label="Gastos"
              value={formatQ(BigInt(data.expensesTotal))}
              hint="Salidas registradas"
              icon="gastos"
            />
            <Stat
              label="Compras"
              value={formatQ(BigInt(data.purchasesTotal))}
              hint="Mercadería recibida"
              icon="compras"
            />
            <Stat
              label="Anuladas"
              value={formatQ(BigInt(data.voidedTotal))}
              hint={`${data.voidedCount} venta(s)`}
              tone={data.voidedCount > 0 ? 'danger' : 'neutral'}
              icon="alerta"
            />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
            <Panel className="p-5">
              <SectionTitle
                action={
                  <Link
                    to="/reportes"
                    className="flex items-center gap-1 text-[13px] font-medium text-[hsl(var(--accent-strong))] transition-colors hover:text-[hsl(var(--accent))]"
                  >
                    Ver reportes <Icon name="flecha-derecha" size={14} />
                  </Link>
                }
              >
                Ventas por día
              </SectionTitle>
              <SalesChart data={data.series} />
            </Panel>

            <Panel className="p-5">
              <SectionTitle
                action={
                  low.length > 0 ? (
                    <span className="rounded-full bg-red-500/12 px-2 py-0.5 text-[11px] font-semibold text-red-400">
                      {low.length}
                    </span>
                  ) : undefined
                }
              >
                Stock bajo
              </SectionTitle>
              {low.length === 0 ? (
                <Empty icon="cheque">Todo el inventario está sobre su mínimo</Empty>
              ) : (
                <div className="space-y-1">
                  {low.map((r) => {
                    const ratio = Number(r.minStock) > 0
                      ? Math.min(1, Number(r.stockQty) / Number(r.minStock))
                      : 0;
                    return (
                      <div
                        key={`${r.store}-${r.productId}`}
                        className="rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="truncate text-sm text-[hsl(var(--text-1))]">{r.name}</p>
                          <span className="money shrink-0 text-sm font-semibold text-red-400">
                            {r.stockQty}
                          </span>
                        </div>
                        {/* Barra proporcional: se ve de un vistazo qué tan
                            urgente es cada reposición. */}
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.07]">
                          <div
                            className="h-full rounded-full bg-red-400/80"
                            style={{ width: `${Math.max(6, ratio * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[11px] text-[hsl(var(--text-3))]">
                          mínimo {r.minStock} · {r.store}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </Page>
  );
}
