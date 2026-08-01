import { useCallback, useEffect, useRef, useState } from 'react';
import { formatQ, toCentavos } from '@minimarket/shared';
import { api, ApiError } from '../api/client';
import { Nav } from '../components/Nav';
import { Receipt, type ReceiptData } from '../components/Receipt';

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

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

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
  const scanRef = useRef<HTMLInputElement>(null);

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
    const s = await api<Session | null>(`/api/cash/sessions/current?registerId=${registerId}`);
    setSession(s);
    setSessionLoaded(true);
  }, [registerId]);

  useEffect(() => {
    loadSession().catch(() => setSessionLoaded(true));
  }, [loadSession]);

  useEffect(() => {
    scanRef.current?.focus();
  }, [session, cart.length]);

  function addToCart(product: ProductHit) {
    setCart((c) => {
      const existing = c.find((l) => l.product.id === product.id);
      if (existing) {
        return c.map((l) => (l.product.id === product.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...c, { product, qty: 1 }];
    });
    setHits(null);
    setQuery('');
    setError(null);
  }

  /** Enter en el input de escaneo: lector HID (ráfaga + Enter) o búsqueda manual. */
  async function onScanSubmit(e: React.FormEvent) {
    e.preventDefault();
    const term = query.trim();
    if (!term) return;
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
  }

  function setQty(productId: string, qty: number) {
    if (Number.isNaN(qty) || qty <= 0) return;
    setCart((c) => c.map((l) => (l.product.id === productId ? { ...l, qty } : l)));
  }

  const total = cart.reduce(
    (acc, l) => acc + BigInt(Math.round(l.qty * Number(l.product.price))),
    0n,
  );

  async function openCashSession(e: React.FormEvent) {
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
    <div className="min-h-screen bg-slate-100">
      <Nav />
      <main className="mx-auto max-w-5xl p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-slate-800">POS</h1>
          <div className="ml-auto flex gap-2">
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={inputCls + ' w-auto'}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={registerId} onChange={(e) => setRegisterId(e.target.value)} className={inputCls + ' w-auto'}>
              {registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>

        {sessionLoaded && !session && (
          <form onSubmit={openCashSession} className="mx-auto mt-10 max-w-sm rounded-2xl bg-white p-6 shadow">
            <h2 className="text-lg font-bold text-slate-800">Abrir caja</h2>
            <p className="mt-1 text-sm text-slate-500">
              Cuente el efectivo inicial del turno para empezar a vender.
            </p>
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Monto inicial (Q)
              <input
                type="number" step="0.01" min="0" required autoFocus
                value={openingAmount}
                onChange={(e) => setOpeningAmount(e.target.value)}
                className={inputCls + ' mt-1'}
              />
            </label>
            {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button className="mt-4 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
              Abrir caja
            </button>
          </form>
        )}

        {session && (
          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <section>
              <form onSubmit={onScanSubmit}>
                <input
                  ref={scanRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Escanee un código o escriba el nombre y presione Enter…"
                  className={inputCls + ' py-3 text-base'}
                />
              </form>
              {error && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p>}
              {hits && (
                <div className="mt-2 overflow-hidden rounded-xl bg-white shadow">
                  {hits.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addToCart(p)}
                      className="flex w-full items-center justify-between border-b border-slate-50 px-4 py-3 text-left hover:bg-emerald-50"
                    >
                      <span>
                        <span className="font-medium text-slate-800">{p.name}</span>
                        <span className="ml-2 text-xs text-slate-400">{p.sku}</span>
                      </span>
                      <span className="text-sm font-semibold text-slate-700">{formatQ(BigInt(p.price))}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-3 overflow-hidden rounded-xl bg-white shadow-sm">
                {cart.length === 0 && (
                  <p className="p-8 text-center text-slate-400">Carrito vacío — escanee un producto</p>
                )}
                {cart.map((line) => (
                  <div key={line.product.id} className="flex items-center gap-3 border-b border-slate-50 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-800">{line.product.name}</p>
                      <p className="text-xs text-slate-400">{formatQ(BigInt(line.product.price))} c/u</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setQty(line.product.id, line.qty - 1)} className="h-8 w-8 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">−</button>
                      <input
                        type="number"
                        step={line.product.unit.allowsDecimals ? '0.001' : '1'}
                        min="0"
                        value={line.qty}
                        onChange={(e) => setQty(line.product.id, Number(e.target.value))}
                        className="h-8 w-16 rounded-lg border border-slate-300 text-center text-sm"
                      />
                      <button onClick={() => setQty(line.product.id, line.qty + 1)} className="h-8 w-8 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">+</button>
                    </div>
                    <p className="w-20 text-right font-semibold text-slate-800">
                      {formatQ(BigInt(Math.round(line.qty * Number(line.product.price))))}
                    </p>
                    <button
                      onClick={() => setCart((c) => c.filter((l) => l.product.id !== line.product.id))}
                      className="text-slate-300 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <aside className="h-fit rounded-xl bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-400">
                Caja abierta · {session.salesCount} venta(s) · efectivo {formatQ(BigInt(session.expectedSoFar))}
              </p>
              <p className="mt-3 text-sm text-slate-500">Total a cobrar</p>
              <p className="text-4xl font-bold text-slate-900">{formatQ(total)}</p>
              <button
                disabled={cart.length === 0}
                onClick={() => setShowPay(true)}
                className="mt-4 w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                Cobrar
              </button>
              <button
                disabled={cart.length === 0}
                onClick={() => setCart([])}
                className="mt-2 w-full rounded-lg border border-slate-200 py-2 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-40"
              >
                Vaciar carrito
              </button>
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

  const tenderedCents = tendered ? BigInt(toCentavos(tendered)) : 0n;
  const change = method === 'CASH' && tenderedCents > total ? tenderedCents - total : 0n;

  async function submit(e: React.FormEvent) {
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
      const res = await api<{ receipt: ReceiptData }>('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          storeId,
          cashSessionId: sessionId,
          clientOpId: clientOpId.current,
          items: cart.map((l) => ({ productId: l.product.id, qty: l.qty })),
          discount: 0,
          payments: [payment],
        }),
      });
      onDone(res.receipt);
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error al cobrar');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 className="text-lg font-bold text-slate-800">Cobrar {formatQ(total)}</h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(['CASH', 'CARD', 'TRANSFER'] as const).map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => setMethod(m)}
              className={`rounded-lg border py-2 text-sm font-medium ${
                method === m ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'
              }`}
            >
              {m === 'CASH' ? 'Efectivo' : m === 'CARD' ? 'Tarjeta' : 'Transf.'}
            </button>
          ))}
        </div>
        {method === 'CASH' && (
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Efectivo recibido (Q)
            <input
              type="number" step="0.01" min="0" autoFocus
              value={tendered}
              onChange={(e) => setTendered(e.target.value)}
              className={inputCls + ' mt-1'}
            />
            {change > 0n && (
              <p className="mt-2 text-base font-semibold text-emerald-700">Cambio: {formatQ(change)}</p>
            )}
          </label>
        )}
        {method !== 'CASH' && (
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Referencia (opcional)
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls + ' mt-1'} />
          </label>
        )}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          disabled={busy || (method === 'CASH' && tendered !== '' && tenderedCents < total)}
          className="mt-4 w-full rounded-xl bg-emerald-600 py-3 text-base font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          {busy ? 'Procesando…' : 'Confirmar venta'}
        </button>
      </form>
    </div>
  );
}

export function ReceiptOverlay({ data, onClose }: { data: ReceiptData; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] overflow-y-auto rounded-2xl bg-slate-50 p-4 shadow-xl">
        <Receipt data={data} />
        <div className="mt-3 flex gap-2 print:hidden">
          <button
            onClick={() => window.print()}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Imprimir
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-white"
          >
            Nueva venta
          </button>
        </div>
      </div>
    </div>
  );
}
