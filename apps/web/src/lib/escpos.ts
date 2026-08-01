/**
 * Impresión térmica directa vía QZ Tray (D-009, segunda vía).
 *
 * Estado de verificación: la generación de comandos ESC/POS está probada por
 * unidad (bytes exactos). La impresión sobre hardware real NO está verificada
 * — requiere una impresora física y QZ Tray instalado. Ver docs/impresion.md.
 *
 * Si QZ Tray no está disponible, el POS sigue usando la impresión por CSS de
 * la Fase 2, que funciona con cualquier impresora instalada en el sistema.
 */
import { formatQ } from '@minimarket/shared';
import type { ReceiptData } from '../components/Receipt';

const ESC = '\x1B';
const GS = '\x1D';

export const CMD = {
  init: `${ESC}@`,
  alignCenter: `${ESC}a1`,
  alignLeft: `${ESC}a0`,
  boldOn: `${ESC}E1`,
  boldOff: `${ESC}E0`,
  doubleHeight: `${GS}!\x01`,
  normalSize: `${GS}!\x00`,
  /** Corte parcial dejando avance de papel: lo estándar en tickets. */
  cut: `${GS}V\x42\x00`,
  /** Pulso al conector RJ11: abre la gaveta de dinero. */
  openDrawer: `${ESC}p\x00\x19\xFA`,
  feed: (lines: number) => `${ESC}d${String.fromCharCode(lines)}`,
};

const WIDTH = 42; // caracteres por línea en papel de 80 mm, fuente A

/** Alinea concepto a la izquierda y monto a la derecha en el ancho del papel. */
function row(left: string, right: string, width = WIDTH): string {
  const space = Math.max(1, width - left.length - right.length);
  return `${left}${' '.repeat(space)}${right}\n`;
}

const METHOD_LABEL: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
};

/** Construye el ticket completo como cadena de comandos ESC/POS. */
export function buildReceiptCommands(
  data: ReceiptData,
  options: { openDrawer?: boolean } = {},
): string {
  const parts: string[] = [CMD.init, CMD.alignCenter, CMD.boldOn];
  parts.push(`${data.business ?? ''}\n`);
  parts.push(CMD.boldOff);
  if (data.store?.name) parts.push(`${data.store.name}\n`);
  if (data.store?.receiptHeader) parts.push(`${data.store.receiptHeader}\n`);
  if (data.store?.address) parts.push(`${data.store.address}\n`);
  if (data.store?.phone) parts.push(`Tel: ${data.store.phone}\n`);

  parts.push(CMD.alignLeft);
  parts.push('-'.repeat(WIDTH) + '\n');
  parts.push(`Comprobante No. ${data.number}\n`);
  if (data.status === 'VOIDED') {
    parts.push(CMD.boldOn, '*** ANULADO ***\n', CMD.boldOff);
  }
  parts.push(`${new Date(data.createdAt).toLocaleString('es-GT')}\n`);
  if (data.cashier) parts.push(`Le atendio: ${data.cashier}\n`);
  parts.push('-'.repeat(WIDTH) + '\n');

  for (const item of data.items) {
    const qty = Number(item.qty);
    // Nombre en su propia línea si es largo: el monto nunca debe quedar cortado.
    const label = `${qty} x ${item.name}`;
    if (label.length > WIDTH - 10) {
      parts.push(`${label}\n`);
      parts.push(row('', formatQ(BigInt(item.lineTotal))));
    } else {
      parts.push(row(label, formatQ(BigInt(item.lineTotal))));
    }
  }

  parts.push('-'.repeat(WIDTH) + '\n');
  if (BigInt(data.discount) > 0n) {
    parts.push(row('Subtotal', formatQ(BigInt(data.subtotal))));
    parts.push(row('Descuento', `-${formatQ(BigInt(data.discount))}`));
  }
  parts.push(CMD.boldOn, CMD.doubleHeight);
  parts.push(row('TOTAL', formatQ(BigInt(data.total)), WIDTH / 2));
  parts.push(CMD.normalSize, CMD.boldOff);

  let change = 0n;
  for (const payment of data.payments) {
    const shown = payment.amountTendered ?? payment.amount;
    parts.push(row(METHOD_LABEL[payment.method] ?? payment.method, formatQ(BigInt(shown))));
    if (payment.method === 'CASH' && payment.amountTendered) {
      change += BigInt(payment.amountTendered) - BigInt(payment.amount);
    }
  }
  if (change > 0n) parts.push(row('Cambio', formatQ(change)));

  parts.push('-'.repeat(WIDTH) + '\n');
  parts.push(CMD.alignCenter);
  parts.push(`${data.store?.receiptFooter ?? 'Gracias por su compra'}\n`);
  parts.push(CMD.feed(3));
  if (options.openDrawer) parts.push(CMD.openDrawer);
  parts.push(CMD.cut);

  return parts.join('');
}

// ─────────────────────────── Integración con QZ Tray ───────────────────────────

interface QzApi {
  websocket: { isActive(): boolean; connect(): Promise<void> };
  printers: { getDefault(): Promise<string>; find(): Promise<string[]> };
  configs: { create(printer: string): unknown };
  print(config: unknown, data: unknown[]): Promise<void>;
}

function qz(): QzApi | null {
  return (window as unknown as { qz?: QzApi }).qz ?? null;
}

/** ¿Está el agente local disponible en esta máquina? */
export function isThermalPrintingAvailable(): boolean {
  return qz() !== null;
}

export async function listPrinters(): Promise<string[]> {
  const api = qz();
  if (!api) return [];
  if (!api.websocket.isActive()) await api.websocket.connect();
  return api.printers.find();
}

/**
 * Imprime el ticket en la impresora térmica. Devuelve false si el agente no
 * está disponible, para que el POS caiga a la impresión por navegador sin
 * interrumpir la venta — el cobro ya ocurrió, imprimir es lo secundario.
 */
export async function printThermalReceipt(
  data: ReceiptData,
  options: { printerName?: string; openDrawer?: boolean } = {},
): Promise<boolean> {
  const api = qz();
  if (!api) return false;
  if (!api.websocket.isActive()) await api.websocket.connect();
  const printer = options.printerName ?? (await api.printers.getDefault());
  if (!printer) return false;
  const config = api.configs.create(printer);
  await api.print(config, [
    { type: 'raw', format: 'plain', data: buildReceiptCommands(data, options) },
  ]);
  return true;
}
