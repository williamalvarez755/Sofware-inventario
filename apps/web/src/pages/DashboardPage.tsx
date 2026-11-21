import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatQ } from '@minimarket/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Page } from '../components/AppShell';
import { Icon } from '../components/Icon';
import { SalesChart, type DayPoint } from '../components/SalesChart';
import { GRUPOS, tono, type Modulo } from '../components/navegacion';
import { Empty, Notice, Panel, SectionTitle, Select, Stat, cx } from '../components/ui';

/**
 * INICIO — centro de operaciones, no un tablero de cifras.
 *
 * La pantalla se lee de arriba hacia abajo en el orden en que a alguien le
 * importan las cosas al abrir el sistema:
 *
 *   1. QUÉ VOY A HACER AHORA — dos accesos grandes, cobrar y cuadrar caja.
 *      Son el 90 % de las aperturas de la aplicación y antes estaban al mismo
 *      tamaño que "Proveedores", en una fila de ocho.
 *   2. CÓMO VA EL DÍA — una sola cifra protagonista con lo que quedó al lado.
 *   3. QUÉ NECESITA ATENCIÓN — stock bajo, con su barra de urgencia.
 *   4. QUÉ MÁS HAY — los módulos presentados como tarjetas con una línea que
 *      explica para qué sirve cada uno. Es lo que hace que un cliente nuevo
 *      entienda el sistema completo sin que nadie se lo enseñe.
 *
 * Un trabajador ve 1 y 4; los números de su turno están en Caja.
 */

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

