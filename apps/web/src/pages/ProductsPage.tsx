import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { formatQ, toCentavos } from '@minimarket/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Page } from '../components/Nav';
import {
  Badge,
  Button,
  Cell,
  Empty,
  Field,
  Modal,
  Notice,
  Panel,
  Row,
  Select,
  Table,
} from '../components/ui';

interface StoreOpt { id: string; name: string }
interface Unit { id: string; code: string; name: string; allowsDecimals: boolean }
interface Category { id: string; name: string }
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
  PURCHASE_VOID: 'Compra anulada',
  SALE: 'Venta',
  SALE_VOID: 'Venta anulada',
  ADJUSTMENT_IN: 'Ajuste (entrada)',
  ADJUSTMENT_OUT: 'Ajuste (salida)',
  WASTE: 'Merma',
  INTERNAL_USE: 'Consumo interno',
  RETURN_IN: 'Devolución',
};

export function ProductsPage() {
  const { me } = useAuth();
  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
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
      if (s.length) setStoreId(s[0]!.id);
    });
    api<Unit[]>('/api/units').then(setUnits);
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
      const result = await api<{
        created: number;
        updated: number;
        errors: { line: number; message: string }[];
      }>(`/api/products/import?storeId=${storeId}`, {
        method: 'POST',
        body: text,
        headers: { 'Content-Type': 'text/csv' },
      });
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
    <Page
      title="Productos"
      subtitle={`${total} en el catálogo`}
      wide
      actions={
        <>
          <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Tienda" className="w-44">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Field
            icon="buscar"
            placeholder="Buscar por nombre, SKU o código…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar producto"
            className="w-64"
          />
          {!isWorkerOnly && (
            <>
              <Button variant="outline" icon="descargar" onClick={() => fileRef.current?.click()}>
                Importar CSV
              </Button>
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
              <Button variant="primary" icon="mas" onClick={() => setShowCreate(true)}>
                Nuevo producto
              </Button>
            </>
          )}
        </>
      }
    >
      {error && <div className="mb-4"><Notice tone="danger" icon="alerta">{error}</Notice></div>}
      {notice && (
        <div className="mb-4">
          <Notice tone="ok" icon="cheque" onClose={() => setNotice(null)}>{notice}</Notice>
        </div>
      )}

      <Table head={['Producto', 'Categoría', 'Precio', 'Existencia', '']}>
        {rows.map((p) => (
          <Row key={p.id}>
            <Cell>
              <span className="block font-medium text-[hsl(var(--text-1))]">{p.name}</span>
              <span className="text-xs text-[hsl(var(--text-3))]">{p.sku}</span>
            </Cell>
            <Cell>{p.category?.name ?? '—'}</Cell>
            <Cell mono align="right">{formatQ(BigInt(p.price))}</Cell>
            <Cell align="right">
              <span className="inline-flex items-center gap-2">
                <span className={p.lowStock ? 'money font-semibold text-red-400' : 'money'}>
                  {p.stockQty ?? '0'} {p.unit.code.toLowerCase()}
                </span>
                {p.lowStock && <Badge tone="danger">bajo</Badge>}
              </span>
            </Cell>
            <Cell align="right">
              <span className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => setKardexProduct(p)}>
                  Kardex
                </Button>
                {!isWorkerOnly && (
                  <Button size="sm" variant="outline" onClick={() => setAdjustProduct(p)}>
                    Ajustar
                  </Button>
                )}
              </span>
            </Cell>
          </Row>
        ))}
        {rows.length === 0 && (
          <tr>
            <Cell colSpan={5}>
              <Empty icon="productos">
                Sin productos. {!isWorkerOnly && 'Cree el primero o importe un CSV.'}
              </Empty>
            </Cell>
          </tr>
        )}
      </Table>

      {showCreate && (
        <CreateProductModal
          storeId={storeId}
          units={units}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            setNotice('Producto creado');
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
            setNotice('Ajuste registrado en el kardex');
            load();
          }}
        />
      )}
      {kardexProduct && (
        <KardexModal storeId={storeId} product={kardexProduct} onClose={() => setKardexProduct(null)} />
      )}
    </Page>
  );
}

