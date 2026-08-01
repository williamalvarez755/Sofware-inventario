import { formatQ } from '@minimarket/shared';

export interface ReceiptData {
  number: string;
  status: string;
  createdAt: string;
  subtotal: string;
  discount: string;
  total: string;
  taxBreakdown: string;
  items: { name: string; qty: string; unitPrice: string; lineTotal: string }[];
  payments: { method: string; amount: string; amountTendered: string | null }[];
  store: {
    name: string;
    address: string | null;
    phone: string | null;
    receiptHeader: string | null;
    receiptFooter: string | null;
  } | null;
  business?: string;
  cashier?: string;
}

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
};

/**
 * Comprobante 58/80 mm. Deliberadamente en blanco y negro y con tipografía
 * monoespaciada: es lo que sale por la impresora térmica, no una pantalla.
 * La clase `receipt-print` activa el CSS de impresión.
 */
export function Receipt({ data }: { data: ReceiptData }) {
  const change = data.payments.reduce((acc, p) => {
    if (p.method === 'CASH' && p.amountTendered) {
      return acc + (BigInt(p.amountTendered) - BigInt(p.amount));
    }
    return acc;
  }, 0n);

  return (
    <div className="receipt-print mx-auto w-[290px] rounded-lg bg-white p-4 font-mono text-[12px] leading-[1.45] text-black">
      <div className="text-center">
        <p className="text-[13px] font-bold uppercase tracking-wide">{data.business}</p>
        <p>{data.store?.name}</p>
        {data.store?.receiptHeader && <p>{data.store.receiptHeader}</p>}
        {data.store?.address && <p>{data.store.address}</p>}
        {data.store?.phone && <p>Tel: {data.store.phone}</p>}
      </div>

      <Divider />
      <p>
        Comprobante No. {data.number}
        {data.status === 'VOIDED' && <strong> — ANULADO</strong>}
      </p>
      <p>{new Date(data.createdAt).toLocaleString('es-GT')}</p>
      {data.cashier && <p>Le atendió: {data.cashier}</p>}
      <Divider />

      {data.items.map((item, i) => (
        <div key={i} className="flex justify-between gap-2">
          <span className="min-w-0 flex-1 truncate">
            {Number(item.qty)} x {item.name}
          </span>
          <span className="shrink-0 tabular-nums">{formatQ(BigInt(item.lineTotal))}</span>
        </div>
      ))}

      <Divider />
      {BigInt(data.discount) > 0n && (
        <>
          <Line label="Subtotal" value={formatQ(BigInt(data.subtotal))} />
          <Line label="Descuento" value={`-${formatQ(BigInt(data.discount))}`} />
        </>
      )}
      <div className="flex justify-between text-[15px] font-bold">
        <span>TOTAL</span>
        <span className="tabular-nums">{formatQ(BigInt(data.total))}</span>
      </div>
      {data.payments.map((p, i) => (
        <Line
          key={i}
          label={METHOD_LABEL[p.method] ?? p.method}
          value={formatQ(BigInt(p.amountTendered ?? p.amount))}
        />
      ))}
      {change > 0n && <Line label="Cambio" value={formatQ(change)} />}

      <Divider />
      <p className="text-center">{data.store?.receiptFooter ?? '¡Gracias por su compra!'}</p>
    </div>
  );
}

const Divider = () => <div className="my-1.5 border-t border-dashed border-black/60" />;

const Line = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between">
    <span>{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>
);
