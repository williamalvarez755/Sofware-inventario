import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, getImpersonation, stopImpersonation } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  createdAt: string;
  readAt: string | null;
}

const LINKS = [
  { to: '/', label: 'Inicio' },
  { to: '/pos', label: 'POS' },
  { to: '/caja', label: 'Caja' },
  { to: '/productos', label: 'Productos' },
  { to: '/compras', label: 'Compras' },
  { to: '/gastos', label: 'Gastos' },
  { to: '/proveedores', label: 'Proveedores' },
  { to: '/reportes', label: 'Reportes' },
];

export function Nav() {
  const { me, logout } = useAuth();
  const { pathname } = useLocation();
  const impersonation = getImpersonation();

  if (!me) return null;

  return (
    <>
      {impersonation && (
        <div className="flex flex-wrap items-center gap-3 bg-amber-500 px-6 py-2 text-sm font-medium text-amber-950">
          <span>
            👁️ Sesión de soporte — viendo <strong>{impersonation.tenantName}</strong> como{' '}
            {impersonation.actingAs}. Solo lectura: no puede modificar datos del cliente.
          </span>
          <button
            onClick={() => {
              stopImpersonation();
              window.location.href = '/plataforma';
            }}
            className="ml-auto rounded-lg bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-900"
          >
            Salir del modo soporte
          </button>
        </div>
      )}

      <header className="flex flex-wrap items-center gap-3 bg-white px-6 py-3 shadow-sm">
        <span className="text-base font-bold text-emerald-700">{me.tenant.name}</span>
        <nav className="flex flex-wrap gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                pathname === l.to ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {!impersonation && <NotificationBell />}
          <span className="text-sm text-slate-500">{me.user.name}</span>
          {!impersonation && (
            <button
              onClick={logout}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Salir
            </button>
          )}
        </div>
      </header>
    </>
  );
}

/** Campana de alertas (stock bajo, etc.). Refresca cada 2 minutos: el POS
 *  vive abierto todo el día y no necesita más frecuencia que eso. */
function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);

  async function load() {
    try {
      const data = await api<{ unread: number; rows: NotificationRow[] }>('/api/notifications');
      setUnread(data.unread);
      setRows(data.rows);
    } catch {
      /* la campana nunca debe romper la navegación */
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 120_000);
    return () => clearInterval(timer);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      await api('/api/notifications/read', { method: 'POST', body: JSON.stringify({}) }).catch(
        () => undefined,
      );
      setUnread(0);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        className="relative rounded-lg px-2 py-1.5 text-slate-500 hover:bg-slate-50"
        aria-label={`Notificaciones${unread > 0 ? ` (${unread} sin leer)` : ''}`}
      >
        <span aria-hidden>🔔</span>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 max-h-96 w-80 overflow-y-auto rounded-xl bg-white p-2 shadow-xl ring-1 ring-slate-200">
            {rows.length === 0 && (
              <p className="p-4 text-center text-sm text-slate-400">Sin notificaciones</p>
            )}
            {rows.map((n) => (
              <div key={n.id} className="border-b border-slate-50 px-3 py-2 last:border-0">
                <p className="text-sm font-medium text-slate-800">{n.title}</p>
                {n.body && <p className="text-xs text-slate-500">{n.body}</p>}
                <p className="mt-0.5 text-[10px] text-slate-400">
                  {new Date(n.createdAt).toLocaleString('es-GT', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
