import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { Nav } from '../components/Nav';

export interface SupplierRow {
  id: string;
  name: string;
  taxId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  _count?: { purchases: number };
}

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

export function SuppliersPage() {
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SupplierRow | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
    setRows(await api<SupplierRow[]>(`/api/suppliers${params}`));
  }, [search]);

  useEffect(() => {
    load().catch((e) =>
      setError(e instanceof ApiError && e.status === 403
        ? 'No tiene permiso para ver proveedores'
        : 'Error cargando proveedores'),
    );
  }, [load]);

  return (
    <div className="min-h-screen bg-slate-100">
      <Nav />
      <main className="mx-auto max-w-4xl p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">Proveedores</h1>
          <div className="ml-auto flex gap-2">
            <input
              placeholder="Buscar…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={inputCls + ' mt-0 w-56'}
            />
            <button
              onClick={() => setEditing('new')}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              + Nuevo proveedor
            </button>
          </div>
        </div>
        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">Proveedor</th>
                <th className="px-4 py-3">Contacto</th>
                <th className="px-4 py-3 text-right">Compras</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <span className={s.isActive ? 'font-medium text-slate-800' : 'text-slate-400 line-through'}>
                      {s.name}
                    </span>
                    {s.taxId && <div className="text-xs text-slate-400">NIT: {s.taxId}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {s.contactName ?? '—'}
                    {s.phone && <div className="text-xs text-slate-400">{s.phone}</div>}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">{s._count?.purchases ?? 0}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(s)} className="text-xs font-medium text-emerald-700 hover:text-emerald-900">
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">Sin proveedores</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {editing && (
        <SupplierModal
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function SupplierModal({
  supplier, onClose, onSaved,
}: {
  supplier: SupplierRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: supplier?.name ?? '',
    taxId: supplier?.taxId ?? '',
    contactName: supplier?.contactName ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    isActive: supplier?.isActive ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        name: form.name,
        taxId: form.taxId || undefined,
        contactName: form.contactName || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        ...(supplier ? { isActive: form.isActive } : {}),
      };
      await api(supplier ? `/api/suppliers/${supplier.id}` : '/api/suppliers', {
        method: supplier ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error al guardar');
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-800">
          {supplier ? 'Editar proveedor' : 'Nuevo proveedor'}
        </h2>
        <label className="mt-3 block text-sm font-medium text-slate-700">
          Nombre *
          <input required minLength={2} value={form.name} onChange={set('name')} className={inputCls} autoFocus />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-slate-700">
            NIT
            <input value={form.taxId} onChange={set('taxId')} className={inputCls} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Contacto
            <input value={form.contactName} onChange={set('contactName')} className={inputCls} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Teléfono
            <input value={form.phone} onChange={set('phone')} className={inputCls} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input type="email" value={form.email} onChange={set('email')} className={inputCls} />
          </label>
        </div>
        {supplier && (
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Activo (los inactivos no aceptan compras nuevas)
          </label>
        )}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="mt-4 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
    </div>
  );
}
