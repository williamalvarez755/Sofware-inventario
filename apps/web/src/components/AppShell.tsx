import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, getImpersonation, stopImpersonation } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Buscador, useAtajoBuscador } from './Buscador';
import { CambiarContrasena } from './CambiarContrasena';
import { Icon } from './Icon';
import { Marca } from './Marca';
import { ThemePicker } from './ThemePicker';
import { EN_TELEFONO, GRUPOS, INICIO, moduloDe, tono, type Modulo } from './navegacion';
import { Button, Modal, cx } from './ui';

/**
 * ARMAZÓN DE LA APLICACIÓN.
 *
 * Antes: una barra horizontal con ocho enlaces iguales, todos compitiendo por
 * la misma atención, y la identidad del producto reducida a un icono de 32 px
 * en una esquina.
 *
 * Ahora: una columna izquierda permanente donde los módulos están agrupados
 * por lo que la persona está haciendo (ver `navegacion.ts`). Una columna
 * siempre visible hace dos cosas que una fila no puede: muestra el sistema
 * COMPLETO de un vistazo —el cliente entiende qué compró sin que nadie se lo
 * explique— y deja ver en todo momento dónde está parado.
 *
 *   · Escritorio — columna fija, plegable a riel de iconos. La preferencia se
 *     recuerda: en la pantalla de 1366 px de una tienda, 180 px importan.
 *   · Teléfono   — la columna se convierte en cajón lateral, y abajo queda una
 *     barra con los cuatro módulos que se usan con un cliente enfrente.
 *   · En todas   — Ctrl/⌘+K abre el buscador y lleva a cualquier módulo sin
 *     levantar la mano del teclado.
 */

const ANCHO_ABIERTA = '16.25rem';
const ANCHO_RIEL = '4.75rem';
const CLAVE_PLEGADA = 'mm.barraPlegada';

function leerPlegada(): boolean {
  try {
    return localStorage.getItem(CLAVE_PLEGADA) === '1';
  } catch {
    return false;
  }
}

// ───────────────────────────── Enlace de módulo ─────────────────────────────

function EnlaceModulo({
  modulo,
  activo,
  plegada,
  onNavegar,
}: {
  modulo: Modulo;
  activo: boolean;
  plegada: boolean;
  onNavegar?: () => void;
}) {
  return (
    <Link
      to={modulo.to}
      onClick={onNavegar}
      aria-current={activo ? 'page' : undefined}
      title={plegada ? `${modulo.label} — ${modulo.desc}` : undefined}
      style={activo ? { background: tono(modulo, 0.12) } : undefined}
      className={cx(
        'group relative flex items-center gap-3 rounded-xl py-2.5 transition-all duration-200',
        plegada ? 'justify-center px-0' : 'px-3',
        activo
          ? 'text-[hsl(var(--text-1))]'
          : 'text-[hsl(var(--text-2))] hover:bg-[hsl(var(--text-1)/0.06)] hover:text-[hsl(var(--text-1))]',
      )}
    >
      {/* Marca de posición: una barra en el canto, del color del módulo. Dice
          dónde está uno sin repintar media columna. */}
      <span
        aria-hidden
        style={{ background: tono(modulo) }}
        className={cx(
          'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full transition-opacity duration-200',
          activo ? 'opacity-100' : 'opacity-0',
        )}
      />
      {/* El glifo siempre va en su color; el texto se queda neutro. Si el
          tono se derramara a la etiqueta, la columna sería un semáforo. */}
      <Icon
        name={modulo.icon}
        size={19}
        color={tono(modulo)}
        className="shrink-0 transition-transform duration-200 group-hover:scale-110"
      />
      {!plegada && (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold leading-tight">
            {modulo.label}
          </span>
          <span className="block truncate text-[11px] leading-tight text-[hsl(var(--text-3))]">
            {modulo.desc}
          </span>
        </span>
      )}
    </Link>
  );
}

