import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatQ, toCentavos } from '@minimarket/shared';
import { ApiError, startImpersonation } from '../../api/client';
import { platformApi, platformLogout } from '../../api/platformClient';
import { Marca } from '../../components/Marca';
import { ThemePicker } from '../../components/ThemePicker';
import {
  Badge, Button, Cell, Empty, Field, IconButton, Modal, Notice, Panel,
  Row, SectionTitle, Select, Stat, Table, cx,
} from '../../components/ui';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  suspendedReason: string | null;
  stores: number;
  users: number;
  subscription: { status: string; periodEnd: string; plan: { code: string; name: string } } | null;
}
interface Metrics {
  tenants: { total: number; active: number; suspended: number; cancelled: number };
  scale: { stores: number; users: number; products: number };
  volume: { sales30d: number; volume30d: string; salesToday: number };
  revenue: { mrr: string; payingTenants: number };
  needsAttention: { id: string; name: string; reason: string; periodEnd: string | null }[];
}
interface Plan {
  id: string;
  code: string;
  name: string;
  maxStores: number;
  maxUsers: number;
  monthlyPrice: string;
  isActive: boolean;
  _count: { subscriptions: number };
}

const STATUS_TONE = { ACTIVE: 'ok', SUSPENDED: 'danger', CANCELLED: 'neutral' } as const;
const STATUS_LABEL = { ACTIVE: 'Activo', SUSPENDED: 'Suspendido', CANCELLED: 'Cancelado' };

