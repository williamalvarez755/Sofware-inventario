import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Page } from '../components/AppShell';
import { Icon } from '../components/Icon';
import {
  Badge,
  Button,
  Cargando,
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

/**
 * Usuarios de la tienda.
 *
 * Esta pantalla es la mitad que faltaba de un problema de seguridad, no una
 * función más: el RBAC entero estaba construido desde la Fase 0 pero no había
 * forma de crear un cajero, así que el dueño le prestaba su propia cuenta — y
 * quien quedaba en el mostrador podía anular ventas, retirar efectivo y ver
 * márgenes, todo registrado a nombre del dueño.
 */

interface TiendaDelUsuario {
  storeId: string;
  storeName: string;
  role: string;
}
interface Usuario {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  stores: TiendaDelUsuario[];
}
interface TiendaOpt {
  id: string;
  name: string;
}

const ROLES = [
  { id: 'WORKER', label: 'Cajero', ayuda: 'Vende y maneja su turno de caja. No ve costos ni ganancias.' },
  { id: 'STORE_ADMIN', label: 'Encargado', ayuda: 'Todo lo de la tienda: productos, compras, anulaciones y reportes.' },
  { id: 'OWNER', label: 'Dueño', ayuda: 'Todo, en todas las tiendas, incluida la configuración del negocio.' },
] as const;

const ETIQUETA_ROL: Record<string, string> = {
  OWNER: 'Dueño',
  STORE_ADMIN: 'Encargado',
  WORKER: 'Cajero',
};

export function UsersPage() {
  const { me } = useAuth();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [tiendas, setTiendas] = useState<TiendaOpt[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [alta, setAlta] = useState(false);
  /** Credencial recién creada: se muestra UNA vez y no se guarda en claro. */
  const [credencial, setCredencial] = useState<{ username: string; password: string } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [u, t] = await Promise.all([
        api<Usuario[]>('/api/users'),
        api<TiendaOpt[]>('/api/stores'),
      ]);
      setUsuarios(u);
      setTiendas(t);
      setError(null);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 403
          ? 'No tiene permiso para administrar usuarios'
          : 'Error cargando los usuarios',
      );
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function cambiarEstado(u: Usuario) {
    setError(null);
    try {
      await api(`/api/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      setAviso(
        u.isActive
          ? `${u.name} ya no puede entrar, y se cerraron sus sesiones abiertas.`
          : `${u.name} vuelve a tener acceso.`,
      );
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cambiar el estado');
    }
  }

  async function reiniciarClave(u: Usuario) {
    setError(null);
    try {
      const r = await api<{ password: string }>(`/api/users/${u.id}/password`, { method: 'POST' });
      setCredencial({ username: u.username, password: r.password });
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo reiniciar la contraseña');
    }
  }

  if (!me) return null;

  return (
    <Page
      title="Usuarios"
      subtitle="Quién puede entrar y qué puede hacer"
      wide
      actions={
        <Button variant="primary" icon="mas" onClick={() => setAlta(true)}>
          Nuevo usuario
        </Button>
      }
    >
      {error && (
        <div className="mb-4">
          <Notice tone="danger" icon="alerta">{error}</Notice>
        </div>
      )}
      {aviso && (
        <div className="mb-4">
          <Notice tone="ok" icon="cheque" onClose={() => setAviso(null)}>{aviso}</Notice>
        </div>
      )}

      <Table head={['Persona', 'Usuario', 'Tiendas y rol', 'Estado', '']}>
        {cargando && (
          <tr>
            <Cell colSpan={5}>
              <Cargando>Cargando los usuarios…</Cargando>
            </Cell>
          </tr>
        )}
        {!cargando &&
          usuarios.map((u) => (
            <Row key={u.id}>
              <Cell>
                <p className="font-medium text-[hsl(var(--text-1))]">{u.name}</p>
                {u.lastLoginAt ? (
                  <p className="text-xs text-[hsl(var(--text-3))]">
                    Último ingreso{' '}
                    {new Date(u.lastLoginAt).toLocaleDateString('es-GT', { dateStyle: 'short' })}
                  </p>
                ) : (
                  <p className="text-xs text-[hsl(var(--text-3))]">Nunca ha entrado</p>
                )}
              </Cell>
              <Cell>
                <span className="money">{u.username}</span>
                {u.mustChangePassword && (
                  <p className="text-xs text-[hsl(var(--warn))]">Debe cambiar su contraseña</p>
                )}
              </Cell>
              <Cell>
                {/* Tope de 3: un dueño con quince sucursales no puede
                    convertir su fila en una columna de etiquetas. */}
                <div className="flex flex-wrap gap-1">
                  {u.stores.length === 0 && (
                    <span className="text-xs text-[hsl(var(--text-3))]">Sin tiendas</span>
                  )}
                  {u.stores.slice(0, 3).map((s) => (
                    <Badge key={s.storeId} tone={s.role === 'OWNER' ? 'accent' : 'neutral'}>
                      {s.storeName} · {ETIQUETA_ROL[s.role] ?? s.role}
                    </Badge>
                  ))}
                  {u.stores.length > 3 && (
                    <span
                      className="text-xs text-[hsl(var(--text-3))]"
                      title={u.stores.map((s) => s.storeName).join(', ')}
                    >
                      +{u.stores.length - 3} tienda(s) más
                    </span>
                  )}
                </div>
              </Cell>
              <Cell>
                {u.isActive ? (
                  <Badge tone="ok">Activo</Badge>
                ) : (
                  <Badge tone="danger">Sin acceso</Badge>
                )}
              </Cell>
              <Cell align="right">
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => void reiniciarClave(u)}>
                    Reiniciar clave
                  </Button>
                  <Button
                    size="sm"
                    variant={u.isActive ? 'danger' : 'outline'}
                    onClick={() => void cambiarEstado(u)}
                    disabled={u.id === me.user.id}
                    title={u.id === me.user.id ? 'No puede quitarse el acceso a usted mismo' : undefined}
                  >
                    {u.isActive ? 'Quitar acceso' : 'Reactivar'}
                  </Button>
                </div>
              </Cell>
            </Row>
          ))}
        {!cargando && usuarios.length === 0 && (
          <tr>
            <Cell colSpan={5}>
              <Empty icon="usuario">Todavía no hay usuarios además del suyo</Empty>
            </Cell>
          </tr>
        )}
      </Table>

      {alta && (
        <AltaUsuario
          tiendas={tiendas}
          onClose={() => setAlta(false)}
          onCreado={(c) => {
            setAlta(false);
            setCredencial(c);
            void cargar();
          }}
        />
      )}

      {credencial && (
        <Modal
          title="Anote esta contraseña"
          description="No se vuelve a mostrar. Dictésela a la persona: al entrar tendrá que cambiarla."
          onClose={() => setCredencial(null)}
        >
          <div className="glass-soft rounded-xl p-4 text-center">
            <p className="rotulo">Usuario</p>
            <p className="money text-lg font-semibold text-[hsl(var(--text-1))]">
              {credencial.username}
            </p>
            <p className="rotulo mt-3">Contraseña temporal</p>
            <p className="money text-2xl font-bold tracking-wide text-[hsl(var(--accent-strong))]">
              {credencial.password}
            </p>
          </div>
          <Button variant="primary" className="mt-4 w-full" onClick={() => setCredencial(null)}>
            Ya la anoté
          </Button>
        </Modal>
      )}
    </Page>
  );
}

function AltaUsuario({
  tiendas,
  onClose,
  onCreado,
}: {
  tiendas: TiendaOpt[];
  onClose: () => void;
  onCreado: (c: { username: string; password: string }) => void;
}) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<string>('WORKER');
  const [storeIds, setStoreIds] = useState<string[]>(tiendas[0] ? [tiendas[0].id] : []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ayuda = ROLES.find((r) => r.id === role)?.ayuda;

  function alternarTienda(id: string) {
    setError(null);
    setStoreIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ username: string; password: string }>('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          username: username.trim().toLowerCase(),
          role,
          storeIds,
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        }),
      });
      onCreado(r);
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'No se pudo crear el usuario');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nuevo usuario" description="La contraseña se genera sola y se muestra una vez." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Nombre de la persona"
          required
          autoFocus
          value={name}
          onChange={(e) => {
            setError(null);
            setName(e.target.value);
          }}
          placeholder="Alejandra López"
        />
        <Field
          label="Usuario para entrar"
          required
          value={username}
          onChange={(e) => {
            setError(null);
            setUsername(e.target.value);
          }}
          placeholder="alejandra"
          autoCapitalize="none"
          spellCheck={false}
          hint="Corto y fácil de teclear: lo escribe en cada cambio de turno."
        />
        <Field
          label="Teléfono (opcional)"
          value={phone}
          onChange={(e) => {
            setError(null);
            setPhone(e.target.value);
          }}
          placeholder="5555-1234"
        />

        <div>
          <Select
            label="Qué puede hacer"
            value={role}
            onChange={(e) => {
              setError(null);
              setRole(e.target.value);
            }}
          >
            {ROLES.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </Select>
          {ayuda && <p className="mt-1.5 text-xs text-[hsl(var(--text-3))]">{ayuda}</p>}
        </div>

        <div>
          <p className="mb-1.5 block text-xs font-medium text-[hsl(var(--text-2))]">
            En qué tiendas
          </p>
          <div className="space-y-1">
            {tiendas.map((t) => (
              <label
                key={t.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-[hsl(var(--text-1))] transition-colors hover:bg-[hsl(var(--text-1)/0.05)]"
              >
                <input
                  type="checkbox"
                  checked={storeIds.includes(t.id)}
                  onChange={() => alternarTienda(t.id)}
                  className="size-4 accent-[hsl(var(--accent))]"
                />
                {t.name}
              </label>
            ))}
          </div>
        </div>

        {error && <Notice tone="danger" icon="alerta">{error}</Notice>}

        <Panel className="flex items-start gap-2.5 p-3">
          <Icon name="escudo" size={17} className="mt-0.5 shrink-0 text-[hsl(var(--text-3))]" />
          <p className="text-xs text-[hsl(var(--text-3))]">
            Cada persona con su propia cuenta: así la bitácora dice quién anuló una venta o
            sacó efectivo. Compartir una cuenta deja ese registro inservible.
          </p>
        </Panel>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={busy}
          disabled={storeIds.length === 0}
          className="w-full"
        >
          Crear usuario
        </Button>
      </form>
    </Modal>
  );
}
