import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface StoreRow {
  id: string;
  name: string;
  address: string | null;
  isActive: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Dueño',
  STORE_ADMIN: 'Admin de tienda',
  WORKER: 'Trabajador',
};

export function DashboardPage() {
  const { me, logout } = useAuth();
  const [stores, setStores] = useState<StoreRow[] | null>(null);

  useEffect(() => {
    api<StoreRow[]>('/api/stores').then(setStores).catch(() => setStores([]));
  }, []);

  if (!me) return null;

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center justify-between bg-white px-6 py-4 shadow-sm">
        <div>
          <h1 className="text-lg font-bold text-slate-800">{me.tenant.name}</h1>
          <p className="text-sm text-slate-500">
            {me.user.name} ·{' '}
            {me.memberships.map((m) => ROLE_LABEL[m.role] ?? m.role).join(', ') || 'Sin rol'}
          </p>
        </div>
        <button
          onClick={logout}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Cerrar sesión
        </button>
      </header>

      <main className="mx-auto max-w-4xl p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Mis tiendas
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {stores === null && <p className="text-sm text-slate-400">Cargando…</p>}
          {stores?.map((s) => (
            <div key={s.id} className="rounded-xl bg-white p-5 shadow-sm">
              <h3 className="font-semibold text-slate-800">{s.name}</h3>
              <p className="mt-1 text-sm text-slate-500">{s.address ?? 'Sin dirección'}</p>
            </div>
          ))}
          {stores?.length === 0 && (
            <p className="text-sm text-slate-400">No tiene tiendas asignadas.</p>
          )}
        </div>
        <p className="mt-8 text-xs text-slate-400">
          Fase 0 — fundaciones. El POS, inventario y caja llegan en las fases 1 y 2.
        </p>
      </main>
    </div>
  );
}
