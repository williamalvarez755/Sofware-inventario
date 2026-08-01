import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatQ, toCentavos } from '@minimarket/shared';
import { api, ApiError } from '../api/client';
import { Page } from '../components/Nav';
import {
  Badge, Button, Cell, Empty, Field, Modal, Notice, Row, Select, Table,
} from '../components/ui';

interface StoreOpt { id: string; name: string }
interface Category { id: string; name: string }
interface ExpenseRow {
  id: string;
  amount: string;
  description: string;
  expensedAt: string;
  cashSessionId: string | null;
  category: { id: string; name: string };
}

export function ExpensesPage() {
  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    api<StoreOpt[]>('/api/stores').then((s) => {
      setStores(s);
      if (s.length) setStoreId(s[0]!.id);
    });
    api<Category[]>('/api/expenses/categories').then(setCategories);
  }, []);

  const load = useCallback(async () => {
    if (!storeId) return;
    setRows((await api<{ rows: ExpenseRow[] }>(`/api/expenses?storeId=${storeId}`)).rows);
  }, [storeId]);

  useEffect(() => {
    load().catch(() => setError('Error cargando gastos'));
  }, [load]);

  const total = rows.reduce((acc, r) => acc + BigInt(r.amount), 0n);

  return (
    <Page
      title="Gastos"
      subtitle={`${formatQ(total)} en el listado`}
      actions={
        <>
          <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Tienda" className="w-44">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Button variant="primary" icon="mas" onClick={() => setShowNew(true)}>
            Nuevo gasto
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

      <Table head={['Fecha', 'Categoría', 'Descripción', 'Monto']}>
        {rows.map((g) => (
          <Row key={g.id}>
            <Cell>{new Date(g.expensedAt).toLocaleDateString('es-GT')}</Cell>
            <Cell>
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge>{g.category.name}</Badge>
                {g.cashSessionId && <Badge tone="accent" icon="caja">de caja</Badge>}
              </span>
            </Cell>
            <Cell className="text-[hsl(var(--text-1))]">{g.description}</Cell>
            <Cell align="right" mono>{formatQ(BigInt(g.amount))}</Cell>
          </Row>
        ))}
        {rows.length === 0 && (
          <tr>
            <Cell colSpan={4}><Empty icon="gastos">Sin gastos registrados</Empty></Cell>
          </tr>
        )}
      </Table>

      {showNew && (
        <NewExpenseModal
          storeId={storeId}
          categories={categories}
          onClose={() => setShowNew(false)}
          onSaved={(fromCash) => {
            setShowNew(false);
            setNotice(fromCash ? 'Gasto registrado y descontado de la caja abierta' : 'Gasto registrado');
            load();
          }}
        />
      )}
    </Page>
  );
}

function NewExpenseModal({
  storeId, categories, onClose, onSaved,
}: {
  storeId: string;
  categories: Category[];
  onClose: () => void;
  onSaved: (fromCash: boolean) => void;
}) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [fromCash, setFromCash] = useState(false);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Busca una caja abierta en la tienda para ofrecer "pagar de caja".
  useEffect(() => {
    (async () => {
      const registers = await api<{ id: string }[]>(`/api/cash/registers?storeId=${storeId}`);
      for (const r of registers) {
        const s = await api<{ id: string } | null>(`/api/cash/sessions/current?registerId=${r.id}`);
        if (s?.id) return setOpenSessionId(s.id);
      }
    })().catch(() => undefined);
  }, [storeId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          storeId,
          categoryId,
          amount: toCentavos(amount || '0'),
          description,
          ...(fromCash && openSessionId ? { cashSessionId: openSessionId } : {}),
        }),
      });
      onSaved(fromCash && Boolean(openSessionId));
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error al registrar el gasto');
      setBusy(false);
    }
  }

  return (
    <Modal title="Nuevo gasto" onClose={onClose}>
      <form onSubmit={submit}>
        <Select label="Categoría" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Field
          label="Monto (Q)"
          type="number" step="0.01" min="0.01" required autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="mt-3 money"
        />
        <Field
          label="Justificación"
          required minLength={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-3"
          hint="Obligatoria: queda en la bitácora."
        />
        {openSessionId && (
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3.5">
            <input
              type="checkbox"
              checked={fromCash}
              onChange={(e) => setFromCash(e.target.checked)}
              className="mt-0.5 size-4 accent-[hsl(var(--accent))]"
            />
            <span>
              <span className="block text-sm font-medium text-[hsl(var(--text-1))]">
                Pagar desde la caja abierta
              </span>
              <span className="block text-xs text-[hsl(var(--text-3))]">
                Descuenta el efectivo e impacta el arqueo del turno.
              </span>
            </span>
          </label>
        )}
        {error && <div className="mt-4"><Notice tone="danger" icon="alerta">{error}</Notice></div>}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-5 w-full">
          Registrar gasto
        </Button>
      </form>
    </Modal>
  );
}
