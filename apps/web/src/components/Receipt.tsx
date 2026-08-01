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

/** Comprobante 58/80 mm — la clase receipt-print activa el CSS de impresión. */
export function Receipt({ data }: { data: ReceiptData }) {
  const change = data.payments.reduce((acc, p) => {
    if (p.method === 'CASH' && p.amountTendered) {
      return acc + (BigInt(p.amountTendered) - BigInt(p.amount));
    }
    return acc;
  }, 0n);

  return (
    <div className="receipt-print mx-auto w-[280px] bg-white p-3 font-mono text-[12px] leading-tight text-black">
      <div className="text-center">
        <p className="font-bold">{data.business}</p>
        <p>{data.store?.name}</p>
        {data.store?.receiptHeader && <p>{data.store.receiptHeader}</p>}
        {data.store?.address && <p>{data.store.address}</p>}
        {data.store?.phone && <p>Tel: {data.store.phone}</p>}
      </div>
      <hr className="my-1 border-dashed border-black" />
      <p>
        Comprobante No. {data.number}
        {data.status === 'VOIDED' && <strong> — ANULADO</strong>}
      </p>
      <p>{new Date(data.createdAt).toLocaleString('es-GT')}</p>
      {data.cashier && <p>Le atendió: {data.cashier}</p>}
      <hr className="my-1 border-dashed border-black" />
      {data.items.map((item, i) => (
        <div key={i} className="flex justify-between gap-1">
          <span className="min-w-0 flex-1 truncate">
            {Number(item.qty)} x {item.name}
          </span>
          <span className="shrink-0">{formatQ(BigInt(item.lineTotal))}</span>
        </div>
      ))}
      <hr className="my-1 border-dashed border-black" />
      {BigInt(data.discount) > 0n && (
        <>
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatQ(BigInt(data.subtotal))}</span>
          </div>
          <div className="flex justify-between">
            <span>Descuento</span>
            <span>-{formatQ(BigInt(data.discount))}</span>
          </div>
        </>
      )}
      <div className="flex justify-between text-[14px] font-bold">
        <span>TOTAL</span>
        <span>{formatQ(BigInt(data.total))}</span>
      </div>
      {data.payments.map((p, i) => (
        <div key={i} className="flex justify-between">
          <span>{METHOD_LABEL[p.method] ?? p.method}</span>
          <span>{formatQ(BigInt(p.amountTendered ?? p.amount))}</span>
        </div>
      ))}
      {change > 0n && (
        <div className="flex justify-between">
          <span>Cambio</span>
          <span>{formatQ(change)}</span>
        </div>
      )}
      <hr className="my-1 border-dashed border-black" />
      <p className="text-center">{data.store?.receiptFooter ?? '¡Gracias por su compra!'}</p>
    </div>
  );
}
