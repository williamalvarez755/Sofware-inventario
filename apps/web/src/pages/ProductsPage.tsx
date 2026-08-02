import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { formatQ, toCentavos } from '@minimarket/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { CameraScanner } from '../components/CameraScanner';
import { Icon } from '../components/Icon';
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
  barcodes?: { id: string; barcode: string }[];
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
  // Código traído del escaneo: entra prellenado al alta para que el tendero
  // solo escriba nombre y precio.
  const [scanBarcode, setScanBarcode] = useState('');
  const [showScan, setShowScan] = useState(false);
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
              <Button variant="outline" icon="codigo" onClick={() => setShowScan(true)}>
                Escanear código
              </Button>
              <Button
                variant="primary"
                icon="mas"
                onClick={() => {
                  setScanBarcode('');
                  setShowCreate(true);
                }}
              >
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
              <span className="flex items-center gap-2 text-xs text-[hsl(var(--text-3))]">
                {p.sku}
                {p.barcodes?.[0] && (
                  <span className="inline-flex items-center gap-1">
                    <Icon name="codigo" size={13} />
                    <span className="money">{p.barcodes[0].barcode}</span>
                    {p.barcodes.length > 1 && <span>+{p.barcodes.length - 1}</span>}
                  </span>
                )}
              </span>
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

      {showScan && (
        <ScanModal
          storeId={storeId}
          onClose={() => setShowScan(false)}
          onCreate={(code) => {
            setShowScan(false);
            setScanBarcode(code);
            setShowCreate(true);
          }}
          onAdjust={(p) => {
            setShowScan(false);
            setAdjustProduct(p);
          }}
          onLinked={(msg) => {
            setNotice(msg);
            load();
          }}
        />
      )}

      {showCreate && (
        <CreateProductModal
          storeId={storeId}
          units={units}
          barcode={scanBarcode}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            setScanBarcode('');
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

/**
 * Alta por escaneo: el flujo real de una tienda es "tomo el producto de la
 * bolsa del proveedor, lo paso por el lector y lo doy de alta". El lector HID
 * escribe en el campo enfocado y termina en Enter, así que el campo se
 * autoenfoca y se vuelve a enfocar tras cada consulta.
 *
 * Cuando el código no existe hay DOS salidas, y la segunda es la que evita el
 * problema de verdad: el producto puede existir ya (cargado por CSV, sin
 * código) y crear otra ficha duplicaría el inventario. Por eso se ofrece
 * vincular el código a un producto existente.
 */
function ScanModal({
  storeId, onClose, onCreate, onAdjust, onLinked,
}: {
  storeId: string;
  onClose: () => void;
  onCreate: (barcode: string) => void;
  onAdjust: (product: ProductRow) => void;
  onLinked: (mensaje: string) => void;
}) {
  const [code, setCode] = useState('');
  const [found, setFound] = useState<ProductRow | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const lookup = useCallback(
    async (raw: string) => {
      const term = raw.trim();
      if (!term) return;
      setBusy(true);
      setError(null);
      setFound(null);
      setUnknown(null);
      setLinking(false);
      try {
        const p = await api<ProductRow>(
          `/api/products/barcode/${encodeURIComponent(term)}?storeId=${storeId}`,
        );
        setFound(p);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) setUnknown(term);
        else setError(e instanceof ApiError ? e.message : 'Error al consultar el código');
      } finally {
        setBusy(false);
        setCode('');
        inputRef.current?.focus();
      }
    },
    [storeId],
  );

  async function vincular(productId: string, nombre: string) {
    if (!unknown) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/products/${productId}/barcodes`, {
        method: 'POST',
        body: JSON.stringify({ barcode: unknown }),
      });
      onLinked(`Código ${unknown} vinculado a ${nombre}`);
      setUnknown(null);
      setLinking(false);
      inputRef.current?.focus();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo vincular el código');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Agregar por código de barras"
      description="Pase el producto por el lector o use la cámara."
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          lookup(code);
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[hsl(var(--text-3))]">
            <Icon name="codigo" size={19} />
          </span>
          <input
            ref={inputRef}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            // El lector HID termina la ráfaga con Enter. Se atiende aquí en vez
            // de confiar en el envío implícito del formulario: es LA interacción
            // de esta pantalla y no debe depender de una heurística del navegador.
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              lookup(e.currentTarget.value);
            }}
            placeholder="Escanee o escriba el código…"
            aria-label="Código de barras"
            className="money glass h-13 w-full rounded-2xl pl-11 pr-4 text-base text-[hsl(var(--text-1))] placeholder:font-sans placeholder:text-[hsl(var(--text-3))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--accent))]"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowCamera(true)}
          aria-label="Escanear con la cámara"
          title="Escanear con la cámara"
          className="glass flex size-13 shrink-0 items-center justify-center rounded-2xl text-[hsl(var(--text-2))] transition-colors hover:text-[hsl(var(--accent))]"
        >
          <Icon name="camara" size={22} />
        </button>
        {/* Botón explícito: el lector manda Enter solo, pero quien teclea el
            código a mano —en una tableta, sin teclado físico— necesita verlo. */}
        <Button type="submit" variant="primary" loading={busy} className="h-13 px-5">
          Buscar
        </Button>
      </form>

      {error && <div className="mt-3"><Notice tone="danger" icon="alerta">{error}</Notice></div>}

      {found && (
        <Panel className="mt-3 border border-emerald-500/25 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Badge tone="ok" icon="cheque">Ya está registrado</Badge>
              <p className="mt-2 font-display text-lg font-semibold text-[hsl(var(--text-1))]">
                {found.name}
              </p>
              <p className="text-xs text-[hsl(var(--text-3))]">{found.sku}</p>
            </div>
            <div className="text-right">
              <p className="money text-lg font-semibold text-[hsl(var(--text-1))]">
                {formatQ(BigInt(found.price))}
              </p>
              <p className="money mt-0.5 text-sm text-[hsl(var(--text-2))]">
                {found.stockQty ?? '0'} {found.unit.code.toLowerCase()} en existencia
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" icon="editar" onClick={() => onAdjust(found)}>
              Ajustar existencia
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFound(null)}>
              Escanear otro
            </Button>
          </div>
        </Panel>
      )}

      {unknown && !linking && (
        <Panel className="mt-3 border border-[hsl(var(--accent)/0.3)] p-4">
          <Badge tone="accent" icon="codigo">Código nuevo</Badge>
          <p className="money mt-2 text-lg font-semibold text-[hsl(var(--text-1))]">{unknown}</p>
          <p className="mt-1 text-sm text-[hsl(var(--text-2))]">
            Ningún producto tiene este código todavía.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" icon="mas" onClick={() => onCreate(unknown)}>
              Crear producto nuevo
            </Button>
            <Button variant="outline" icon="buscar" onClick={() => setLinking(true)}>
              Asignarlo a un producto que ya existe
            </Button>
          </div>
        </Panel>
      )}

      {unknown && linking && (
        <VincularProducto
          storeId={storeId}
          barcode={unknown}
          busy={busy}
          onPick={vincular}
          onCancel={() => setLinking(false)}
        />
      )}

      {!found && !unknown && !error && (
        <p className="py-8 text-center text-sm text-[hsl(var(--text-3))]">
          {busy ? 'Consultando…' : 'Esperando el código…'}
        </p>
      )}

      {showCamera && (
        <CameraScanner
          onDetected={(detectado) => {
            setShowCamera(false);
            lookup(detectado);
          }}
          onClose={() => setShowCamera(false)}
        />
      )}
    </Modal>
  );
}

/** Buscador para pegarle un código escaneado a un producto que ya existía. */
function VincularProducto({
  storeId, barcode, busy, onPick, onCancel,
}: {
  storeId: string;
  barcode: string;
  busy: boolean;
  onPick: (productId: string, nombre: string) => void;
  onCancel: () => void;
}) {
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<ProductRow[]>([]);

  useEffect(() => {
    if (term.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ rows: ProductRow[] }>(
        `/api/products?storeId=${storeId}&search=${encodeURIComponent(term.trim())}`,
      )
        .then((d) => setHits(d.rows.slice(0, 8)))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [term, storeId]);

  return (
    <Panel className="mt-3 p-4">
      <p className="text-sm text-[hsl(var(--text-2))]">
        Busque el producto al que pertenece el código{' '}
        <span className="money font-semibold text-[hsl(var(--text-1))]">{barcode}</span>
      </p>
      <Field
        icon="buscar"
        autoFocus
        placeholder="Nombre o SKU del producto…"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        aria-label="Buscar producto para vincular"
        className="mt-3"
      />
      <div className="mt-2 max-h-64 overflow-y-auto">
        {hits.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={busy}
            onClick={() => onPick(p.id, p.name)}
            className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06] disabled:opacity-50"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm text-[hsl(var(--text-1))]">{p.name}</span>
              <span className="text-xs text-[hsl(var(--text-3))]">{p.sku}</span>
            </span>
            <span className="money shrink-0 text-sm text-[hsl(var(--text-2))]">
              {p.stockQty ?? '0'} {p.unit.code.toLowerCase()}
            </span>
          </button>
        ))}
        {term.trim().length >= 2 && hits.length === 0 && (
          <p className="py-6 text-center text-sm text-[hsl(var(--text-3))]">Sin coincidencias</p>
        )}
      </div>
      <Button variant="ghost" size="sm" onClick={onCancel} className="mt-2">
        Volver
      </Button>
    </Panel>
  );
}

function CreateProductModal({
  storeId, units, barcode, onClose, onSaved,
}: {
  storeId: string;
  units: Unit[];
  barcode?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    sku: '',
    categoryName: '',
    unitId: units.find((u) => u.code === 'UNIDAD')?.id ?? units[0]?.id ?? '',
    price: '',
    barcode: barcode ?? '',
    initialQty: '',
    initialCost: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCamera, setShowCamera] = useState(false);

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
    <Modal
      title="Nuevo producto"
      description={barcode ? `Con el código escaneado ${barcode}` : undefined}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <Field label="Nombre" required autoFocus value={form.name} onChange={set('name')} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="SKU" placeholder="se genera solo" value={form.sku} onChange={set('sku')} />
          <div className="flex items-end gap-2">
            <Field
              label="Código de barras"
              icon="codigo"
              placeholder="escanee o escriba"
              value={form.barcode}
              onChange={set('barcode')}
              className="flex-1 money"
            />
            <button
              type="button"
              onClick={() => setShowCamera(true)}
              aria-label="Escanear con la cámara"
              title="Escanear con la cámara"
              className="mb-0 flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[hsl(var(--text-2))] transition-colors hover:text-[hsl(var(--accent))]"
            >
              <Icon name="camara" size={19} />
            </button>
          </div>
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

      {showCamera && (
        <CameraScanner
          onDetected={(detectado) => {
            setShowCamera(false);
            setForm((f) => ({ ...f, barcode: detectado }));
          }}
          onClose={() => setShowCamera(false)}
        />
      )}
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