function saludo(): string {
  const hora = Number(
    new Date().toLocaleString('en-GB', { timeZone: 'America/Guatemala', hour: '2-digit', hour12: false }),
  );
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

const RANGES = [
  { label: 'Hoy', days: 0 },
  { label: '7 días', days: 6 },
  { label: '30 días', days: 29 },
];

/** Tomados del mapa: aquí no se redeclaran rutas, iconos ni colores. */
const MOSTRADOR = GRUPOS[0]!.items;
const INVENTARIO = GRUPOS[1]!.items;
const ADMIN = GRUPOS[2]!.items;

// ───────────────────────── Accesos principales ─────────────────────────

/**
 * Tarjeta de acción grande. No es un enlace de menú con otro tamaño: dice en
 * una línea qué resuelve, y eso es lo que convierte "POS" —una sigla que no
 * significa nada para un tendero— en "Cobrar una venta".
 */
function Accion({
  modulo,
  titulo,
  texto,
  paso,
}: {
  modulo: Modulo;
  /** Retardo de la transición, para que las dos tarjetas no respondan
   *  exactamente al unísono. La entrada de la pantalla la anima `Page`. */
  paso: number;
  /** El título dice la ACCIÓN, no el nombre del módulo: "Cobrar una venta"
   *  es lo que la persona quiere hacer; "Vender" es cómo se llama la
   *  pantalla. En la barra lateral manda el nombre; aquí, el verbo. */
  titulo: string;
  texto: string;
}) {
  return (
    <Link
      to={modulo.to}
      style={{ transitionDelay: `${paso * 40}ms` } as React.CSSProperties}
      className="glass group relative flex items-center gap-4 overflow-hidden rounded-2xl p-5 transition-all duration-300 hover:-translate-y-0.5"
    >
      {/* Un foco del color del módulo detrás del vidrio: la tarjeta se siente
          iluminada desde su propio icono, no pintada de un color. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-16 size-44 rounded-full opacity-[0.22] blur-3xl transition-opacity duration-300 group-hover:opacity-40"
        style={{ background: tono(modulo) }}
      />
      <span
        className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl shadow-[inset_0_1px_0_hsl(0_0%_100%/0.22)] transition-transform duration-300 group-hover:scale-105"
        style={{ background: tono(modulo, 0.18) }}
      >
        <Icon name={modulo.icon} size={23} color={tono(modulo)} />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="font-display block text-[17px] font-bold leading-tight text-[hsl(var(--text-1))]">
          {titulo}
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug text-[hsl(var(--text-3))]">
          {texto}
        </span>
      </span>
      <Icon
        name="flecha-derecha"
        size={18}
        className="relative shrink-0 text-[hsl(var(--text-3))] transition-transform duration-300 group-hover:translate-x-1"
      />
    </Link>
  );
}

/** Tarjeta de módulo del mapa inferior. Pequeña, pero del mismo material. */
function TarjetaModulo({ m }: { m: Modulo }) {
  return (
    <Link
      to={m.to}
      className="group flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-[hsl(var(--text-1)/0.05)]"
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110"
        style={{ background: tono(m, 0.14) }}
      >
        <Icon name={m.icon} size={17} color={tono(m)} />
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold leading-tight text-[hsl(var(--text-1))]">
          {m.label}
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-[hsl(var(--text-3))]">
          {m.desc}
        </span>
      </span>
    </Link>
  );
}

// ─────────────────────────────── La pantalla ───────────────────────────────

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
      setLow(lowStock.slice(0, 12));
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

  const primerNombre = me.user.name.split(/\s+/)[0] ?? me.user.name;

  return (
    <Page
      title={`${saludo()}, ${primerNombre}`}
      subtitle={me.tenant.name}
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
            <div className="glass-soft flex overflow-hidden rounded-xl p-1">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  onClick={() => setRangeDays(r.days)}
                  aria-pressed={rangeDays === r.days}
                  className={cx(
                    'rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
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

      {/* 1 ─ Qué voy a hacer ahora */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Accion
          modulo={MOSTRADOR[0]!}
          titulo="Cobrar una venta"
          texto="Escanee los productos y cobre"
          paso={0}
        />
        <Accion
          modulo={MOSTRADOR[1]!}
          titulo="Mi caja"
          texto="Abrir turno, retiros y cierre"
          paso={1}
        />
      </div>

      {canSeeReports && data && (
        <>
          {/* 2 ─ Cómo va el día */}
          {/* El panel protagonista es el único con luz propia: dos focos
              detrás del vidrio —el azul de la marca arriba a la izquierda,
              un violeta frío en la esquina opuesta— para que la cifra del día
              sea lo primero que la vista encuentra al abrir. */}
          <Panel
            className="relative mt-3 overflow-hidden p-6 sm:p-7"
          >
            {/* Bajos a propósito: el vidrio ya amplifica la luz del lienzo
                que pasa por detrás, así que estos focos solo rematan. Con los
                valores anteriores el panel se volvía una placa azul. */}
            <div
              className="pointer-events-none absolute -left-24 -top-36 size-[26rem] rounded-full opacity-[0.16] blur-3xl"
              style={{ background: 'hsl(var(--accent))' }}
              aria-hidden
            />
            {/* El violeta va bajo y al centro, no detrás del recuadro de la
                utilidad: ahí teñía de morado una caja que debe leerse en el
                color del acento. */}
            <div
              className="pointer-events-none absolute -bottom-36 left-1/3 size-80 rounded-full opacity-[0.12] blur-3xl"
              style={{ background: 'hsl(264 66% 60%)' }}
              aria-hidden
            />
            <div className="relative flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
              <div>
                <p className="rotulo">Vendido en el periodo</p>
                <p className="cifra mt-3 text-[clamp(2.6rem,7vw,4rem)] font-bold text-[hsl(var(--text-1))]">
                  {formatQ(BigInt(data.salesTotal))}
                </p>
                <p className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-[hsl(var(--text-2))]">
                  <span>{data.salesCount} venta(s)</span>
                  <span className="text-[hsl(var(--text-3))]">·</span>
                  <span className="text-[hsl(var(--text-3))]">
                    Ticket promedio {formatQ(BigInt(data.ticketAverage))}
                  </span>
                </p>
              </div>
              <div className="rounded-2xl border border-[hsl(var(--accent)/0.28)] bg-[hsl(var(--accent)/0.1)] px-6 py-4">
                <p className="rotulo flex items-center gap-1.5 text-[hsl(var(--accent-strong))]">
                  <Icon name="tendencia" size={13} />
                  Le quedó
                </p>
                <p className="cifra mt-2 text-[2rem] font-bold text-[hsl(var(--accent-strong))]">
                  {formatQ(BigInt(data.profitTotal))}
                </p>
                <p className="mt-1.5 text-xs text-[hsl(var(--text-3))]">
                  {margen !== null ? `${margen} % de margen` : 'utilidad bruta'}
                </p>
              </div>
            </div>
          </Panel>

          <div
            className="mt-3 grid gap-3 sm:grid-cols-3"
          >
            {/* Cada indicador toma el color de SU módulo: el de gastos es
                del mismo frambuesa que el enlace de Gastos en la columna, y
                así la cifra y el sitio donde se trabaja quedan atados. */}
            <Stat
              label="Gastos"
              value={formatQ(BigInt(data.expensesTotal))}
              hint="Salidas registradas"
              icon="gastos"
              color={tono(ADMIN[0]!)}
              colorSuave={tono(ADMIN[0]!, 0.16)}
            />
            <Stat
              label="Compras"
              value={formatQ(BigInt(data.purchasesTotal))}
              hint="Mercadería recibida"
              icon="compras"
              color={tono(INVENTARIO[1]!)}
              colorSuave={tono(INVENTARIO[1]!, 0.16)}
            />
            <Stat
              label="Anuladas"
              value={formatQ(BigInt(data.voidedTotal))}
              hint={`${data.voidedCount} venta(s)`}
              tone={data.voidedCount > 0 ? 'danger' : 'neutral'}
              icon="alerta"
            />
          </div>

          {/* 3 ─ Qué necesita atención */}
          <div
            className="mt-3 grid items-start gap-3 lg:grid-cols-[1.55fr_1fr]"
          >
            <Panel className="p-5">
              <SectionTitle
                action={
                  <Link
                    to="/reportes"
                    className="flex items-center gap-1 text-[12.5px] font-semibold text-[hsl(var(--accent-strong))] transition-colors hover:text-[hsl(var(--accent))]"
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
                    <span className="rounded-full bg-[hsl(var(--danger)/0.13)] px-2 py-0.5 text-[11px] font-semibold text-[hsl(var(--danger))]">
                      {low.length}
                    </span>
                  ) : undefined
                }
              >
                Hay que reponer
              </SectionTitle>
              {low.length === 0 ? (
                <Empty icon="cheque">Todo el inventario está sobre su mínimo</Empty>
              ) : (
                // Altura tope con desplazamiento propio: la lista puede traer
                // decenas de productos y, sin tope, estiraba la fila entera
                // del tablero y dejaba medio metro de vacío al lado del
                // gráfico.
                <div className="-mr-1.5 max-h-[15.5rem] space-y-0.5 overflow-y-auto pr-1.5">
                  {low.map((r) => {
                    const ratio = Number(r.minStock) > 0
                      ? Math.min(1, Number(r.stockQty) / Number(r.minStock))
                      : 0;
                    return (
                      <Link
                        key={`${r.store}-${r.productId}`}
                        to="/productos"
                        className="block rounded-xl px-3 py-2 transition-colors hover:bg-[hsl(var(--text-1)/0.05)]"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="truncate text-[13.5px] text-[hsl(var(--text-1))]">
                            {r.name}
                          </p>
                          <span className="money shrink-0 text-[13px] font-semibold text-[hsl(var(--danger))]">
                            {r.stockQty}
                            <span className="text-[hsl(var(--text-3))]">/{r.minStock}</span>
                          </span>
                        </div>
                        {/* Barra proporcional: se ve de un vistazo qué tan
                            urgente es cada reposición. */}
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[hsl(var(--text-1)/0.09)]">
                          <div
                            className="h-full rounded-full bg-[hsl(var(--danger)/0.85)]"
                            style={{ width: `${Math.max(6, ratio * 100)}%` }}
                          />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </Panel>
          </div>
        </>
      )}

      {!canSeeReports && (
        <Panel className="mt-3 p-6">
          <div className="flex items-start gap-3">
            <Icon name="reloj" size={20} className="mt-0.5 shrink-0 text-[hsl(var(--text-3))]" />
            <p className="text-sm text-[hsl(var(--text-2))]">
              Los totales del negocio los ve el dueño o el encargado. Lo suyo está en{' '}
              <Link to="/caja" className="font-semibold text-[hsl(var(--accent-strong))]">
                Caja
              </Link>
              : ahí aparece el detalle de su turno.
            </p>
          </div>
        </Panel>
      )}

      {/* 4 ─ Qué más hay: el sistema entero, explicado en una línea cada cosa */}
      <section className="mt-7">
        <p className="rotulo mb-2.5">Todo el sistema</p>
        <div className="grid gap-3 md:grid-cols-3">
          {GRUPOS.map((g) => (
            <Panel key={g.titulo} className="p-3">
              <p className="rotulo mb-1 px-3 pt-1">{g.titulo}</p>
              {g.items.map((m) => (
                <TarjetaModulo key={m.to} m={m} />
              ))}
            </Panel>
          ))}
        </div>
      </section>
    </Page>
  );
}
