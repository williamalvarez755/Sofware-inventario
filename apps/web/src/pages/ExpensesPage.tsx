import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatQ, toCentavos } from '@minimarket/shared';
import { api, ApiError } from '../api/client';
import { Nav } from '../components/Nav';

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

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

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
    const data = await api<{ rows: ExpenseRow[] }>(`/api/expenses?storeId=${storeId}`);
    setRows(data.rows);
  }, [storeId]);

  useEffect(() => {
    load().catch(() => setError('Error cargando gastos'));
  }, [load]);

  const monthTotal = rows.reduce((acc, r) => acc + BigInt(r.amount), 0n);

  return (
    <div className="min-h-screen bg-slate-100">
      <Nav />
      <main className="mx-auto max-w-4xl p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">Gastos</h1>
          <span className="text-sm text-slate-400">({formatQ(monthTotal)} listado)</span>
          <div className="ml-auto flex gap-2">
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={inputCls + ' mt-0 w-auto'}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button
              onClick={() => setShowNew(true)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              + Nuevo gasto
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
                <th className="px-4 py-3">Categoría</th>
                <th className="px-4 py-3">Descripción</th>
                <th className="px-4 py-3 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-600">
                    {new Date(g.expensedAt).toLocaleDateString('es-GT')}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {g.category.name}
                    </span>
                    {g.cashSessionId && (
                      <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                        de caja
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{g.description}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">
                    {formatQ(BigInt(g.amount))}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">Sin gastos registrados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

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
    </div>
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

  // Busca una sesión de caja abierta en la tienda para ofrecer "pagar de caja".
  useEffect(() => {
    (async () => {
      const registers = await api<{ id: string }[]>(`/api/cash/registers?storeId=${storeId}`);
      for (const r of registers) {
        const s = await api<{ id: string } | null>(`/api/cash/sessions/current?registerId=${r.id}`);
        if (s?.id) {
          setOpenSessionId(s.id);
          return;
        }
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
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-800">Nuevo gasto</h2>
        <label className="mt-3 block text-sm font-medium text-slate-700">
          Categoría *
          <select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="mt-3 block text-sm font-medium text-slate-700">
          Monto (Q) *
          <input type="number" step="0.01" min="0.01" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        </label>
        <label className="mt-3 block text-sm font-medium text-slate-700">
          Justificación * (obligatoria, queda en bitácora)
          <input required minLength={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} />
        </label>
        {openSessionId && (
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={fromCash} onChange={(e) => setFromCash(e.target.checked)} />
            Pagar desde la caja abierta (impacta el arqueo)
          </label>
        )}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="mt-4 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? 'Registrando…' : 'Registrar gasto'}
        </button>
      </form>
    </div>
  );
}
