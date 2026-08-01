import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatQ, toCentavos } from '@minimarket/shared';
import { ApiError, startImpersonation } from '../../api/client';
import { clearPlatformSession, platformApi } from '../../api/platformClient';

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

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  SUSPENDED: 'bg-red-50 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
  CANCELLED: 'Cancelado',
};

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-800';

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

  async function impersonate(tenant: TenantRow) {
    const reason = window.prompt(
      `Motivo del acceso de soporte a "${tenant.name}" (queda en la bitácora):`,
    );
    if (!reason || reason.trim().length < 5) return;
    try {
      const res = await platformApi<{
        accessToken: string;
        tenant: { name: string };
        actingAs: { name: string; email: string };
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
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo iniciar la sesión de soporte');
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center gap-4 bg-slate-900 px-6 py-3 text-white">
        <span className="font-bold">MiniMarket · Plataforma</span>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => {
              clearPlatformSession();
              navigate('/plataforma/login', { replace: true });
            }}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800"
          >
            Salir
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-6">
        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {notice && (
          <p className="mb-3 flex justify-between gap-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <span className="whitespace-pre-line">{notice}</span>
            <button onClick={() => setNotice(null)}>✕</button>
          </p>
        )}

        {metrics && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile
                label="Clientes activos"
                value={String(metrics.tenants.active)}
                hint={`${metrics.tenants.suspended} suspendido(s) · ${metrics.tenants.total} total`}
              />
              <Tile
                label="Ingreso mensual"
                value={formatQ(BigInt(metrics.revenue.mrr))}
                hint={`${metrics.revenue.payingTenants} de pago`}
                accent
              />
              <Tile
                label="Volumen transado (30 d)"
                value={formatQ(BigInt(metrics.volume.volume30d))}
                hint={`${metrics.volume.sales30d} ventas · ${metrics.volume.salesToday} hoy`}
              />
              <Tile
                label="Escala"
                value={`${metrics.scale.stores} tiendas`}
                hint={`${metrics.scale.users} usuarios · ${metrics.scale.products} productos`}
              />
            </div>

            {metrics.needsAttention.length > 0 && (
              <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <h2 className="text-sm font-semibold text-amber-900">
                  Requieren atención ({metrics.needsAttention.length})
                </h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  {metrics.needsAttention.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setDetailId(a.id)}
                      className="rounded-lg bg-white px-3 py-1.5 text-xs text-amber-900 shadow-sm hover:bg-amber-100"
                    >
                      <strong>{a.name}</strong> — {a.reason}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={() => setTab('tenants')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === 'tenants' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'
            }`}
          >
            Clientes
          </button>
          <button
            onClick={() => setTab('plans')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === 'plans' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'
            }`}
          >
            Planes
          </button>
          {tab === 'tenants' && (
            <button
              onClick={() => setOnboarding(true)}
              className="ml-auto rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              + Nuevo cliente
            </button>
          )}
        </div>

        {tab === 'tenants' && (
          <div className="mt-3 overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Negocio</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Vence</th>
                  <th className="px-4 py-3 text-right">Tiendas</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <button onClick={() => setDetailId(t.id)} className="font-medium text-slate-800 hover:text-emerald-700">
                        {t.name}
                      </button>
                      <div className="text-xs text-slate-400">{t.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{t.subscription?.plan.name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {t.subscription ? new Date(t.subscription.periodEnd).toLocaleDateString('es-GT') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {t.stores} / {t.users}u
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status]}`}>
                        {STATUS_LABEL[t.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => impersonate(t)} className="mr-3 text-xs font-medium text-slate-500 hover:text-slate-800">
                        Ver como
                      </button>
                      <button
                        onClick={() => setStatusTarget(t)}
                        className={`text-xs font-medium ${
                          t.status === 'ACTIVE' ? 'text-red-600 hover:text-red-800' : 'text-emerald-700 hover:text-emerald-900'
                        }`}
                      >
                        {t.status === 'ACTIVE' ? 'Suspender' : 'Reactivar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'plans' && (
          <div className="mt-3 overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3 text-right">Tiendas</th>
                  <th className="px-4 py-3 text-right">Usuarios</th>
                  <th className="px-4 py-3 text-right">Precio mensual</th>
                  <th className="px-4 py-3 text-right">Contratos</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50">
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-800">{p.name}</span>
                      <div className="text-xs text-slate-400">{p.code}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{p.maxStores}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{p.maxUsers}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">
                      {formatQ(BigInt(p.monthlyPrice))}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">{p._count.subscriptions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

function Tile({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
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
    name: '',
    slug: '',
    planCode: plans[0]?.code ?? '',
    ownerName: '',
    ownerEmail: '',
    ownerPhone: '',
    storeName: '',
    taxRegime: 'PEQUENO_CONTRIBUYENTE',
    trialDays: '30',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.value;
    setForm((f) => ({
      ...f,
      [k]: value,
      // El identificador se sugiere del nombre, pero sigue siendo editable.
      ...(k === 'name' && !f.slug
        ? {}
        : {}),
    }));
  };

  function suggestSlug(name: string) {
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
        owner: { email: string; temporaryPassword: string };
      }>('/api/platform/tenants', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          slug: form.slug || suggestSlug(form.name),
          ownerPhone: form.ownerPhone || undefined,
          trialDays: Number(form.trialDays),
        }),
      });
      onDone(
        `Cliente creado.\nEntregue estas credenciales al dueño:\n` +
          `Correo: ${res.owner.email}\nContraseña temporal: ${res.owner.temporaryPassword}\n` +
          `(deberá cambiarla al primer ingreso — no volverá a mostrarse)`,
      );
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error al crear el cliente');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 className="text-lg font-bold text-slate-800">Nuevo cliente</h2>
        <p className="mt-1 text-sm text-slate-500">
          Crea el negocio, su dueño, la primera tienda con caja y la suscripción.
        </p>

        <label className="mt-3 block text-sm font-medium text-slate-700">
          Nombre del negocio *
          <input
            required
            value={form.name}
            onChange={(e) => {
              const name = e.target.value;
              setForm((f) => ({ ...f, name, slug: f.slug || '' }));
            }}
            onBlur={() => setForm((f) => ({ ...f, slug: f.slug || suggestSlug(f.name) }))}
            className={inputCls}
            autoFocus
          />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-slate-700">
            Identificador
            <input value={form.slug} onChange={set('slug')} className={inputCls} placeholder="se sugiere solo" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Plan *
            <select required value={form.planCode} onChange={set('planCode')} className={inputCls}>
              {plans.filter((p) => p.isActive).map((p) => (
                <option key={p.id} value={p.code}>
                  {p.name} — {formatQ(BigInt(p.monthlyPrice))}/mes
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Nombre del dueño *
            <input required value={form.ownerName} onChange={set('ownerName')} className={inputCls} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Correo del dueño *
            <input required type="email" value={form.ownerEmail} onChange={set('ownerEmail')} className={inputCls} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Teléfono
            <input value={form.ownerPhone} onChange={set('ownerPhone')} className={inputCls} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Nombre de la tienda *
            <input required value={form.storeName} onChange={set('storeName')} className={inputCls} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Régimen fiscal
            <select value={form.taxRegime} onChange={set('taxRegime')} className={inputCls}>
              <option value="PEQUENO_CONTRIBUYENTE">Pequeño contribuyente (5%)</option>
              <option value="GENERAL">Régimen general (12%)</option>
              <option value="NINGUNO">Ninguno</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Días de prueba
            <input type="number" min="0" max="365" value={form.trialDays} onChange={set('trialDays')} className={inputCls} />
          </label>
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          disabled={busy}
          className="mt-4 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? 'Creando…' : 'Crear cliente'}
        </button>
      </form>
    </div>
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
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-800">
          {suspending ? 'Suspender' : 'Reactivar'} {tenant.name}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {suspending
            ? 'Sus usuarios dejarán de poder ingresar. Los datos se conservan intactos.'
            : 'Sus usuarios volverán a operar normalmente.'}
        </p>
        {tenant.suspendedReason && (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Motivo de la suspensión actual: {tenant.suspendedReason}
          </p>
        )}
        <label className="mt-3 block text-sm font-medium text-slate-700">
          Motivo * (queda en bitácora)
          <input required minLength={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
        </label>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          disabled={busy}
          className={`mt-4 w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${
            suspending ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'
          }`}
        >
          {busy ? 'Aplicando…' : suspending ? 'Suspender servicio' : 'Reactivar servicio'}
        </button>
      </form>
    </div>
  );
}

interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  status: string;
  contactEmail: string | null;
  contactPhone: string | null;
  stores: { id: string; name: string; isActive: boolean }[];
  users: { id: string; name: string; email: string; isActive: boolean; lastLoginAt: string | null }[];
  subscriptions: {
    id: string;
    status: string;
    periodStart: string;
    periodEnd: string;
    amount: string;
    paymentNote: string | null;
    plan: { code: string; name: string };
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
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        {!detail && <p className="text-sm text-slate-400">Cargando…</p>}
        {detail && (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800">{detail.name}</h2>
                <p className="text-sm text-slate-500">
                  {detail.slug} · {detail.contactEmail ?? 'sin correo'}
                </p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[detail.status]}`}>
                {STATUS_LABEL[detail.status]}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Ventas 30 d" value={String(detail.activity.sales30d)} />
              <MiniStat label="Volumen 30 d" value={formatQ(BigInt(detail.activity.salesTotal30d))} />
              <MiniStat label="Productos" value={String(detail.activity.products)} />
              <MiniStat
                label="Última venta"
                value={detail.activity.lastSale ? new Date(detail.activity.lastSale).toLocaleDateString('es-GT') : '—'}
              />
            </div>

            <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Tiendas y usuarios
            </h3>
            <div className="mt-1 text-sm text-slate-600">
              {detail.stores.map((s) => s.name).join(', ')} · {detail.users.length} usuario(s)
            </div>

            <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Historial de suscripciones
            </h3>
            <div className="mt-1 max-h-40 overflow-y-auto">
              {detail.subscriptions.map((s) => (
                <div key={s.id} className="flex justify-between border-b border-slate-50 py-1.5 text-sm">
                  <span className="text-slate-600">
                    {s.plan.name} · {new Date(s.periodStart).toLocaleDateString('es-GT')} →{' '}
                    {new Date(s.periodEnd).toLocaleDateString('es-GT')}
                    {s.paymentNote && <span className="text-xs text-slate-400"> · {s.paymentNote}</span>}
                  </span>
                  <span className="font-medium text-slate-800">{formatQ(BigInt(s.amount))}</span>
                </div>
              ))}
            </div>

            <form onSubmit={registerPayment} className="mt-5 rounded-xl bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-700">Registrar pago / renovar</h3>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="text-xs font-medium text-slate-600">
                  Plan
                  <select value={planCode} onChange={(e) => setPlanCode(e.target.value)} className={inputCls}>
                    {plans.map((p) => <option key={p.id} value={p.code}>{p.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Meses
                  <input type="number" min="1" max="36" value={months} onChange={(e) => setMonths(e.target.value)} className={inputCls} />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Monto (Q)
                  <input type="number" step="0.01" min="0" placeholder="auto" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Nota
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="transferencia…" className={inputCls} />
                </label>
              </div>
              {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <button
                disabled={busy}
                className="mt-3 w-full rounded-lg bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busy ? 'Registrando…' : 'Registrar pago'}
              </button>
            </form>

            <button onClick={onClose} className="mt-4 w-full rounded-lg border border-slate-300 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Cerrar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}
