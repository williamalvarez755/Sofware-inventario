import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { formatQ, toCentavos } from '@minimarket/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Nav } from '../components/Nav';

interface StoreOpt {
  id: string;
  name: string;
}
interface Unit {
  id: string;
  code: string;
  name: string;
  allowsDecimals: boolean;
}
interface Category {
  id: string;
  name: string;
}
interface ProductRow {
  id: string;
  sku: string;
  name: string;
  category: Category | null;
  unit: Unit;
  price: string;
  stockQty?: string;
  minStock?: string;
  lowStock?: boolean;
}
interface KardexRow {
  id: string;
  type: string;
  qty: string;
  balanceAfter: string;
  note: string | null;
  createdAt: string;
  unitCost?: string;
}

const MOVEMENT_LABEL: Record<string, string> = {
  INITIAL: 'Carga inicial',
  PURCHASE: 'Compra',
  SALE: 'Venta',
  SALE_VOID: 'Venta anulada',
  ADJUSTMENT_IN: 'Ajuste (+)',
  ADJUSTMENT_OUT: 'Ajuste (−)',
  WASTE: 'Merma',
  INTERNAL_USE: 'Consumo interno',
  RETURN_IN: 'Devolución',
};

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

export function ProductsPage() {
  const { me } = useAuth();
  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState<string>('');
  const [units, setUnits] = useState<Unit[]>([]);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [adjustProduct, setAdjustProduct] = useState<ProductRow | null>(null);
  const [kardexProduct, setKardexProduct] = useState<ProductRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isWorkerOnly = me?.memberships.every((m) => m.role === 'WORKER') ?? true;

  useEffect(() => {
    api<StoreOpt[]>('/api/stores').then((s) => {
      setStores(s);
      if (s.length && !storeId) setStoreId(s[0]!.id);
    });
    api<Unit[]>('/api/units').then(setUnits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(async () => {
    if (!storeId) return;
    const params = new URLSearchParams({ storeId });
    if (search.trim()) params.set('search', search.trim());
    const data = await api<{ rows: ProductRow[]; total: number }>(`/api/products?${params}`);
    setRows(data.rows);
    setTotal(data.total);
  }, [storeId, search]);

  useEffect(() => {
    load().catch((e) => setError(e instanceof ApiError ? e.message : 'Error cargando productos'));
  }, [load]);

  async function onImportFile(file: File) {
    setError(null);
    try {
      const text = await file.text();
      const result = await api<{ created: number; updated: number; errors: { line: number; message: string }[] }>(
        `/api/products/import?storeId=${storeId}`,
        { method: 'POST', body: text, headers: { 'Content-Type': 'text/csv' } },
      );
      setNotice(
        `Importación: ${result.created} creados, ${result.updated} actualizados` +
          (result.errors.length
            ? `, ${result.errors.length} con error (líneas ${result.errors.slice(0, 5).map((e) => e.line).join(', ')}${result.errors.length > 5 ? '…' : ''})`
            : ''),
      );
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al importar');
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Nav />
      <main className="mx-auto max-w-6xl p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">Productos</h1>
          <span className="text-sm text-slate-400">({total})</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={inputCls + ' mt-0 w-auto'}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <input
              placeholder="Buscar por nombre, SKU o código…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={inputCls + ' mt-0 w-64'}
            />
            {!isWorkerOnly && (
              <>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="rounded-lg border border-emerald-600 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                >
                  Importar CSV
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onImportFile(f);
                    e.target.value = '';
                  }}
                />
                <button
                  onClick={() => setShowCreate(true)}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  + Nuevo producto
                </button>
              </>
            )}
          </div>
        </div>

        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {notice && (
          <p className="mb-3 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice}
            <button onClick={() => setNotice(null)} className="text-emerald-600">✕</button>
          </p>
        )}

        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Producto</th>
                <th className="px-4 py-3">Categoría</th>
                <th className="px-4 py-3 text-right">Precio</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{p.name}</div>
                    <div className="text-xs text-slate-400">{p.sku}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{p.category?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-700">
                    {formatQ(BigInt(p.price))}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={p.lowStock ? 'font-semibold text-red-600' : 'text-slate-700'}>
                      {p.stockQty ?? '0'} {p.unit.code.toLowerCase()}
                    </span>
                    {p.lowStock && (
                      <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                        bajo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setKardexProduct(p)} className="mr-2 text-xs font-medium text-slate-500 hover:text-slate-700">
                      Kardex
                    </button>
                    {!isWorkerOnly && (
                      <button onClick={() => setAdjustProduct(p)} className="text-xs font-medium text-emerald-700 hover:text-emerald-900">
                        Ajustar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    Sin productos. {!isWorkerOnly && 'Cree el primero o importe un CSV.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {showCreate && (
        <CreateProductModal
          storeId={storeId}
          units={units}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
      {adjustProduct && (
        <AdjustModal
          storeId={storeId}
          product={adjustProduct}
          onClose={() => setAdjustProduct(null)}
          onSaved={() => {
            setAdjustProduct(null);
            load();
          }}
        />
      )}
      {kardexProduct && (
        <KardexModal storeId={storeId} product={kardexProduct} onClose={() => setKardexProduct(null)} />
      )}
    </div>
  );
}

function CreateProductModal({
  storeId,
  units,
  onClose,
  onSaved,
}: {
  storeId: string;
  units: Unit[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    sku: '',
    categoryName: '',
    unitId: units.find((u) => u.code === 'UNIDAD')?.id ?? units[0]?.id ?? '',
    price: '',
    barcode: '',
    initialQty: '',
    initialCost: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const qty = Number(form.initialQty || '0');
      await api('/api/products', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          sku: form.sku || undefined,
          categoryName: form.categoryName || undefined,
          unitId: form.unitId,
          price: toCentavos(form.price || '0'),
          barcode: form.barcode || undefined,
          initial:
            qty > 0
              ? { storeId, qty, unitCost: toCentavos(form.initialCost || '0') }
              : undefined,
        }),
      });
      onSaved();
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error al guardar');
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Modal title="Nuevo producto" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm font-medium text-slate-700">
          Nombre *
          <input required value={form.name} onChange={set('name')} className={inputCls} autoFocus />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-slate-700">
            SKU (opcional)
            <input value={form.sku} onChange={set('sku')} className={inputCls} placeholder="auto" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Código de barras
            <input value={form.barcode} onChange={set('barcode')} className={inputCls} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Categoría
            <input value={form.categoryName} onChange={set('categoryName')} className={inputCls} placeholder="ej. Bebidas" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Unidad *
            <select required value={form.unitId} onChange={set('unitId')} className={inputCls}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Precio de venta (Q) *
            <input required type="number" step="0.01" min="0" value={form.price} onChange={set('price')} className={inputCls} />
          </label>
        </div>
        <fieldset className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold uppercase text-slate-400">Stock inicial (opcional)</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-slate-700">
              Cantidad
              <input type="number" step="0.001" min="0" value={form.initialQty} onChange={set('initialQty')} className={inputCls} />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Costo unitario (Q)
              <input type="number" step="0.01" min="0" value={form.initialCost} onChange={set('initialCost')} className={inputCls} />
            </label>
          </div>
        </fieldset>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? 'Guardando…' : 'Guardar producto'}
        </button>
      </form>
    </Modal>
  );
}

function AdjustModal({
  storeId,
  product,
  onClose,
  onSaved,
}: {
  storeId: string;
  product: ProductRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState('ADJUSTMENT_IN');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('/api/inventory/adjustments', {
        method: 'POST',
        body: JSON.stringify({ storeId, productId: product.id, type, qty: Number(qty), reason }),
      });
      onSaved();
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error al ajustar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Ajustar: ${product.name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">
        Stock actual: <strong>{product.stockQty ?? '0'}</strong> {product.unit.code.toLowerCase()}
      </p>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm font-medium text-slate-700">
          Tipo de movimiento
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
            <option value="ADJUSTMENT_IN">Entrada por ajuste (conteo físico)</option>
            <option value="ADJUSTMENT_OUT">Salida por ajuste (conteo físico)</option>
            <option value="WASTE">Merma / vencido / dañado</option>
            <option value="INTERNAL_USE">Consumo interno</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Cantidad
          <input
            required
            type="number"
            step={product.unit.allowsDecimals ? '0.001' : '1'}
            min={product.unit.allowsDecimals ? '0.001' : '1'}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Motivo * (obligatorio, queda en bitácora)
          <input required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? 'Registrando…' : 'Registrar ajuste'}
        </button>
      </form>
    </Modal>
  );
}

function KardexModal({
  storeId,
  product,
  onClose,
}: {
  storeId: string;
  product: ProductRow;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<KardexRow[] | null>(null);

  useEffect(() => {
    api<{ rows: KardexRow[] }>(`/api/inventory/kardex?storeId=${storeId}&productId=${product.id}`)
      .then((d) => setRows(d.rows))
      .catch(() => setRows([]));
  }, [storeId, product.id]);

  return (
    <Modal title={`Kardex: ${product.name}`} onClose={onClose}>
      {rows === null && <p className="text-sm text-slate-400">Cargando…</p>}
      {rows !== null && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
              <th className="py-2">Fecha</th>
              <th className="py-2">Movimiento</th>
              <th className="py-2 text-right">Cant.</th>
              <th className="py-2 text-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-b border-slate-50">
                <td className="py-2 text-xs text-slate-500">
                  {new Date(m.createdAt).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })}
                </td>
                <td className="py-2">
                  <span className="text-slate-700">{MOVEMENT_LABEL[m.type] ?? m.type}</span>
                  {m.note && <div className="text-xs text-slate-400">{m.note}</div>}
                </td>
                <td className={`py-2 text-right font-medium ${Number(m.qty) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {Number(m.qty) > 0 ? '+' : ''}{m.qty}
                </td>
                <td className="py-2 text-right text-slate-700">{m.balanceAfter}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-slate-400">Sin movimientos</td></tr>
            )}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
