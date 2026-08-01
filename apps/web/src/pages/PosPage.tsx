import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { formatQ, toCentavos } from '@minimarket/shared';
import { api, ApiError } from '../api/client';
import { CameraScanner } from '../components/CameraScanner';
import { Icon } from '../components/Icon';
import { Nav } from '../components/Nav';
import { Receipt, type ReceiptData } from '../components/Receipt';
import {
  Button,
  Empty,
  Field,
  IconButton,
  Modal,
  Notice,
  Panel,
  Select,
  cx,
} from '../components/ui';
import { retryOnNetworkFailure, useOnlineStatus } from '../lib/connection';
import { isThermalPrintingAvailable, printThermalReceipt } from '../lib/escpos';

interface StoreOpt { id: string; name: string }
interface RegisterOpt { id: string; name: string }
interface Session { id: string; expectedSoFar: string; salesCount: number; openingAmount: string }
interface ProductHit {
  id: string;
  name: string;
  sku: string;
  price: string;
  stockQty?: string;
  unit: { allowsDecimals: boolean; code: string };
  barcodes: { barcode: string }[];
}
interface CartLine { product: ProductHit; qty: number }

export function PosPage() {
  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  const [registers, setRegisters] = useState<RegisterOpt[]>([]);
  const [registerId, setRegisterId] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [openingAmount, setOpeningAmount] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ProductHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const online = useOnlineStatus();

  useEffect(() => {
    api<StoreOpt[]>('/api/stores').then((s) => {
      setStores(s);
      if (s.length) setStoreId(s[0]!.id);
    });
  }, []);

  useEffect(() => {
    if (!storeId) return;
    api<RegisterOpt[]>(`/api/cash/registers?storeId=${storeId}`).then((r) => {
      setRegisters(r);
      setRegisterId(r[0]?.id ?? '');
    });
  }, [storeId]);

  const loadSession = useCallback(async () => {
    if (!registerId) return;
    setSessionLoaded(false);
    setSession(await api<Session | null>(`/api/cash/sessions/current?registerId=${registerId}`));
    setSessionLoaded(true);
  }, [registerId]);

  useEffect(() => {
    loadSession().catch(() => setSessionLoaded(true));
  }, [loadSession]);

  // El foco vuelve al campo de escaneo tras cada acción: el cajero trabaja
  // con el lector en la mano, no con el mouse.
  useEffect(() => {
    scanRef.current?.focus();
  }, [session, cart.length, receipt]);

  const addToCart = useCallback((product: ProductHit) => {
    setCart((c) => {
      const existing = c.find((l) => l.product.id === product.id);
      return existing
        ? c.map((l) => (l.product.id === product.id ? { ...l, qty: l.qty + 1 } : l))
        : [...c, { product, qty: 1 }];
    });
    setHits(null);
    setQuery('');
    setError(null);
  }, []);

  const lookup = useCallback(
    async (term: string) => {
      const data = await api<{ rows: ProductHit[] }>(
        `/api/products?storeId=${storeId}&search=${encodeURIComponent(term)}`,
      );
      const exact = data.rows.find((p) => p.barcodes.some((b) => b.barcode === term));
      if (exact) return addToCart(exact);
      if (data.rows.length === 1) return addToCart(data.rows[0]!);
      if (data.rows.length === 0) {
        setError(`Sin resultados para "${term}"`);
        setQuery('');
        return;
      }
      setHits(data.rows);
    },
    [storeId, addToCart],
  );

  async function onScanSubmit(e: FormEvent) {
    e.preventDefault();
    const term = query.trim();
    if (term) await lookup(term);
  }

  function setQty(productId: string, qty: number) {
    if (Number.isNaN(qty) || qty <= 0) return;
    setCart((c) => c.map((l) => (l.product.id === productId ? { ...l, qty } : l)));
  }

  const total = cart.reduce(
    (acc, l) => acc + BigInt(Math.round(l.qty * Number(l.product.price))),
    0n,
  );

  async function openCashSession(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/api/cash/sessions', {
        method: 'POST',
        body: JSON.stringify({
          cashRegisterId: registerId,
          openingAmount: toCentavos(openingAmount || '0'),
        }),
      });
      setOpeningAmount('');
      await loadSession();
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error al abrir caja');
    }
  }

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="surgir mx-auto max-w-[1400px] px-5 py-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[hsl(var(--text-1))]">
            Punto de venta
          </h1>
          <div className="ml-auto flex flex-wrap gap-2">
            <Select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              aria-label="Tienda"
              className="w-44"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
            <Select
              value={registerId}
              onChange={(e) => setRegisterId(e.target.value)}
              aria-label="Caja"
              className="w-36"
            >
              {registers.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </Select>
          </div>
        </div>

        {sessionLoaded && !session && (
          <Panel as="form" className="mx-auto mt-14 max-w-sm p-7" onSubmit={openCashSession}>
            <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent))]">
              <Icon name="caja" size={24} />
            </span>
            <h2 className="font-display text-lg font-semibold text-[hsl(var(--text-1))]">
              Abrir caja
            </h2>
            <p className="mt-1 text-sm text-[hsl(var(--text-3))]">
              Cuente el efectivo con el que inicia el turno.
            </p>
            <Field
              label="Monto inicial (Q)"
              type="number"
              step="0.01"
              min="0"
              required
              autoFocus
              value={openingAmount}
              onChange={(e) => setOpeningAmount(e.target.value)}
              className="mt-4 money"
            />
            {error && (
              <div className="mt-3">
                <Notice tone="danger" icon="alerta">{error}</Notice>
              </div>
            )}
            <Button type="submit" variant="primary" size="lg" className="mt-4 w-full">
              Abrir caja
            </Button>
          </Panel>
        )}

        {session && (
          <div className="grid gap-4 lg:grid-cols-[1fr_370px]">
            <section>
              <form onSubmit={onScanSubmit} className="flex gap-2">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--text-3))]">
                    <Icon name="buscar" size={19} />
                  </span>
                  <input
                    ref={scanRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Escanee un código o escriba el nombre…"
                    aria-label="Buscar producto"
                    className="glass h-14 w-full rounded-2xl pl-11 pr-4 text-base text-[hsl(var(--text-1))] placeholder:text-[hsl(var(--text-3))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowCamera(true)}
                  aria-label="Escanear con la cámara"
                  title="Escanear con la cámara"
                  className="glass flex size-14 shrink-0 items-center justify-center rounded-2xl text-[hsl(var(--text-2))] transition-colors hover:text-[hsl(var(--accent))]"
                >
                  <Icon name="camara" size={22} />
                </button>
              </form>

              {error && (
                <div className="mt-3">
                  <Notice tone="warn" icon="alerta" onClose={() => setError(null)}>
                    {error}
                  </Notice>
                </div>
              )}

              {hits && (
                <Panel className="mt-2 overflow-hidden p-1.5">
                  {hits.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addToCart(p)}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
                    >
                      <span>
                        <span className="text-sm font-medium text-[hsl(var(--text-1))]">{p.name}</span>
                        <span className="ml-2 text-xs text-[hsl(var(--text-3))]">{p.sku}</span>
                      </span>
                      <span className="money text-sm font-semibold text-[hsl(var(--text-1))]">
                        {formatQ(BigInt(p.price))}
                      </span>
                    </button>
                  ))}
                </Panel>
              )}

              <Panel className="mt-3 overflow-hidden">
                {cart.length === 0 && (
                  <Empty icon="punto-venta">Escanee un producto para comenzar</Empty>
                )}
                {cart.map((line) => (
                  <div
                    key={line.product.id}
                    className="flex items-center gap-3 border-b border-white/[0.05] px-4 py-3 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[hsl(var(--text-1))]">
                        {line.product.name}
                      </p>
                      <p className="money text-xs text-[hsl(var(--text-3))]">
                        {formatQ(BigInt(line.product.price))} c/u
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <IconButton
                        icon="menos"
                        label="Quitar uno"
                        variant="outline"
                        onClick={() => setQty(line.product.id, line.qty - 1)}
                      />
                      <input
                        type="number"
                        step={line.product.unit.allowsDecimals ? '0.001' : '1'}
                        min="0"
                        value={line.qty}
                        onChange={(e) => setQty(line.product.id, Number(e.target.value))}
                        aria-label={`Cantidad de ${line.product.name}`}
                        className="money h-9 w-16 rounded-lg border border-white/[0.08] bg-white/[0.04] text-center text-sm text-[hsl(var(--text-1))]"
                      />
                      <IconButton
                        icon="mas"
                        label="Agregar uno"
                        variant="outline"
                        onClick={() => setQty(line.product.id, line.qty + 1)}
                      />
                    </div>
                    <p className="money w-24 text-right text-sm font-semibold text-[hsl(var(--text-1))]">
                      {formatQ(BigInt(Math.round(line.qty * Number(line.product.price))))}
                    </p>
                    <IconButton
                      icon="cerrar"
                      label={`Quitar ${line.product.name}`}
                      onClick={() => setCart((c) => c.filter((l) => l.product.id !== line.product.id))}
                    />
                  </div>
                ))}
              </Panel>
            </section>

            <aside className="lg:sticky lg:top-20 lg:h-fit">
              <Panel className="p-5">
                {!online && (
                  <div className="mb-3">
                    <Notice tone="warn" icon="sin-conexion">
                      Sin conexión — al cobrar se reintentará solo
                    </Notice>
                  </div>
                )}
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-3))]">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  Caja abierta · {session.salesCount} venta(s)
                </div>
                <p className="money mt-1 text-xs text-[hsl(var(--text-3))]">
                  Efectivo en caja {formatQ(BigInt(session.expectedSoFar))}
                </p>

                <p className="mt-5 text-sm text-[hsl(var(--text-2))]">Total a cobrar</p>
                <p className="money mt-1 text-[44px] font-semibold leading-none text-[hsl(var(--text-1))]">
                  {formatQ(total)}
                </p>
                <p className="mt-1.5 text-xs text-[hsl(var(--text-3))]">
                  {cart.length} artículo(s) · IVA incluido
                </p>

                <Button
                  variant="primary"
                  size="lg"
                  disabled={cart.length === 0}
                  onClick={() => setShowPay(true)}
                  className="mt-5 h-14 w-full text-base"
                >
                  Cobrar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={cart.length === 0}
                  onClick={() => setCart([])}
                  className="mt-2 w-full"
                >
                  Vaciar carrito
                </Button>
              </Panel>
            </aside>
          </div>
        )}
      </main>

      {showPay && session && (
        <PayModal
          total={total}
          storeId={storeId}
          sessionId={session.id}
          cart={cart}
          onClose={() => setShowPay(false)}
          onDone={(r) => {
            setShowPay(false);
            setCart([]);
            setReceipt(r);
            loadSession();
          }}
        />
      )}
      {showCamera && (
        <CameraScanner
          onDetected={(code) => {
            setShowCamera(false);
            lookup(code).catch(() => setError('Error al buscar el producto'));
          }}
          onClose={() => setShowCamera(false)}
        />
      )}
      {receipt && <ReceiptOverlay data={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function PayModal({
  total, storeId, sessionId, cart, onClose, onDone,
}: {
  total: bigint;
  storeId: string;
  sessionId: string;
  cart: CartLine[];
  onClose: () => void;
  onDone: (r: ReceiptData) => void;
}) {
  // clientOpId fijo por intento de cobro: los reintentos no duplican la venta.
  const clientOpId = useRef(crypto.randomUUID());
  const [method, setMethod] = useState<'CASH' | 'CARD' | 'TRANSFER'>('CASH');
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(0);

  const tenderedCents = tendered ? BigInt(toCentavos(tendered)) : 0n;
  const change = method === 'CASH' && tenderedCents > total ? tenderedCents - total : 0n;
  const faltante = method === 'CASH' && tendered !== '' && tenderedCents < total;

  /** Billetes frecuentes en Guatemala: evita teclear el monto recibido. */
  const sugerencias = [2000, 5000, 10000, 20000].filter((v) => BigInt(v) >= total).slice(0, 3);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payment =
        method === 'CASH'
          ? {
              method,
              amount: Number(total),
              ...(tendered ? { amountTendered: Number(tenderedCents) } : {}),
            }
          : { method, amount: Number(total), ...(reference ? { reference } : {}) };
      const body = JSON.stringify({
        storeId,
        cashSessionId: sessionId,
        clientOpId: clientOpId.current,
        items: cart.map((l) => ({ productId: l.product.id, qty: l.qty })),
        discount: 0,
        payments: [payment],
      });
      const res = await retryOnNetworkFailure(
        () => api<{ receipt: ReceiptData }>('/api/sales', { method: 'POST', body }),
        { onRetry: (attempt) => setRetrying(attempt) },
      );
      onDone(res.receipt);
    } catch (e2) {
      setError(
        e2 instanceof ApiError
          ? e2.message
          : 'No se pudo conectar. Intente de nuevo — la venta no se duplicará.',
      );
      setBusy(false);
      setRetrying(0);
    }
  }

  return (
    <Modal title={`Cobrar ${formatQ(total)}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="grid grid-cols-3 gap-2">
          {([
            ['CASH', 'Efectivo'],
            ['CARD', 'Tarjeta'],
            ['TRANSFER', 'Transf.'],
          ] as const).map(([m, label]) => (
            <button
              type="button"
              key={m}
              onClick={() => setMethod(m)}
              aria-pressed={method === m}
              className={cx(
                'rounded-xl border py-2.5 text-sm font-medium transition-all',
                method === m
                  ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent-strong))]'
                  : 'border-white/[0.08] text-[hsl(var(--text-2))] hover:bg-white/[0.05]',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {method === 'CASH' ? (
          <>
            <Field
              label="Efectivo recibido (Q)"
              type="number"
              step="0.01"
              min="0"
              autoFocus
              value={tendered}
              onChange={(e) => setTendered(e.target.value)}
              className="mt-4 money"
              error={faltante ? 'Es menor al total a cobrar' : undefined}
            />
            {sugerencias.length > 0 && (
              <div className="mt-2 flex gap-2">
                {sugerencias.map((v) => (
                  <Button
                    key={v}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="money flex-1"
                    onClick={() => setTendered((v / 100).toFixed(2))}
                  >
                    {formatQ(BigInt(v))}
                  </Button>
                ))}
              </div>
            )}
            {change > 0n && (
              <div className="mt-3 rounded-xl border border-[hsl(var(--accent)/0.3)] bg-[hsl(var(--accent)/0.1)] px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wider text-[hsl(var(--text-3))]">
                  Cambio
                </p>
                <p className="money text-2xl font-semibold text-[hsl(var(--accent-strong))]">
                  {formatQ(change)}
                </p>
              </div>
            )}
          </>
        ) : (
          <Field
            label="Referencia (opcional)"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="mt-4"
            placeholder="N.º de voucher o transferencia"
          />
        )}

        {retrying > 0 && busy && (
          <div className="mt-4">
            <Notice tone="warn" icon="sin-conexion">
              Sin respuesta de la red — reintentando ({retrying})… la venta no se duplicará.
            </Notice>
          </div>
        )}
        {error && (
          <div className="mt-4">
            <Notice tone="danger" icon="alerta">{error}</Notice>
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={busy}
          disabled={faltante}
          className="mt-5 h-13 w-full text-base"
        >
          Confirmar venta
        </Button>
      </form>
    </Modal>
  );
}

export function ReceiptOverlay({ data, onClose }: { data: ReceiptData; onClose: () => void }) {
  const [printError, setPrintError] = useState<string | null>(null);
  const thermal = isThermalPrintingAvailable();

  /** Con agente local: corte automático y gaveta. Sin él: diálogo del navegador. */
  async function print() {
    setPrintError(null);
    if (!thermal) return window.print();
    try {
      const printed = await printThermalReceipt(data, { openDrawer: true });
      if (!printed) window.print();
    } catch {
      setPrintError('No se pudo imprimir en la térmica; use la impresión del navegador.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm">
      <div className="surgir my-auto">
        <div className="mb-3 flex items-center justify-center gap-2 text-emerald-300 print:hidden">
          <Icon name="cheque" size={18} strokeWidth={2.2} />
          <span className="text-sm font-medium">Venta registrada</span>
        </div>
        <Receipt data={data} />
        {printError && (
          <div className="mt-3 max-w-[290px] print:hidden">
            <Notice tone="warn" icon="alerta">{printError}</Notice>
          </div>
        )}
        <div className="mt-3 flex gap-2 print:hidden">
          <Button variant="primary" icon="imprimir" onClick={print} className="flex-1">
            {thermal ? 'Imprimir (térmica)' : 'Imprimir'}
          </Button>
          <Button variant="outline" onClick={onClose} className="flex-1">
            Nueva venta
          </Button>
        </div>
      </div>
    </div>
  );
}
