import { useCallback, useEffect, useState } from 'react';
import { formatQ, toCentavos } from '@minimarket/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Nav } from '../components/Nav';
import { ReceiptOverlay } from './PosPage';
import type { ReceiptData } from '../components/Receipt';

interface StoreOpt { id: string; name: string }
interface RegisterOpt { id: string; name: string }
interface Movement {
  id: string;
  type: string;
  amount: string;
  reason: string | null;
  createdAt: string;
}
interface SessionDetail {
  id: string;
  status: string;
  openedAt: string;
  openingAmount: string;
  expectedSoFar: string;
  salesCount: number;
  movements: Movement[];
}
interface SaleRow {
  id: string;
  number: string;
  status: string;
  total: string;
  createdAt: string;
  payments: { method: string; amount: string }[];
}

const MOVEMENT_LABEL: Record<string, string> = {
  OPENING: 'Apertura',
  SALE_IN: 'Venta (efectivo)',
  SALE_VOID_OUT: 'Devolución por anulación',
  WITHDRAWAL: 'Retiro',
  EXPENSE_OUT: 'Gasto',
  DEPOSIT_IN: 'Depósito',
  ADJUSTMENT: 'Ajuste',
};

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';

export function CashPage() {
  const { me } = useAuth();
  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [storeId, setStoreId] = useState('');
  const [registers, setRegisters] = useState<RegisterOpt[]>([]);
  const [registerId, setRegisterId] = useState('');
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<'withdraw' | 'deposit' | 'close' | null>(null);
  const [voidTarget, setVoidTarget] = useState<SaleRow | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const isWorkerOnly = me?.memberships.every((m) => m.role === 'WORKER') ?? true;

  useEffect(() => {
    api<StoreOpt[]>('/api/stores').then((s) => {
      setStores(s);
      if (s.length) setStoreId(s[0]!.id);
    });
  }, []);

  useEffect(() => {
    if (!storeId) return;
    api<RegisterOpt[]>(`/api/cash/registers?storeId=${storeId}`).then((r) => {
      setRegisters(r);
      setRegisterId(r[0]?.id ?? '');
    });
  }, [storeId]);

  const load = useCallback(async () => {
    if (!registerId) return;
    const s = await api<SessionDetail | null>(
      `/api/cash/sessions/current?registerId=${registerId}`,
    );
    setSession(s);
    if (s) {
      const list = await api<{ rows: SaleRow[] }>(
        `/api/sales?storeId=${storeId}&sessionId=${s.id}`,
      );
      setSales(list.rows);
    } else {
      setSales([]);
    }
  }, [registerId, storeId]);

  useEffect(() => {
    load().catch((e) => setError(e instanceof ApiError ? e.message : 'Error cargando caja'));
  }, [load]);

  async function reprint(saleId: string) {
    setReceipt(await api<ReceiptData>(`/api/sales/${saleId}/receipt`));
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Nav />
      <main className="mx-auto max-w-5xl p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-slate-800">Caja</h1>
          <div className="ml-auto flex gap-2">
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={inputCls + ' w-auto'}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={registerId} onChange={(e) => setRegisterId(e.target.value)} className={inputCls + ' w-auto'}>
              {registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>

        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {notice && (
          <p className="mb-3 flex justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice} <button onClick={() => setNotice(null)}>✕</button>
          </p>
        )}

        {!session && (
          <p className="rounded-xl bg-white p-8 text-center text-slate-400 shadow-sm">
            No hay sesión abierta en esta caja. Ábrala desde la pantalla <strong>POS</strong>.
          </p>
        )}

        {session && (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-bold text-slate-800">Turno actual</h2>
                  <p className="text-sm text-slate-500">
                    Abierto {new Date(session.openedAt).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })}
                    {' · '}{session.salesCount} venta(s)
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase text-slate-400">Efectivo esperado</p>
                  <p className="text-2xl font-bold text-slate-900">{formatQ(BigInt(session.expectedSoFar))}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => setModal('withdraw')} className="rounded-lg border border-amber-500 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50">
                  Retiro
                </button>
                <button onClick={() => setModal('deposit')} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                  Depósito
                </button>
                <button onClick={() => setModal('close')} className="ml-auto rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900">
                  Cerrar caja
                </button>
              </div>

              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Movimientos</h3>
              <div className="mt-2 max-h-72 overflow-y-auto">
                {session.movements.map((m) => (
                  <div key={m.id} className="flex items-center justify-between border-b border-slate-50 py-2 text-sm">
                    <div>
                      <p className="text-slate-700">{MOVEMENT_LABEL[m.type] ?? m.type}</p>
                      {m.reason && <p className="text-xs text-slate-400">{m.reason}</p>}
                    </div>
                    <span className={BigInt(m.amount) < 0n ? 'font-medium text-red-600' : 'font-medium text-emerald-700'}>
                      {formatQ(BigInt(m.amount))}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="font-bold text-slate-800">Ventas del turno</h2>
              <div className="mt-2 max-h-96 overflow-y-auto">
                {sales.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Sin ventas aún</p>}
                {sales.map((s) => (
                  <div key={s.id} className="flex items-center justify-between border-b border-slate-50 py-2 text-sm">
                    <div>
                      <p className={s.status === 'VOIDED' ? 'text-slate-400 line-through' : 'text-slate-700'}>
                        #{s.number} · {new Date(s.createdAt).toLocaleTimeString('es-GT', { timeStyle: 'short' })}
                      </p>
                      {s.status === 'VOIDED' && <p className="text-xs text-red-500">Anulada</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-slate-800">{formatQ(BigInt(s.total))}</span>
                      <button onClick={() => reprint(s.id)} className="text-xs font-medium text-slate-500 hover:text-slate-700">
                        Reimprimir
                      </button>
                      {s.status === 'COMPLETED' && (
                        <button onClick={() => setVoidTarget(s)} className="text-xs font-medium text-red-600 hover:text-red-800">
                          Anular
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>

      {modal && session && (
        <CashModal
          kind={modal}
          session={session}
          needsPin={isWorkerOnly && modal === 'withdraw'}
          onClose={() => setModal(null)}
          onDone={(msg) => {
            setModal(null);
            setNotice(msg);
            load();
          }}
        />
      )}
      {voidTarget && (
        <VoidModal
          sale={voidTarget}
          needsPin={isWorkerOnly}
          onClose={() => setVoidTarget(null)}
          onDone={() => {
            setVoidTarget(null);
            setNotice('Venta anulada: inventario y caja compensados');
            load();
          }}
        />
      )}
      {receipt && <ReceiptOverlay data={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function CashModal({
  kind, session, needsPin, onClose, onDone,
}: {
  kind: 'withdraw' | 'deposit' | 'close';
  session: SessionDetail;
  needsPin: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [authorizerEmail, setAuthorizerEmail] = useState('');
  const [authorizerPin, setAuthorizerPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const titles = { withdraw: 'Retiro de efectivo', deposit: 'Depósito a caja', close: 'Cerrar caja (arqueo)' };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (kind === 'close') {
        const res = await api<{ expectedAmount: string; countedAmount: string; difference: string }>(
          `/api/cash/sessions/${session.id}/close`,
          { method: 'POST', body: JSON.stringify({ countedAmount: toCentavos(amount || '0') }) },
        );
        const diff = BigInt(res.difference);
        onDone(
          `Caja cerrada. Esperado ${formatQ(BigInt(res.expectedAmount))}, contado ${formatQ(BigInt(res.countedAmount))} → ` +
            (diff === 0n ? 'cuadre exacto ✔' : diff > 0n ? `sobrante ${formatQ(diff)}` : `faltante ${formatQ(-diff)}`),
        );
      } else {
        await api(`/api/cash/sessions/${session.id}/${kind === 'withdraw' ? 'withdrawals' : 'deposits'}`, {
          method: 'POST',
          body: JSON.stringify({
            amount: toCentavos(amount || '0'),
            reason,
            ...(needsPin ? { authorizerEmail, authorizerPin } : {}),
          }),
        });
        onDone(kind === 'withdraw' ? 'Retiro registrado' : 'Depósito registrado');
      }
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-800">{titles[kind]}</h2>
        {kind === 'close' && (
          <p className="mt-1 text-sm text-slate-500">
            Cuente el efectivo físico. Esperado: <strong>{formatQ(BigInt(session.expectedSoFar))}</strong>
          </p>
        )}
        <label className="mt-3 block text-sm font-medium text-slate-700">
          {kind === 'close' ? 'Efectivo contado (Q)' : 'Monto (Q)'}
          <input type="number" step="0.01" min="0" required autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls + ' mt-1'} />
        </label>
        {kind !== 'close' && (
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Motivo * (queda en bitácora)
            <input required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls + ' mt-1'} />
          </label>
        )}
        {needsPin && kind === 'withdraw' && (
          <fieldset className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <legend className="px-1 text-xs font-semibold uppercase text-amber-700">Autorización de supervisor</legend>
            <input type="email" required placeholder="Correo del supervisor" value={authorizerEmail} onChange={(e) => setAuthorizerEmail(e.target.value)} className={inputCls} />
            <input type="password" required placeholder="PIN" value={authorizerPin} onChange={(e) => setAuthorizerPin(e.target.value)} className={inputCls + ' mt-2'} />
          </fieldset>
        )}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="mt-4 w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {busy ? 'Procesando…' : 'Confirmar'}
        </button>
      </form>
    </div>
  );
}

function VoidModal({
  sale, needsPin, onClose, onDone,
}: {
  sale: SaleRow;
  needsPin: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [authorizerEmail, setAuthorizerEmail] = useState('');
  const [authorizerPin, setAuthorizerPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api(`/api/sales/${sale.id}/void`, {
        method: 'POST',
        body: JSON.stringify({
          reason,
          ...(needsPin ? { authorizerEmail, authorizerPin } : {}),
        }),
      });
      onDone();
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error al anular');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-800">Anular venta #{sale.number}</h2>
        <p className="mt-1 text-sm text-slate-500">
          Total {formatQ(BigInt(sale.total))}. Repone el inventario y devuelve el efectivo en caja.
        </p>
        <label className="mt-3 block text-sm font-medium text-slate-700">
          Motivo * (queda en bitácora)
          <input required minLength={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls + ' mt-1'} />
        </label>
        {needsPin && (
          <fieldset className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <legend className="px-1 text-xs font-semibold uppercase text-amber-700">Autorización de supervisor</legend>
            <input type="email" required placeholder="Correo del supervisor" value={authorizerEmail} onChange={(e) => setAuthorizerEmail(e.target.value)} className={inputCls} />
            <input type="password" required placeholder="PIN" value={authorizerPin} onChange={(e) => setAuthorizerPin(e.target.value)} className={inputCls + ' mt-2'} />
          </fieldset>
        )}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="mt-4 w-full rounded-lg bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
          {busy ? 'Anulando…' : 'Anular venta'}
        </button>
      </form>
    </div>
  );
}
