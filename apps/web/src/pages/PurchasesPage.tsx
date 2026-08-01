import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatQ, toCentavos } from '@minimarket/shared';
import { api, ApiError } from '../api/client';
import { Nav } from '../components/Nav';

interface StoreOpt { id: string; name: string }
interface SupplierOpt { id: string; name: string }
interface PurchaseRow {
  id: string;
  status: string;
  supplierInvoice: string | null;
  purchasedAt: string;
  total: string;
  supplier: { name: string };
  _count: { items: number };
}
interface ProductHit { id: string; name: string; sku: string }
interface Line { product: ProductHit; qty: number; cost: string } // cost en Q (texto)

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

export function PurchasesPage() {
  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  const [rows, setRows] = useState<PurchaseRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [voidTarget, setVoidTarget] = useState<PurchaseRow | null>(null);

  useEffect(() => {
    api<StoreOpt[]>('/api/stores').then((s) => {
      setStores(s);
      if (s.length) setStoreId(s[0]!.id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!storeId) return;
    const data = await api<{ rows: PurchaseRow[] }>(`/api/purchases?storeId=${storeId}`);
    setRows(data.rows);
  }, [storeId]);

  useEffect(() => {
    load().catch((e) =>
      setError(e instanceof ApiError && e.status === 403
        ? 'No tiene permiso para ver compras'
        : 'Error cargando compras'),
    );
  }, [load]);

  return (
    <div className="min-h-screen bg-slate-100">
      <Nav />
      <main className="mx-auto max-w-5xl p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">Compras</h1>
          <div className="ml-auto flex gap-2">
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={inputCls + ' w-auto'}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button
              onClick={() => setShowNew(true)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              + Nueva compra
            </button>
          </div>
        </div>
        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {notice && (
          <p className="mb-3 flex justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice} <button onClick={() => setNotice(null)}>✕</button>
          </p>
        )}

        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Proveedor</th>
                <th className="px-4 py-3">Factura</th>
                <th className="px-4 py-3 text-right">Líneas</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600">
                    {new Date(p.purchasedAt).toLocaleDateString('es-GT')}
                  </td>
                  <td className={`px-4 py-3 ${p.status === 'VOIDED' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                    {p.supplier.name}
                    {p.status === 'VOIDED' && <span className="ml-2 text-xs text-red-500">Anulada</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{p.supplierInvoice ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{p._count.items}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatQ(BigInt(p.total))}</td>
                  <td className="px-4 py-3 text-right">
                    {p.status === 'RECEIVED' && (
                      <button onClick={() => setVoidTarget(p)} className="text-xs font-medium text-red-600 hover:text-red-800">
                        Anular
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Sin compras registradas</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {showNew && (
        <NewPurchaseModal
          storeId={storeId}
          onClose={() => setShowNew(false)}
          onSaved={(total) => {
            setShowNew(false);
            setNotice(`Compra registrada por ${total}: stock y costo promedio actualizados`);
            load();
          }}
        />
      )}
      {voidTarget && (
        <VoidPurchaseModal
          purchase={voidTarget}
          onClose={() => setVoidTarget(null)}
          onDone={() => {
            setVoidTarget(null);
            setNotice('Compra anulada: stock y costo promedio revertidos');
            load();
          }}
        />
      )}
    </div>
  );
}

function NewPurchaseModal({
  storeId, onClose, onSaved,
}: {
  storeId: string;
  onClose: () => void;
  onSaved: (total: string) => void;
}) {
  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [invoice, setInvoice] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SupplierOpt[]>('/api/suppliers').then((s) => {
      setSuppliers(s.filter((x) => (x as { isActive?: boolean }).isActive !== false));
      if (s.length) setSupplierId(s[0]!.id);
    });
  }, []);

  async function searchProducts(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    const data = await api<{ rows: ProductHit[] }>(
      `/api/products?storeId=${storeId}&search=${encodeURIComponent(query.trim())}`,
    );
    setHits(data.rows.slice(0, 6));
  }

  function addLine(product: ProductHit) {
    if (!lines.some((l) => l.product.id === product.id)) {
      setLines((ls) => [...ls, { product, qty: 1, cost: '' }]);
    }
    setHits([]);
    setQuery('');
  }

  const total = lines.reduce((acc, l) => {
    const cost = l.cost ? toCentavos(l.cost) : 0;
    return acc + BigInt(Math.round(l.qty * cost));
  }, 0n);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('/api/purchases', {
        method: 'POST',
        body: JSON.stringify({
          storeId,
          supplierId,
          supplierInvoice: invoice || undefined,
          items: lines.map((l) => ({
            productId: l.product.id,
            qty: l.qty,
            unitCost: toCentavos(l.cost || '0'),
          })),
        }),
      });
      onSaved(formatQ(total));
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error al registrar la compra');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 className="text-lg font-bold text-slate-800">Nueva compra</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-slate-700">
            Proveedor *
            <select required value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputCls + ' mt-1'}>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Nº factura del proveedor
            <input value={invoice} onChange={(e) => setInvoice(e.target.value)} className={inputCls + ' mt-1'} />
          </label>
        </div>

        <div className="mt-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                searchProducts(e);
              }
            }}
            placeholder="Buscar producto por nombre, SKU o código y presionar Enter…"
            className={inputCls}
          />
          {hits.length > 0 && (
            <div className="mt-1 overflow-hidden rounded-lg border border-slate-200">
              {hits.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => addLine(p)}
                  className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-emerald-50"
                >
                  <span>{p.name}</span>
                  <span className="text-xs text-slate-400">{p.sku}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3">
          {lines.map((l, idx) => (
            <div key={l.product.id} className="flex items-center gap-2 border-b border-slate-50 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{l.product.name}</span>
              <input
                type="number" step="0.001" min="0.001" required
                value={l.qty}
                onChange={(e) =>
                  setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, qty: Number(e.target.value) } : x)))
                }
                className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-center text-sm"
                title="Cantidad"
              />
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-400">Q</span>
                <input
                  type="number" step="0.01" min="0.01" required placeholder="costo"
                  value={l.cost}
                  onChange={(e) =>
                    setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, cost: e.target.value } : x)))
                  }
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm"
                  title="Costo unitario"
                />
              </div>
              <button
                type="button"
                onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                className="text-slate-300 hover:text-red-500"
              >
                ✕
              </button>
            </div>
          ))}
          {lines.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">Agregue productos a la compra</p>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm text-slate-500">Total</span>
          <span className="text-xl font-bold text-slate-900">{formatQ(total)}</span>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          disabled={busy || lines.length === 0}
          className="mt-4 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          {busy ? 'Registrando…' : 'Registrar compra (actualiza stock y CPP)'}
        </button>
      </form>
    </div>
  );
}

function VoidPurchaseModal({
  purchase, onClose, onDone,
}: {
  purchase: PurchaseRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api(`/api/purchases/${purchase.id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      onDone();
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error al anular');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-800">Anular compra</h2>
        <p className="mt-1 text-sm text-slate-500">
          {purchase.supplier.name} · {formatQ(BigInt(purchase.total))}. Revierte stock y costo promedio.
          Solo es posible si la mercadería sigue en existencia.
        </p>
        <label className="mt-3 block text-sm font-medium text-slate-700">
          Motivo * (queda en bitácora)
          <input required minLength={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls + ' mt-1'} />
        </label>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="mt-4 w-full rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
          {busy ? 'Anulando…' : 'Anular compra'}
        </button>
      </form>
    </div>
  );
}
