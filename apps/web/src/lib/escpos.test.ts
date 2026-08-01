/**
 * Comandos ESC/POS. La impresora no puede probarse aquí, pero SÍ los bytes que
 * se le envían — que es donde estarían los errores silenciosos: un ticket sin
 * corte, una gaveta que se abre cuando no debe, o montos desalineados.
 */
import { describe, expect, it } from 'vitest';
import { buildReceiptCommands, CMD } from './escpos';
import type { ReceiptData } from '../components/Receipt';

const receipt: ReceiptData = {
  number: '128',
  status: 'COMPLETED',
  createdAt: '2026-08-01T18:30:00.000Z',
  subtotal: '14500',
  discount: '0',
  total: '14500',
  taxBreakdown: '0',
  items: [
    { name: 'Agua pura 500ml', qty: '2', unitPrice: '500', lineTotal: '1000' },
    { name: 'Azúcar a granel', qty: '1.5', unitPrice: '450', lineTotal: '675' },
  ],
  payments: [{ method: 'CASH', amount: '14500', amountTendered: '20000' }],
  store: {
    name: 'Central',
    address: '4a calle 5-20 zona 1',
    phone: '5555-1234',
    receiptHeader: null,
    receiptFooter: '¡Gracias por su compra!',
  },
  business: 'Tienda La Bendición',
  cashier: 'María López',
};

describe('Ticket ESC/POS', () => {
  it('inicializa, corta el papel y NO abre la gaveta salvo que se pida', () => {
    const out = buildReceiptCommands(receipt);
    expect(out.startsWith(CMD.init)).toBe(true);
    expect(out.endsWith(CMD.cut)).toBe(true);
    expect(out).not.toContain(CMD.openDrawer);

    const withDrawer = buildReceiptCommands(receipt, { openDrawer: true });
    expect(withDrawer).toContain(CMD.openDrawer);
    // La gaveta se abre ANTES del corte, no después
    expect(withDrawer.indexOf(CMD.openDrawer)).toBeLessThan(withDrawer.lastIndexOf(CMD.cut));
  });

  it('incluye negocio, tienda, comprobante y cajero', () => {
    const out = buildReceiptCommands(receipt);
    expect(out).toContain('Tienda La Bendición');
    expect(out).toContain('Central');
    expect(out).toContain('Comprobante No. 128');
    expect(out).toContain('María López');
    expect(out).toContain('¡Gracias por su compra!');
  });

  it('alinea los montos a la derecha sin cortarlos', () => {
    const out = buildReceiptCommands(receipt);
    const line = out.split('\n').find((l) => l.includes('Agua pura'))!;
    expect(line).toMatch(/^2 x Agua pura 500ml\s+Q 10\.00$/);
    expect(line.length).toBe(42); // ancho de papel de 80 mm
  });

  it('parte en dos líneas los nombres largos para no truncar el monto', () => {
    const long = {
      ...receipt,
      items: [
        {
          name: 'Detergente en polvo multiusos presentación familiar',
          qty: '1',
          unitPrice: '4500',
          lineTotal: '4500',
        },
      ],
    };
    const out = buildReceiptCommands(long);
    expect(out).toContain('1 x Detergente en polvo multiusos presentación familiar\n');
    expect(out).toContain('Q 45.00'); // el monto sobrevive completo
  });

  it('muestra el cambio calculado desde el efectivo recibido', () => {
    const out = buildReceiptCommands(receipt);
    expect(out).toContain('Efectivo');
    expect(out).toContain('Q 200.00'); // recibido
    expect(out).toMatch(/Cambio\s+Q 55\.00/); // 200.00 − 145.00
  });

  it('marca visiblemente las ventas anuladas', () => {
    const out = buildReceiptCommands({ ...receipt, status: 'VOIDED' });
    expect(out).toContain('*** ANULADO ***');
  });

  it('desglosa subtotal y descuento solo cuando hay descuento', () => {
    expect(buildReceiptCommands(receipt)).not.toContain('Descuento');
    const withDiscount = buildReceiptCommands({
      ...receipt,
      subtotal: '15000',
      discount: '500',
      total: '14500',
    });
    expect(withDiscount).toMatch(/Descuento\s+-Q 5\.00/);
    expect(withDiscount).toMatch(/Subtotal\s+Q 150\.00/);
  });
});
