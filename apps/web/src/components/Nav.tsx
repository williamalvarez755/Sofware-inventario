import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, getImpersonation, stopImpersonation } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Icon, type IconName } from './Icon';
import { ThemePicker } from './ThemePicker';
import { Button, IconButton, cx } from './ui';

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  createdAt: string;
  readAt: string | null;
}

const LINKS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Inicio', icon: 'inicio' },
  { to: '/pos', label: 'Venta', icon: 'punto-venta' },
  { to: '/caja', label: 'Caja', icon: 'caja' },
  { to: '/productos', label: 'Productos', icon: 'productos' },
  { to: '/compras', label: 'Compras', icon: 'compras' },
  { to: '/gastos', label: 'Gastos', icon: 'gastos' },
  { to: '/proveedores', label: 'Proveedores', icon: 'proveedores' },
  { to: '/reportes', label: 'Reportes', icon: 'reportes' },
];

export function Nav() {
  const { me, logout } = useAuth();
  const { pathname } = useLocation();
  const impersonation = getImpersonation();

  if (!me) return null;

  return (
    <>
      {impersonation && (
        <div className="sticky top-0 z-40 flex flex-wrap items-center gap-3 border-b border-[hsl(var(--accent)/0.35)] bg-[hsl(var(--accent)/0.14)] px-5 py-2 text-sm backdrop-blur-xl">
          <Icon name="ojo" size={17} className="text-[hsl(var(--accent-strong))]" />
          <span className="text-[hsl(var(--text-1))]">
            Sesión de soporte — viendo <strong>{impersonation.tenantName}</strong> como{' '}
            {impersonation.actingAs}.{' '}
            <span className="text-[hsl(var(--text-2))]">Solo lectura.</span>
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => {
              stopImpersonation();
              window.location.href = '/plataforma';
            }}
          >
            Salir del modo soporte
          </Button>
        </div>
      )}

      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[hsl(var(--bg)/0.72)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-5 py-2.5">
          <Link to="/" className="flex shrink-0 items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent))]">
              <Icon name="caja" size={18} />
            </span>
            <span className="hidden font-display text-sm font-semibold text-[hsl(var(--text-1))] sm:block">
              {me.tenant.name}
            </span>
          </Link>

          <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {LINKS.map((l) => {
              const active = pathname === l.to;
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                    active
                      ? 'bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent-strong))]'
                      : 'text-[hsl(var(--text-2))] hover:bg-white/[0.06] hover:text-[hsl(var(--text-1))]',
                  )}
                >
                  <Icon name={l.icon} size={16} />
                  <span className="hidden lg:block">{l.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-1">
            {!impersonation && <NotificationBell />}
            <ThemePicker />
            <div className="mx-1 hidden text-right sm:block">
              <p className="text-xs font-medium leading-tight text-[hsl(var(--text-1))]">
                {me.user.name}
              </p>
              <p className="text-[11px] leading-tight text-[hsl(var(--text-3))]">
                {me.user.username}
              </p>
            </div>
            {!impersonation && <IconButton icon="salir" label="Cerrar sesión" onClick={logout} />}
          </div>
        </div>
      </header>
    </>
  );
}

/** Campana de alertas. Refresca cada 2 minutos: el POS vive abierto todo el día. */
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
        aria-label={`Notificaciones${unread > 0 ? ` (${unread} sin leer)` : ''}`}
        className="relative inline-flex size-9 items-center justify-center rounded-lg text-[hsl(var(--text-2))] transition-colors hover:bg-white/[0.06] hover:text-[hsl(var(--text-1))]"
      >
        <Icon name="campana" size={18} />
        {unread > 0 && (
          <span className="money absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(var(--accent))] px-1 text-[10px] font-semibold text-[hsl(var(--accent-ink))]">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="glass surgir absolute right-0 z-50 mt-2 max-h-96 w-80 overflow-y-auto rounded-2xl p-1.5">
            {rows.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-[hsl(var(--text-3))]">
                Sin notificaciones
              </p>
            )}
            {rows.map((n) => (
              <div
                key={n.id}
                className="rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
              >
                <p className="text-sm font-medium text-[hsl(var(--text-1))]">{n.title}</p>
                {n.body && <p className="text-xs text-[hsl(var(--text-2))]">{n.body}</p>}
                <p className="mt-1 text-[10px] text-[hsl(var(--text-3))]">
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

/** Envoltura de página: ancho, separación y animación de entrada comunes. */
export function Page({
  title,
  subtitle,
  actions,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen">
      <Nav />
      <main
        className={cx(
          'surgir mx-auto px-5 py-6',
          wide ? 'max-w-[1400px]' : 'max-w-6xl',
        )}
      >
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-[hsl(var(--text-1))]">
              {title}
            </h1>
            {subtitle && <p className="mt-0.5 text-sm text-[hsl(var(--text-3))]">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children}
      </main>
    </div>
  );
}