function ListaModulos({
  plegada,
  pathname,
  onNavegar,
}: {
  plegada: boolean;
  pathname: string;
  onNavegar?: () => void;
}) {
  return (
    <nav className={cx('flex-1 space-y-5 overflow-y-auto py-4', plegada ? 'px-2.5' : 'px-3')}>
      <EnlaceModulo
        modulo={INICIO}
        activo={pathname === INICIO.to}
        plegada={plegada}
        onNavegar={onNavegar}
      />

      {GRUPOS.map((g) => (
        <div key={g.titulo} className="space-y-0.5">
          {plegada ? (
            <div className="mx-auto mb-2 h-px w-6 bg-[hsl(var(--border))]" aria-hidden />
          ) : (
            <p className="rotulo mb-1.5 px-3">{g.titulo}</p>
          )}
          {g.items.map((m) => (
            <EnlaceModulo
              key={m.to}
              modulo={m}
              activo={pathname === m.to}
              plegada={plegada}
              onNavegar={onNavegar}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

// ─────────────────────────── Cabecera de la columna ───────────────────────────

function CabeceraMarca({ plegada, nombre }: { plegada: boolean; nombre: string }) {
  return (
    <Link
      to="/"
      className={cx(
        'flex items-center gap-2.5 border-b border-[hsl(var(--border)/0.6)] py-4',
        plegada ? 'justify-center px-2' : 'px-4',
      )}
    >
      <Marca size={plegada ? 30 : 34} />
      {!plegada && (
        <span className="min-w-0">
          <span className="font-display block truncate text-[15px] font-bold leading-tight text-[hsl(var(--text-1))]">
            {nombre}
          </span>
          <span className="rotulo block leading-tight">Minimarket GT</span>
        </span>
      )}
    </Link>
  );
}

// ──────────────────────────── Tarjeta de la cuenta ────────────────────────────

function TarjetaCuenta({
  plegada,
  onAbrir,
}: {
  plegada: boolean;
  onAbrir: () => void;
}) {
  const { me } = useAuth();
  if (!me) return null;

  return (
    <div className={cx('border-t border-[hsl(var(--border)/0.6)] p-3', plegada && 'px-2.5')}>
      <button
        onClick={onAbrir}
        title={plegada ? me.user.name : undefined}
        className={cx(
          'flex w-full items-center gap-2.5 rounded-xl py-2 transition-colors hover:bg-[hsl(var(--text-1)/0.06)]',
          plegada ? 'justify-center px-0' : 'px-2',
        )}
      >
        <Avatar nombre={me.user.name} />
        {!plegada && (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[13px] font-semibold leading-tight text-[hsl(var(--text-1))]">
                {me.user.name}
              </span>
              <span className="block truncate text-[11px] leading-tight text-[hsl(var(--text-3))]">
                {me.user.username}
              </span>
            </span>
            <Icon name="ajustes" size={16} className="shrink-0 text-[hsl(var(--text-3))]" />
          </>
        )}
      </button>
    </div>
  );
}

function Avatar({ nombre, size = 32 }: { nombre: string; size?: number }) {
  const iniciales = nombre
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase();
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-[hsl(var(--accent)/0.18)] font-semibold text-[hsl(var(--accent-strong))]"
      style={{ width: size, height: size, fontSize: size * 0.37 }}
      aria-hidden
    >
      {iniciales}
    </span>
  );
}

// ───────────────────────────── Menú de la cuenta ─────────────────────────────

function MenuCuenta({
  onClose,
  hacia = 'arriba',
}: {
  onClose: () => void;
  /** Desde la columna se abre hacia arriba; desde la barra superior del
   *  teléfono, hacia abajo — si no, saldría fuera de la pantalla. */
  hacia?: 'arriba' | 'abajo';
}) {
  const { me, logout } = useAuth();
  const [cambiarClave, setCambiarClave] = useState(false);
  const impersonation = getImpersonation();
  if (!me) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        className={cx(
          'glass-raised surgir absolute z-50 w-[17rem] rounded-2xl p-3',
          hacia === 'arriba' ? 'bottom-full left-0 mb-2 lg:left-3' : 'right-0 top-full mt-2',
        )}
      >
        <div className="mb-3 flex items-center gap-3 px-1">
          <Avatar nombre={me.user.name} size={38} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[hsl(var(--text-1))]">
              {me.user.name}
            </p>
            <p className="truncate text-xs text-[hsl(var(--text-3))]">{me.tenant.name}</p>
          </div>
        </div>

        <div className="mb-3 rounded-xl bg-[hsl(var(--text-1)/0.04)] p-3">
          <ThemePicker />
        </div>

        {!impersonation && (
          <button
            onClick={() => setCambiarClave(true)}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-[hsl(var(--text-2))] transition-colors hover:bg-[hsl(var(--text-1)/0.06)] hover:text-[hsl(var(--text-1))]"
          >
            <Icon name="candado" size={17} />
            Cambiar mi contraseña
          </button>
        )}
        {!impersonation && (
          <button
            onClick={logout}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-[hsl(var(--danger))] transition-colors hover:bg-[hsl(var(--danger)/0.12)]"
          >
            <Icon name="salir" size={17} />
            Cerrar sesión
          </button>
        )}

        {cambiarClave && (
          <Modal
            title="Cambiar mi contraseña"
            description={`Cuenta: ${me.user.username}`}
            onClose={() => setCambiarClave(false)}
          >
            <CambiarContrasena
              onListo={() => {
                setCambiarClave(false);
                onClose();
              }}
            />
          </Modal>
        )}
      </div>
    </>
  );
}

// ──────────────────────────── Campana de alertas ────────────────────────────

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  createdAt: string;
  readAt: string | null;
}

/** Refresca cada 2 minutos: el POS vive abierto todo el día. */
function Campana() {
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
        className="relative inline-flex size-9 items-center justify-center rounded-xl text-[hsl(var(--text-2))] transition-colors hover:bg-[hsl(var(--text-1)/0.07)] hover:text-[hsl(var(--text-1))]"
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
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="glass-raised surgir absolute right-0 z-50 mt-2 max-h-96 w-80 overflow-y-auto rounded-2xl p-1.5">
            {rows.length === 0 && (
              <p className="px-3 py-10 text-center text-sm text-[hsl(var(--text-3))]">
                Sin notificaciones
              </p>
            )}
            {rows.map((n) => (
              <div
                key={n.id}
                className="rounded-xl px-3 py-2.5 transition-colors hover:bg-[hsl(var(--text-1)/0.05)]"
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

// ───────────────────────────── Barra de soporte ─────────────────────────────

function BannerSoporte({ tenantName, actingAs }: { tenantName: string; actingAs: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[hsl(var(--warn)/0.35)] bg-[hsl(var(--warn)/0.14)] px-5 py-2 text-sm backdrop-blur-xl">
      <Icon name="ojo" size={17} className="text-[hsl(var(--warn))]" />
      <span className="text-[hsl(var(--text-1))]">
        Sesión de soporte — viendo <strong>{tenantName}</strong> como {actingAs}.{' '}
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
  );
}

// ═══════════════════════════════ El armazón ═══════════════════════════════

export function AppShell({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const { pathname } = useLocation();
  const impersonation = getImpersonation();

  const [plegada, setPlegada] = useState(leerPlegada);
  const [cajon, setCajon] = useState(false);
  const [menu, setMenu] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [altoSoporte, setAltoSoporte] = useState(0);

  // El aviso de soporte empuja todo hacia abajo y su altura depende de si el
  // texto envuelve. Medirlo es la única forma de que la columna y la cabecera
  // se peguen justo debajo en vez de quedar tapadas o dejar un hueco.
  const medirSoporte = useCallback((nodo: HTMLDivElement | null) => {
    if (!nodo) {
      setAltoSoporte(0);
      return;
    }
    const observador = new ResizeObserver(() => setAltoSoporte(nodo.offsetHeight));
    observador.observe(nodo);
    setAltoSoporte(nodo.offsetHeight);
    return () => observador.disconnect();
  }, []);

  const abrirBuscador = useCallback(() => setBuscando(true), []);
  useAtajoBuscador(abrirBuscador);

  // Cambiar de pantalla cierra lo que esté abierto encima: nadie quiere
  // llegar a Productos con el cajón todavía tapando media pantalla.
  useEffect(() => {
    setCajon(false);
    setMenu(false);
  }, [pathname]);

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_PLEGADA, plegada ? '1' : '0');
    } catch {
      /* sin persistencia, la preferencia dura la sesión */
    }
  }, [plegada]);

  if (!me) return null;

  const modulo = moduloDe(pathname);
  const grupo = GRUPOS.find((g) => g.items.some((m) => m.to === pathname));

  return (
    <div
      className="min-h-screen"
      style={{ '--alto-soporte': `${altoSoporte}px` } as React.CSSProperties}
    >
      {impersonation && (
        <div ref={medirSoporte} className="sticky top-0 z-40">
          <BannerSoporte
            tenantName={impersonation.tenantName}
            actingAs={impersonation.actingAs}
          />
        </div>
      )}

      <div className="flex">
        {/* ─────────── Columna fija (escritorio) ─────────── */}
        <aside
          className="glass-chrome sticky hidden shrink-0 flex-col rounded-none border-r border-[hsl(var(--border)/0.6)] transition-[width] duration-300 lg:flex"
          style={{
            width: plegada ? ANCHO_RIEL : ANCHO_ABIERTA,
            top: 'var(--alto-soporte, 0px)',
            height: 'calc(100vh - var(--alto-soporte, 0px))',
          }}
        >
          <CabeceraMarca plegada={plegada} nombre={me.tenant.name} />
          <ListaModulos plegada={plegada} pathname={pathname} />

          <div className={cx('px-3 pb-1', plegada && 'px-2.5')}>
            <button
              onClick={() => setPlegada((p) => !p)}
              aria-label={plegada ? 'Expandir la barra' : 'Plegar la barra'}
              title={plegada ? 'Expandir la barra' : 'Plegar la barra'}
              className={cx(
                'flex w-full items-center gap-2.5 rounded-xl py-2 text-[12px] font-medium text-[hsl(var(--text-3))] transition-colors hover:bg-[hsl(var(--text-1)/0.06)] hover:text-[hsl(var(--text-1))]',
                plegada ? 'justify-center px-0' : 'px-3',
              )}
            >
              <Icon name="colapsar" size={17} className={plegada ? 'rotate-180' : undefined} />
              {!plegada && 'Plegar'}
            </button>
          </div>

          <div className="relative">
            <TarjetaCuenta plegada={plegada} onAbrir={() => setMenu((m) => !m)} />
            {menu && <MenuCuenta onClose={() => setMenu(false)} />}
          </div>
        </aside>

        {/* ─────────── Cajón lateral (teléfono y tableta) ─────────── */}
        {cajon && (
          <>
            <div
              className="fixed inset-0 z-40 bg-[hsl(var(--bg-deep)/0.6)] backdrop-blur-sm lg:hidden"
              onClick={() => setCajon(false)}
              aria-hidden
            />
            <aside
              className="glass-raised surgir fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col rounded-none rounded-r-2xl lg:hidden"
              role="dialog"
              aria-label="Navegación"
            >
              <CabeceraMarca plegada={false} nombre={me.tenant.name} />
              <ListaModulos plegada={false} pathname={pathname} onNavegar={() => setCajon(false)} />
              <div className="relative">
                <TarjetaCuenta plegada={false} onAbrir={() => setMenu((m) => !m)} />
                {menu && <MenuCuenta onClose={() => setMenu(false)} />}
              </div>
            </aside>
          </>
        )}

        {/* ─────────── Columna de contenido ─────────── */}
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header
            className="glass-chrome sticky z-30 flex h-[60px] shrink-0 items-center gap-2 rounded-none border-b border-[hsl(var(--border)/0.6)] px-3 sm:px-5"
            style={{ top: 'var(--alto-soporte, 0px)' }}
          >
            <button
              onClick={() => setCajon(true)}
              aria-label="Abrir la navegación"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-[hsl(var(--text-2))] transition-colors hover:bg-[hsl(var(--text-1)/0.07)] hover:text-[hsl(var(--text-1))] lg:hidden"
            >
              <Icon name="menu" size={20} />
            </button>

            <Link to="/" className="shrink-0 lg:hidden">
              <Marca size={28} />
            </Link>

            {/* Migaja: recuerda a qué grupo pertenece la pantalla actual, que
                es lo que enseña la estructura del sistema sin un tutorial. */}
            <div className="hidden min-w-0 items-center gap-1.5 text-[13px] lg:flex">
              {modulo && (
                <Icon name={modulo.icon} size={16} color={tono(modulo)} className="mr-0.5" />
              )}
              {grupo && (
                <>
                  <span className="text-[hsl(var(--text-3))]">{grupo.titulo}</span>
                  <Icon name="flecha-derecha" size={13} className="text-[hsl(var(--text-3))]" />
                </>
              )}
              <span className="truncate font-semibold text-[hsl(var(--text-1))]">
                {modulo?.label ?? 'Inicio'}
              </span>
            </div>

            <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[hsl(var(--text-1))] lg:hidden">
              {modulo?.label ?? 'Inicio'}
            </p>

            <button
              onClick={abrirBuscador}
              className="glass-soft ml-auto hidden h-9 w-64 items-center gap-2 rounded-xl px-3 text-left text-[13px] text-[hsl(var(--text-3))] transition-colors hover:text-[hsl(var(--text-2))] md:flex xl:w-72"
            >
              <Icon name="buscar" size={16} />
              <span className="flex-1">Buscar…</span>
              <kbd className="rounded-md border border-[hsl(var(--border))] px-1.5 text-[10px] font-semibold">
                Ctrl K
              </kbd>
            </button>

            <button
              onClick={abrirBuscador}
              aria-label="Buscar"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-[hsl(var(--text-2))] transition-colors hover:bg-[hsl(var(--text-1)/0.07)] md:hidden"
            >
              <Icon name="buscar" size={18} />
            </button>

            {!impersonation && <Campana />}

            <div className="relative lg:hidden">
              <button
                onClick={() => setMenu((m) => !m)}
                aria-label="Mi cuenta"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-[hsl(var(--text-1)/0.07)]"
              >
                <Avatar nombre={me.user.name} size={28} />
              </button>
              {menu && !cajon && <MenuCuenta hacia="abajo" onClose={() => setMenu(false)} />}
            </div>
          </header>

          <main className="flex-1 pb-[calc(var(--barra-movil)+1rem)] lg:pb-0">{children}</main>
        </div>
      </div>

      {/* ─────────── Barra inferior (teléfono) ─────────── */}
      <nav
        className="glass-chrome fixed inset-x-0 bottom-0 z-30 flex items-stretch rounded-none border-t border-[hsl(var(--border)/0.6)] pb-[env(safe-area-inset-bottom)] lg:hidden"
        style={{ height: 'var(--barra-movil)' }}
        aria-label="Accesos rápidos"
      >
        {EN_TELEFONO.map((m) => {
          const activo = pathname === m.to;
          return (
            <Link
              key={m.to}
              to={m.to}
              aria-current={activo ? 'page' : undefined}
              style={activo ? { color: tono(m) } : undefined}
              className={cx(
                'flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-semibold transition-colors',
                !activo && 'text-[hsl(var(--text-3))]',
              )}
            >
              <span
                style={activo ? { background: tono(m, 0.16) } : undefined}
                className="flex h-7 w-12 items-center justify-center rounded-full transition-colors"
              >
                <Icon name={m.icon} size={19} color={tono(m)} />
              </span>
              {m.label}
            </Link>
          );
        })}
        <button
          onClick={() => setCajon(true)}
          className="flex flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-semibold text-[hsl(var(--text-3))]"
        >
          <span className="flex h-7 w-12 items-center justify-center">
            <Icon name="cuadricula" size={19} />
          </span>
          Más
        </button>
      </nav>

      {buscando && <Buscador onClose={() => setBuscando(false)} />}
    </div>
  );
}

// ═════════════════════════════ Envoltura de página ═════════════════════════════

/**
 * Cabecera común de cada pantalla. Mantiene la misma firma de siempre
 * (`title`, `subtitle`, `actions`, `wide`) para que ninguna página tenga que
 * cambiar por el rediseño del armazón.
 */
export function Page({
  title,
  subtitle,
  actions,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <AppShell>
      <div className={cx('mx-auto px-4 py-6 sm:px-6 lg:px-8', wide ? 'max-w-[1500px]' : 'max-w-6xl')}>
        <div
          className="surgir mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3"
          style={{ '--paso': 0 } as React.CSSProperties}
        >
          <div className="min-w-0">
            <h1 className="font-display text-[1.7rem] font-bold leading-tight tracking-tight text-[hsl(var(--text-1))] sm:text-[2rem]">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 text-sm text-[hsl(var(--text-3))]">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        <div className="surgir" style={{ '--paso': 1 } as React.CSSProperties}>
          {children}
        </div>
      </div>
    </AppShell>
  );
}
