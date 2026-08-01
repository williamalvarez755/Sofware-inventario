import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatQ, toCentavos } from '@minimarket/shared';
import { api, ApiError } from '../api/client';
import { Page } from '../components/Nav';
import {
  Badge, Button, Cell, Empty, Field, IconButton, Modal, Notice, Panel, Row, Select, Table,
} from '../components/ui';

interface StoreOpt { id: string; name: string }
interface SupplierOpt { id: string; name: string; isActive?: boolean }
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
interface Line { product: ProductHit; qty: number; cost: string }

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
    setRows((await api<{ rows: PurchaseRow[] }>(`/api/purchases?storeId=${storeId}`)).rows);
  }, [storeId]);

  useEffect(() => {
    load().catch((e) =>
      setError(
        e instanceof ApiError && e.status === 403
          ? 'No tiene permiso para ver compras'
          : 'Error cargando compras',
      ),
    );
  }, [load]);

  return (
    <Page
      title="Compras"
      subtitle="Recepción de mercadería y costo promedio"
      actions={
        <>
          <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Tienda" className="w-44">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Button variant="primary" icon="mas" onClick={() => setShowNew(true)}>
            Nueva compra
          </Button>
        </>
      }
    >
      {error && <div className="mb-4"><Notice tone="danger" icon="alerta">{error}</Notice></div>}
      {notice && (
        <div className="mb-4">
          <Notice tone="ok" icon="cheque" onClose={() => setNotice(null)}>{notice}</Notice>
        </div>
      )}

      <Table head={['Fecha', 'Proveedor', 'Factura', 'Líneas', 'Total', '']}>
        {rows.map((p) => (
          <Row key={p.id}>
            <Cell>{new Date(p.purchasedAt).toLocaleDateString('es-GT')}</Cell>
            <Cell>
              <span
                className={
                  p.status === 'VOIDED'
                    ? 'text-[hsl(var(--text-3))] line-through'
                    : 'font-medium text-[hsl(var(--text-1))]'
                }
              >
                {p.supplier.name}
              </span>
              {p.status === 'VOIDED' && <Badge tone="danger">Anulada</Badge>}
            </Cell>
            <Cell>{p.supplierInvoice ?? '—'}</Cell>
            <Cell align="right" mono>{p._count.items}</Cell>
            <Cell align="right" mono>{formatQ(BigInt(p.total))}</Cell>
            <Cell align="right">
              {p.status === 'RECEIVED' && (
                <Button size="sm" variant="danger" onClick={() => setVoidTarget(p)}>
                  Anular
                </Button>
              )}
            </Cell>
          </Row>
        ))}
        {rows.length === 0 && (
          <tr>
            <Cell colSpan={6}><Empty icon="compras">Sin compras registradas</Empty></Cell>
          </tr>
        )}
      </Table>

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
    </Page>
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
      const activos = s.filter((x) => x.isActive !== false);
      setSuppliers(activos);
      if (activos.length) setSupplierId(activos[0]!.id);
    });
  }, []);

  async function searchProducts() {
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

  const total = lines.reduce(
    (acc, l) => acc + BigInt(Math.round(l.qty * (l.cost ? toCentavos(l.cost) : 0))),
    0n,
  );

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
    <Modal title="Nueva compra" onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Proveedor" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Field
            label="N.º de factura del proveedor"
            value={invoice}
            onChange={(e) => setInvoice(e.target.value)}
          />
        </div>

        <Field
          icon="buscar"
          placeholder="Buscar producto y presionar Enter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              searchProducts();
            }
          }}
          className="mt-4"
        />
        {hits.length > 0 && (
          <Panel className="mt-1.5 overflow-hidden p-1">
            {hits.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => addLine(p)}
                className="flex w-full justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.06]"
              >
                <span className="text-[hsl(var(--text-1))]">{p.name}</span>
                <span className="text-xs text-[hsl(var(--text-3))]">{p.sku}</span>
              </button>
            ))}
          </Panel>
        )}

        <div className="mt-3 max-h-64 overflow-y-auto">
          {lines.map((l, idx) => (
            <div key={l.product.id} className="flex items-center gap-2 border-b border-white/[0.05] py-2 last:border-0">
              <span className="min-w-0 flex-1 truncate text-sm text-[hsl(var(--text-1))]">
                {l.product.name}
              </span>
              <input
                type="number" step="0.001" min="0.001" required value={l.qty}
                onChange={(e) =>
                  setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, qty: Number(e.target.value) } : x)))
                }
                aria-label={`Cantidad de ${l.product.name}`}
                className="money h-9 w-20 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 text-center text-sm text-[hsl(var(--text-1))]"
              />
              <div className="flex items-center gap-1">
                <span className="text-xs text-[hsl(var(--text-3))]">Q</span>
                <input
                  type="number" step="0.01" min="0.01" required placeholder="costo" value={l.cost}
                  onChange={(e) =>
                    setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, cost: e.target.value } : x)))
                  }
                  aria-label={`Costo unitario de ${l.product.name}`}
                  className="money h-9 w-24 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 text-right text-sm text-[hsl(var(--text-1))]"
                />
              </div>
              <IconButton
                icon="cerrar"
                label={`Quitar ${l.product.name}`}
                onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
              />
            </div>
          ))}
          {lines.length === 0 && (
            <p className="py-6 text-center text-sm text-[hsl(var(--text-3))]">
              Agregue productos a la compra
            </p>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-white/[0.07] pt-3">
          <span className="text-sm text-[hsl(var(--text-2))]">Total</span>
          <span className="money text-xl font-semibold text-[hsl(var(--text-1))]">
            {formatQ(total)}
          </span>
        </div>

        {error && <div className="mt-4"><Notice tone="danger" icon="alerta">{error}</Notice></div>}
        <Button
          type="submit" variant="primary" size="lg" loading={busy}
          disabled={lines.length === 0} className="mt-4 w-full"
        >
          Registrar compra
        </Button>
      </form>
    </Modal>
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
    <Modal
      title="Anular compra"
      description={`${purchase.supplier.name} · ${formatQ(BigInt(purchase.total))}. Revierte stock y costo promedio; solo es posible si la mercadería sigue en existencia.`}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <Field
          label="Motivo"
          required
          minLength={3}
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Obligatorio: queda en la bitácora."
        />
        {error && <div className="mt-4"><Notice tone="danger" icon="alerta">{error}</Notice></div>}
        <Button type="submit" variant="danger" size="lg" loading={busy} className="mt-5 w-full">
          Anular compra
        </Button>
      </form>
    </Modal>
  );
}