function CreateProductModal({
  storeId, units, onClose, onSaved,
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

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

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
            qty > 0 ? { storeId, qty, unitCost: toCentavos(form.initialCost || '0') } : undefined,
        }),
      });
      onSaved();
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error al guardar');
      setBusy(false);
    }
  }

  return (
    <Modal title="Nuevo producto" onClose={onClose} wide>
      <form onSubmit={submit}>
        <Field label="Nombre" required autoFocus value={form.name} onChange={set('name')} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="SKU" placeholder="se genera solo" value={form.sku} onChange={set('sku')} />
          <Field label="Código de barras" value={form.barcode} onChange={set('barcode')} />
          <Field
            label="Categoría"
            placeholder="ej. Bebidas"
            value={form.categoryName}
            onChange={set('categoryName')}
          />
          <Select label="Unidad" required value={form.unitId} onChange={set('unitId')}>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <Field
            label="Precio de venta (Q)"
            type="number"
            step="0.01"
            min="0"
            required
            value={form.price}
            onChange={set('price')}
            className="money"
          />
        </div>

        <fieldset className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-3))]">
            Existencia inicial (opcional)
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Cantidad"
              type="number"
              step="0.001"
              min="0"
              value={form.initialQty}
              onChange={set('initialQty')}
              className="money"
            />
            <Field
              label="Costo unitario (Q)"
              type="number"
              step="0.01"
              min="0"
              value={form.initialCost}
              onChange={set('initialCost')}
              className="money"
            />
          </div>
        </fieldset>

        {error && <div className="mt-4"><Notice tone="danger" icon="alerta">{error}</Notice></div>}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-5 w-full">
          Guardar producto
        </Button>
      </form>
    </Modal>
  );
}

function AdjustModal({
  storeId, product, onClose, onSaved,
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
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Ajustar: ${product.name}`}
      description={`Existencia actual: ${product.stockQty ?? '0'} ${product.unit.code.toLowerCase()}`}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <Select label="Tipo de movimiento" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="ADJUSTMENT_IN">Entrada por ajuste (conteo físico)</option>
          <option value="ADJUSTMENT_OUT">Salida por ajuste (conteo físico)</option>
          <option value="WASTE">Merma / vencido / dañado</option>
          <option value="INTERNAL_USE">Consumo interno</option>
        </Select>
        <Field
          label="Cantidad"
          type="number"
          step={product.unit.allowsDecimals ? '0.001' : '1'}
          min={product.unit.allowsDecimals ? '0.001' : '1'}
          required
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="mt-3 money"
        />
        <Field
          label="Motivo"
          required
          minLength={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-3"
          hint="Obligatorio: queda en la bitácora."
        />
        {error && <div className="mt-4"><Notice tone="danger" icon="alerta">{error}</Notice></div>}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-5 w-full">
          Registrar ajuste
        </Button>
      </form>
    </Modal>
  );
}

function KardexModal({
  storeId, product, onClose,
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
    <Modal title={`Kardex: ${product.name}`} onClose={onClose} wide>
      {rows === null && <p className="py-8 text-center text-sm text-[hsl(var(--text-3))]">Cargando…</p>}
      {rows !== null && rows.length === 0 && <Empty icon="productos">Sin movimientos</Empty>}
      {rows !== null && rows.length > 0 && (
        <div className="max-h-[26rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[hsl(var(--surface-1))]">
              <tr className="border-b border-white/[0.07] text-left text-[11px] uppercase tracking-wider text-[hsl(var(--text-3))]">
                <th className="py-2 pr-3">Fecha</th>
                <th className="py-2 pr-3">Movimiento</th>
                <th className="py-2 text-right">Cantidad</th>
                <th className="py-2 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-white/[0.04] last:border-0">
                  <td className="py-2 pr-3 text-xs text-[hsl(var(--text-3))]">
                    {new Date(m.createdAt).toLocaleString('es-GT', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="text-[hsl(var(--text-1))]">
                      {MOVEMENT_LABEL[m.type] ?? m.type}
                    </span>
                    {m.note && (
                      <span className="block text-xs text-[hsl(var(--text-3))]">{m.note}</span>
                    )}
                  </td>
                  <td
                    className={`money py-2 text-right font-medium ${
                      Number(m.qty) < 0 ? 'text-red-400' : 'text-emerald-300'
                    }`}
                  >
                    {Number(m.qty) > 0 ? '+' : ''}
                    {m.qty}
                  </td>
                  <td className="money py-2 text-right text-[hsl(var(--text-1))]">
                    {m.balanceAfter}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
