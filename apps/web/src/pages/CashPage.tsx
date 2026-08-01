import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatQ, toCentavos } from '@minimarket/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { Page } from '../components/Nav';
import type { ReceiptData } from '../components/Receipt';
import {
  Badge,
  Button,
  Empty,
  Field,
  Modal,
  Notice,
  Panel,
  SectionTitle,
  Select,
  cx,
} from '../components/ui';
import { ReceiptOverlay } from './PosPage';

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
  SALE_IN: 'Venta en efectivo',
  SALE_VOID_OUT: 'Devolución por anulación',
  WITHDRAWAL: 'Retiro',
  EXPENSE_OUT: 'Gasto',
  DEPOSIT_IN: 'Depósito',
  ADJUSTMENT: 'Ajuste',
};

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
    const s = await api<SessionDetail | null>(`/api/cash/sessions/current?registerId=${registerId}`);
    setSession(s);
    setSales(
      s
        ? (await api<{ rows: SaleRow[] }>(`/api/sales?storeId=${storeId}&sessionId=${s.id}`)).rows
        : [],
    );
  }, [registerId, storeId]);

  useEffect(() => {
    load().catch((e) => setError(e instanceof ApiError ? e.message : 'Error cargando la caja'));
  }, [load]);

  async function reprint(saleId: string) {
    setReceipt(await api<ReceiptData>(`/api/sales/${saleId}/receipt`));
  }

  return (
    <Page
      title="Caja"
      subtitle="Turno actual, movimientos y arqueo"
      actions={
        <>
          <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Tienda" className="w-44">
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select value={registerId} onChange={(e) => setRegisterId(e.target.value)} aria-label="Caja" className="w-36">
            {registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </>
      }
    >
      {error && <div className="mb-4"><Notice tone="danger" icon="alerta">{error}</Notice></div>}
      {notice && (
        <div className="mb-4">
          <Notice tone="ok" icon="cheque" onClose={() => setNotice(null)}>{notice}</Notice>
        </div>
      )}

      {!session && (
        <Panel className="p-10 text-center">
          <Empty icon="caja">
            No hay turno abierto en esta caja. Ábralo desde el punto de venta.
          </Empty>
        </Panel>
      )}

      {session && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <h2 className="font-display text-[15px] font-semibold text-[hsl(var(--text-1))]">
                    Turno abierto
                  </h2>
                </div>
                <p className="mt-1 text-xs text-[hsl(var(--text-3))]">
                  Desde{' '}
                  {new Date(session.openedAt).toLocaleString('es-GT', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}{' '}
                  · {session.salesCount} venta(s)
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-3))]">
                  Efectivo esperado
                </p>
                <p className="money text-2xl font-semibold text-[hsl(var(--text-1))]">
                  {formatQ(BigInt(session.expectedSoFar))}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" icon="menos" onClick={() => setModal('withdraw')}>
                Retiro
              </Button>
              <Button size="sm" variant="outline" icon="mas" onClick={() => setModal('deposit')}>
                Depósito
              </Button>
              <Button size="sm" variant="primary" className="ml-auto" onClick={() => setModal('close')}>
                Cerrar caja
              </Button>
            </div>

            <div className="mt-5">
              <SectionTitle>Movimientos</SectionTitle>
              <div className="max-h-80 divide-y divide-white/[0.05] overflow-y-auto">
                {session.movements.map((m) => {
                  const negative = BigInt(m.amount) < 0n;
                  return (
                    <div key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm text-[hsl(var(--text-1))]">
                          {MOVEMENT_LABEL[m.type] ?? m.type}
                        </p>
                        {m.reason && (
                          <p className="truncate text-xs text-[hsl(var(--text-3))]">{m.reason}</p>
                        )}
                      </div>
                      <span
                        className={cx(
                          'money shrink-0 text-sm font-semibold',
                          negative ? 'text-red-400' : 'text-emerald-300',
                        )}
                      >
                        {formatQ(BigInt(m.amount))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Panel>

          <Panel className="p-5">
            <SectionTitle>Ventas del turno</SectionTitle>
            <div className="max-h-[28rem] divide-y divide-white/[0.05] overflow-y-auto">
              {sales.length === 0 && <Empty icon="punto-venta">Sin ventas aún</Empty>}
              {sales.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p
                      className={cx(
                        'money text-sm',
                        s.status === 'VOIDED'
                          ? 'text-[hsl(var(--text-3))] line-through'
                          : 'text-[hsl(var(--text-1))]',
                      )}
                    >
                      No. {s.number}
                    </p>
                    <p className="text-xs text-[hsl(var(--text-3))]">
                      {new Date(s.createdAt).toLocaleTimeString('es-GT', { timeStyle: 'short' })}
                      {s.status === 'VOIDED' && ' · anulada'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="money text-sm font-semibold text-[hsl(var(--text-1))]">
                      {formatQ(BigInt(s.total))}
                    </span>
                    <Button size="sm" variant="ghost" icon="imprimir" onClick={() => reprint(s.id)}>
                      <span className="sr-only">Reimprimir</span>
                    </Button>
                    {s.status === 'COMPLETED' && (
                      <Button size="sm" variant="danger" onClick={() => setVoidTarget(s)}>
                        Anular
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

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
    </Page>
  );
}

function AuthorizerFields({
  email, pin, onEmail, onPin,
}: {
  email: string;
  pin: string;
  onEmail: (v: string) => void;
  onPin: (v: string) => void;
}) {
  return (
    <fieldset className="mt-4 rounded-xl border border-[hsl(var(--accent)/0.3)] bg-[hsl(var(--accent)/0.07)] p-4">
      <legend className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--accent-strong))]">
        <Icon name="candado" size={13} /> Autorización de supervisor
      </legend>
      <Field
        type="email"
        required
        placeholder="Correo del supervisor"
        value={email}
        onChange={(e) => onEmail(e.target.value)}
      />
      <Field
        type="password"
        required
        placeholder="PIN"
        value={pin}
        onChange={(e) => onPin(e.target.value)}
        className="mt-2 money"
      />
    </fieldset>
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

  const titles = {
    withdraw: 'Retiro de efectivo',
    deposit: 'Depósito a caja',
    close: 'Cerrar caja',
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (kind === 'close') {
        const res = await api<{
          expectedAmount: string;
          countedAmount: string;
          difference: string;
        }>(`/api/cash/sessions/${session.id}/close`, {
          method: 'POST',
          body: JSON.stringify({ countedAmount: toCentavos(amount || '0') }),
        });
        const diff = BigInt(res.difference);
        onDone(
          `Caja cerrada. Esperado ${formatQ(BigInt(res.expectedAmount))}, contado ${formatQ(BigInt(res.countedAmount))} → ` +
            (diff === 0n
              ? 'cuadre exacto'
              : diff > 0n
                ? `sobrante ${formatQ(diff)}`
                : `faltante ${formatQ(-diff)}`),
        );
      } else {
        await api(
          `/api/cash/sessions/${session.id}/${kind === 'withdraw' ? 'withdrawals' : 'deposits'}`,
          {
            method: 'POST',
            body: JSON.stringify({
              amount: toCentavos(amount || '0'),
              reason,
              ...(needsPin ? { authorizerEmail, authorizerPin } : {}),
            }),
          },
        );
        onDone(kind === 'withdraw' ? 'Retiro registrado' : 'Depósito registrado');
      }
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'Error');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={titles[kind]}
      description={
        kind === 'close'
          ? `Cuente el efectivo físico. Esperado: ${formatQ(BigInt(session.expectedSoFar))}`
          : undefined
      }
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <Field
          label={kind === 'close' ? 'Efectivo contado (Q)' : 'Monto (Q)'}
          type="number"
          step="0.01"
          min="0"
          required
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="money"
        />
        {kind !== 'close' && (
          <Field
            label="Motivo"
            required
            minLength={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-3"
            hint="Obligatorio: queda en la bitácora."
          />
        )}
        {needsPin && kind === 'withdraw' && (
          <AuthorizerFields
            email={authorizerEmail}
            pin={authorizerPin}
            onEmail={setAuthorizerEmail}
            onPin={setAuthorizerPin}
          />
        )}
        {error && <div className="mt-4"><Notice tone="danger" icon="alerta">{error}</Notice></div>}
        <Button type="submit" variant="primary" size="lg" loading={busy} className="mt-5 w-full">
          Confirmar
        </Button>
      </form>
    </Modal>
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

  async function submit(e: FormEvent) {
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
    <Modal
      title={`Anular venta No. ${sale.number}`}
      description={`Total ${formatQ(BigInt(sale.total))}. Repone el inventario y devuelve el efectivo.`}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <Field
          label="Motivo"
          required
          minLength={3}
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Obligatorio: queda en la bitácora."
        />
        {needsPin && (
          <AuthorizerFields
            email={authorizerEmail}
            pin={authorizerPin}
            onEmail={setAuthorizerEmail}
            onPin={setAuthorizerPin}
          />
        )}
        {error && <div className="mt-4"><Notice tone="danger" icon="alerta">{error}</Notice></div>}
        <Button type="submit" variant="danger" size="lg" loading={busy} className="mt-5 w-full">
          Anular venta
        </Button>
      </form>
    </Modal>
  );
}