export function PlatformDashboardPage() {
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tab, setTab] = useState<'tenants' | 'plans'>('tenants');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [statusTarget, setStatusTarget] = useState<TenantRow | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [impersonateTarget, setImpersonateTarget] = useState<TenantRow | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, t, p] = await Promise.all([
        platformApi<Metrics>('/api/platform/metrics'),
        platformApi<TenantRow[]>('/api/platform/tenants'),
        platformApi<Plan[]>('/api/platform/plans'),
      ]);
      setMetrics(m);
      setTenants(t);
      setPlans(p);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        navigate('/plataforma/login', { replace: true });
        return;
      }
      setError('Error cargando el panel');
    }
  }, [navigate]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[hsl(var(--bg)/0.72)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-5 py-3">
          <Marca size={32} />
          <span className="font-display text-[15px] font-semibold text-[hsl(var(--text-1))]">
            MiniMarket
            <span className="ml-2 rounded-md bg-[hsl(var(--accent)/0.16)] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--accent-strong))]">
              Plataforma
            </span>
          </span>
          <div className="ml-auto flex items-center gap-1">
            <ThemePicker />
            <IconButton
              icon="salir"
              label="Cerrar sesión"
              onClick={async () => {
                await platformLogout();
                navigate('/plataforma/login', { replace: true });
              }}
            />
          </div>
        </div>
      </header>

      <main className="surgir mx-auto max-w-[1400px] px-5 py-6">
        {error && <div className="mb-4"><Notice tone="danger" icon="alerta">{error}</Notice></div>}
        {notice && (
          <div className="mb-4">
            <Notice tone="ok" icon="cheque" onClose={() => setNotice(null)}>{notice}</Notice>
          </div>
        )}

        {metrics && (
          <>
            {/* La cifra que define el negocio SaaS va primero y sola. */}
            <Panel className="relative overflow-hidden p-6">
              <div
                className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full opacity-[0.16] blur-3xl"
                style={{ background: 'hsl(var(--accent))' }}
                aria-hidden
              />
              <div className="relative flex flex-wrap items-end justify-between gap-6">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--text-3))]">
                    Ingreso mensual recurrente
                  </p>
                  <p className="money mt-2 text-[46px] font-bold leading-none text-[hsl(var(--accent-strong))] sm:text-[56px]">
                    {formatQ(BigInt(metrics.revenue.mrr))}
                  </p>
                  <p className="mt-2.5 text-sm text-[hsl(var(--text-2))]">
                    {metrics.revenue.payingTenants} cliente(s) de pago ·{' '}
                    <span className="text-[hsl(var(--text-3))]">
                      {metrics.tenants.active} activos de {metrics.tenants.total}
                    </span>
                  </p>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-5 py-3.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--text-3))]">
                    Volumen transado (30 d)
                  </p>
                  <p className="money mt-1 text-[28px] font-bold leading-none text-[hsl(var(--text-1))]">
                    {formatQ(BigInt(metrics.volume.volume30d))}
                  </p>
                  <p className="mt-1 text-xs text-[hsl(var(--text-3))]">
                    {metrics.volume.sales30d} ventas · {metrics.volume.salesToday} hoy
                  </p>
                </div>
              </div>
            </Panel>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Stat
                label="Clientes activos"
                value={String(metrics.tenants.active)}
                hint={`${metrics.tenants.suspended} suspendido(s)`}
                icon="tienda"
                tone={metrics.tenants.suspended > 0 ? 'danger' : 'neutral'}
              />
              <Stat
                label="Tiendas"
                value={String(metrics.scale.stores)}
                hint={`${metrics.scale.users} usuarios activos`}
                icon="punto-venta"
              />
              <Stat
                label="Catálogo"
                value={String(metrics.scale.products)}
                hint="productos en la plataforma"
                icon="productos"
              />
            </div>

            {metrics.needsAttention.length > 0 && (
              <Panel className="mt-4 border-[hsl(var(--accent)/0.28)] bg-[hsl(var(--accent)/0.07)] p-4">
                <SectionTitle>
                  Requieren atención ({metrics.needsAttention.length})
                </SectionTitle>
                <div className="flex flex-wrap gap-2">
                  {metrics.needsAttention.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setDetailId(a.id)}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-[hsl(var(--text-2))] transition-colors hover:bg-white/[0.08]"
                    >
                      <strong className="text-[hsl(var(--text-1))]">{a.name}</strong> — {a.reason}
                    </button>
                  ))}
                </div>
              </Panel>
            )}
          </>
        )}

        <div className="mt-5 flex items-center gap-2">
          {(['tenants', 'plans'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={cx(
                'rounded-xl px-3.5 py-2 text-sm font-medium transition-colors',
                tab === t
                  ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-ink))]'
                  : 'text-[hsl(var(--text-2))] hover:bg-white/[0.06]',
              )}
            >
              {t === 'tenants' ? 'Clientes' : 'Planes'}
            </button>
          ))}
          {tab === 'tenants' && (
            <Button variant="primary" icon="mas" className="ml-auto" onClick={() => setOnboarding(true)}>
              Nuevo cliente
            </Button>
          )}
        </div>

        <div className="mt-3">
          {tab === 'tenants' ? (
            <Table head={['Negocio', 'Plan', 'Vence', 'Tiendas', 'Estado', '']}>
              {tenants.map((t) => (
                <Row key={t.id}>
                  <Cell>
                    <button
                      onClick={() => setDetailId(t.id)}
                      className="font-medium text-[hsl(var(--text-1))] hover:text-[hsl(var(--accent-strong))]"
                    >
                      {t.name}
                    </button>
                    <span className="block text-xs text-[hsl(var(--text-3))]">{t.slug}</span>
                  </Cell>
                  <Cell>{t.subscription?.plan.name ?? '—'}</Cell>
                  <Cell>
                    {t.subscription
                      ? new Date(t.subscription.periodEnd).toLocaleDateString('es-GT')
                      : '—'}
                  </Cell>
                  <Cell align="right" mono>{t.stores} / {t.users}u</Cell>
                  <Cell>
                    <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                  </Cell>
                  <Cell align="right">
                    <span className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" icon="ojo" onClick={() => setImpersonateTarget(t)}>
                        Ver como
                      </Button>
                      <Button
                        size="sm"
                        variant={t.status === 'ACTIVE' ? 'danger' : 'outline'}
                        onClick={() => setStatusTarget(t)}
                      >
                        {t.status === 'ACTIVE' ? 'Suspender' : 'Reactivar'}
                      </Button>
                    </span>
                  </Cell>
                </Row>
              ))}
              {tenants.length === 0 && (
                <tr><Cell colSpan={6}><Empty icon="tienda">Sin clientes todavía</Empty></Cell></tr>
              )}
            </Table>
          ) : (
            <Table head={['Plan', 'Tiendas', 'Usuarios', 'Precio mensual', 'Contratos']}>
              {plans.map((p) => (
                <Row key={p.id}>
                  <Cell>
                    <span className="font-medium text-[hsl(var(--text-1))]">{p.name}</span>
                    <span className="block text-xs text-[hsl(var(--text-3))]">{p.code}</span>
                  </Cell>
                  <Cell align="right" mono>{p.maxStores}</Cell>
                  <Cell align="right" mono>{p.maxUsers}</Cell>
                  <Cell align="right" mono>{formatQ(BigInt(p.monthlyPrice))}</Cell>
                  <Cell align="right" mono>{p._count.subscriptions}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </div>
      </main>

      {onboarding && (
        <OnboardModal
          plans={plans}
          onClose={() => setOnboarding(false)}
          onDone={(msg) => {
            setOnboarding(false);
            setNotice(msg);
            load();
          }}
        />
      )}
      {statusTarget && (
        <StatusModal
          tenant={statusTarget}
          onClose={() => setStatusTarget(null)}
          onDone={(msg) => {
            setStatusTarget(null);
            setNotice(msg);
            load();
          }}
        />
      )}
      {impersonateTarget && (
        <ImpersonateModal
          tenant={impersonateTarget}
          onClose={() => setImpersonateTarget(null)}
          onError={(msg) => {
            setImpersonateTarget(null);
            setError(msg);
          }}
        />
      )}
      {detailId && (
        <TenantDetailModal
          tenantId={detailId}
          plans={plans}
          onClose={() => setDetailId(null)}
          onChanged={(msg) => {
            setNotice(msg);
            load();
          }}
        />
      )}
    </div>
  );
}

function OnboardModal({
  plans, onClose, onDone,
}: {
  plans: Plan[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [form, setForm] = useState({
    name: '', slug: '', planCode: plans[0]?.code ?? '', ownerName: '',
    ownerUsername: '', ownerEmail: '', ownerPhone: '', ownerPassword: '', storeName: '',
    taxRegime: 'PEQUENO_CONTRIBUYENTE', trialDays: '30',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  /** Sugiere un identificador legible a partir del nombre (sin tildes ni ñ). */
  function slugify(name: string) {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await platformApi<{
        slug: string;
        owner: { username: string; email: string; temporaryPassword: string };
      }>('/api/platform/tenants', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          slug: form.slug || slugify(form.name),
          ownerUsername: form.ownerUsername || undefined,
          ownerPhone: form.ownerPhone || undefined,
          ownerPassword: form.ownerPassword || undefined,
          trialDays: Number(form.trialDays),
        }),
      });
      onDone(
        `Cliente creado. Entregue estas credenciales al dueño:\n` +
          `Usuario: ${res.owner.username}\nContraseña: ${res.owner.temporaryPassword}\n` +
          `(el dueño deberá cambiarla al primer ingreso — no volverá a mostrarse)`,
      );
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error al crear el cliente');
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nuevo cliente"
      description="Crea el negocio, su dueño, la primera tienda con caja y la suscripción."
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <Field
          label="Nombre del negocio"
          required autoFocus value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          onBlur={() => setForm((f) => ({ ...f, slug: f.slug || slugify(f.name) }))}
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Identificador" placeholder="se sugiere solo" value={form.slug} onChange={set('slug')} />
          <Select label="Plan" required value={form.planCode} onChange={set('planCode')}>
            {plans.filter((p) => p.isActive).map((p) => (
              <option key={p.id} value={p.code}>
                {p.name} — {formatQ(BigInt(p.monthlyPrice))}/mes
              </option>
            ))}
          </Select>
          <Field label="Nombre del dueño" required value={form.ownerName} onChange={set('ownerName')} />
          <Field
            label="Usuario de ingreso"
            placeholder="se deriva del correo"
            value={form.ownerUsername}
            onChange={set('ownerUsername')}
          />
          <Field label="Correo del dueño" type="email" required value={form.ownerEmail} onChange={set('ownerEmail')} />
          <Field label="Teléfono" value={form.ownerPhone} onChange={set('ownerPhone')} />
          <Field
            label="Contraseña inicial"
            placeholder="se genera una sola"
            value={form.ownerPassword}
            onChange={set('ownerPassword')}
            hint="Póngala usted si va a dictarla por teléfono. El dueño la cambia al entrar."
          />
          <Field label="Nombre de la tienda" required value={form.storeName} onChange={set('storeName')} />
          <Select label="Régimen fiscal" value={form.taxRegime} onChange={set('taxRegime')}>
            <option value="PEQUENO_CONTRIBUYENTE">Pequeño contribuyente (5%)</option>
            <option value="GENERAL">Régimen general (12%)</option>
            <option value="NINGUNO">Ninguno</option>
          </Select>
          <Field
            label="Días de prueba" type="number" min="0" max="365"
            value={form.trialDays} onChange={set('trialDays')} className="money"
          />
        </div>
        {error && <div className="mt-4"><Notice tone="danger" icon="alerta">{error}</Notice></div>}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-5 w-full">
          Crear cliente
        </Button>
      </form>
    </Modal>
  );
}

function StatusModal({
  tenant, onClose, onDone,
}: {
  tenant: TenantRow;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const suspending = tenant.status === 'ACTIVE';
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await platformApi(`/api/platform/tenants/${tenant.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: suspending ? 'SUSPENDED' : 'ACTIVE', reason }),
      });
      onDone(
        suspending
          ? `"${tenant.name}" quedó suspendido: sus usuarios no podrán ingresar.`
          : `"${tenant.name}" fue reactivado.`,
      );
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`${suspending ? 'Suspender' : 'Reactivar'} ${tenant.name}`}
      description={
        suspending
          ? 'Sus usuarios dejarán de poder ingresar. Los datos se conservan intactos.'
          : 'Sus usuarios volverán a operar normalmente.'
      }
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {tenant.suspendedReason && (
          <div className="mb-3">
            <Notice tone="neutral">Motivo actual: {tenant.suspendedReason}</Notice>
          </div>
        )}
        <Field
          label="Motivo" required minLength={3} autoFocus
          value={reason} onChange={(e) => setReason(e.target.value)}
          hint="Obligatorio: queda en la bitácora."
        />
        {error && <div className="mt-4"><Notice tone="danger" icon="alerta">{error}</Notice></div>}
        <Button
          type="submit" variant={suspending ? 'danger' : 'primary'} size="lg"
          loading={busy} className="mt-5 w-full"
        >
          {suspending ? 'Suspender servicio' : 'Reactivar servicio'}
        </Button>
      </form>
    </Modal>
  );
}

/** El motivo del acceso de soporte es obligatorio y queda auditado (D-028). */
function ImpersonateModal({
  tenant, onClose, onError,
}: {
  tenant: TenantRow;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await platformApi<{
        accessToken: string;
        tenant: { name: string };
        actingAs: { name: string };
      }>(`/api/platform/tenants/${tenant.id}/impersonate`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      startImpersonation({
        accessToken: res.accessToken,
        tenantName: res.tenant.name,
        actingAs: res.actingAs.name,
      });
      window.location.href = '/';
    } catch (e2) {
      onError(e2 instanceof ApiError ? e2.message : 'No se pudo iniciar la sesión de soporte');
    }
  }

  return (
    <Modal
      title={`Ver como ${tenant.name}`}
      description="Sesión de solo lectura de 15 minutos. Queda registrada en la bitácora del cliente."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <Field
          label="Motivo del acceso" required minLength={5} autoFocus
          value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="ej. el cliente reporta que no ve sus productos"
        />
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-5 w-full">
          Entrar en modo soporte
        </Button>
      </form>
    </Modal>
  );
}

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  status: keyof typeof STATUS_LABEL;
  contactEmail: string | null;
  stores: { id: string; name: string }[];
  users: { id: string; name: string; username: string }[];
  subscriptions: {
    id: string; status: string; periodStart: string; periodEnd: string;
    amount: string; paymentNote: string | null; plan: { code: string; name: string };
  }[];
  activity: { sales30d: number; salesTotal30d: string; lastSale: string | null; products: number };
}

function TenantDetailModal({
  tenantId, plans, onClose, onChanged,
}: {
  tenantId: string;
  plans: Plan[];
  onClose: () => void;
  onChanged: (msg: string) => void;
}) {
  const [detail, setDetail] = useState<TenantDetail | null>(null);
  const [planCode, setPlanCode] = useState('');
  const [months, setMonths] = useState('1');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await platformApi<TenantDetail>(`/api/platform/tenants/${tenantId}`);
    setDetail(d);
    setPlanCode(d.subscriptions[0]?.plan.code ?? plans[0]?.code ?? '');
  }, [tenantId, plans]);

  useEffect(() => {
    load().catch(() => setError('Error cargando la ficha'));
  }, [load]);

  async function registerPayment(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await platformApi(`/api/platform/tenants/${tenantId}/subscriptions`, {
        method: 'POST',
        body: JSON.stringify({
          planCode,
          months: Number(months),
          status: 'ACTIVE',
          ...(amount ? { amount: toCentavos(amount) } : {}),
          paymentNote: note || undefined,
        }),
      });
      setAmount('');
      setNote('');
      await load();
      onChanged('Pago registrado y suscripción extendida.');
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error al registrar el pago');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={detail?.name ?? 'Cliente'} description={detail?.slug} onClose={onClose} wide>
      {!detail && <p className="py-8 text-center text-sm text-[hsl(var(--text-3))]">Cargando…</p>}
      {detail && (
        <>
          <div className="mb-4"><Badge tone={STATUS_TONE[detail.status]}>{STATUS_LABEL[detail.status]}</Badge></div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Ventas 30 d', String(detail.activity.sales30d)],
              ['Volumen 30 d', formatQ(BigInt(detail.activity.salesTotal30d))],
              ['Productos', String(detail.activity.products)],
              [
                'Última venta',
                detail.activity.lastSale
                  ? new Date(detail.activity.lastSale).toLocaleDateString('es-GT')
                  : '—',
              ],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--text-3))]">
                  {label}
                </p>
                <p className="money mt-0.5 text-sm font-semibold text-[hsl(var(--text-1))]">{value}</p>
              </div>
            ))}
          </div>

          <p className="mt-4 text-sm text-[hsl(var(--text-2))]">
            {detail.stores.map((s) => s.name).join(', ')} · {detail.users.length} usuario(s)
            {detail.users[0] && (
              <span className="text-[hsl(var(--text-3))]"> · dueño: {detail.users[0].username}</span>
            )}
          </p>

          <div className="mt-5">
            <SectionTitle>Historial de suscripciones</SectionTitle>
            <div className="max-h-40 overflow-y-auto">
              {detail.subscriptions.map((s) => (
                <div key={s.id} className="flex justify-between gap-3 border-b border-white/[0.05] py-2 text-sm last:border-0">
                  <span className="text-[hsl(var(--text-2))]">
                    {s.plan.name} · {new Date(s.periodStart).toLocaleDateString('es-GT')} →{' '}
                    {new Date(s.periodEnd).toLocaleDateString('es-GT')}
                    {s.paymentNote && (
                      <span className="text-xs text-[hsl(var(--text-3))]"> · {s.paymentNote}</span>
                    )}
                  </span>
                  <span className="money shrink-0 font-medium text-[hsl(var(--text-1))]">
                    {formatQ(BigInt(s.amount))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={registerPayment} className="mt-5 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <SectionTitle>Registrar pago / renovar</SectionTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Select label="Plan" value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                {plans.map((p) => <option key={p.id} value={p.code}>{p.name}</option>)}
              </Select>
              <Field label="Meses" type="number" min="1" max="36" value={months} onChange={(e) => setMonths(e.target.value)} className="money" />
              <Field label="Monto (Q)" type="number" step="0.01" min="0" placeholder="auto" value={amount} onChange={(e) => setAmount(e.target.value)} className="money" />
              <Field label="Nota" value={note} onChange={(e) => setNote(e.target.value)} placeholder="transferencia…" />
            </div>
            {error && <div className="mt-3"><Notice tone="danger" icon="alerta">{error}</Notice></div>}
            <Button type="submit" variant="primary" loading={busy} className="mt-4 w-full">
              Registrar pago
            </Button>
          </form>
        </>
      )}
    </Modal>
  );
}
