/**
 * Dinero: SIEMPRE enteros en centavos de Quetzal (GTQ). Ver CLAUDE.md A9.
 * BigInt en la base (Prisma BigInt); en cálculos de UI puede usarse number
 * mientras los montos quepan en Number.MAX_SAFE_INTEGER (Q 90 billones).
 */

export const CURRENCY_SYMBOL = 'Q';

/** 123456n | 123456 -> "Q 1,234.56" */
export function formatQ(centavos: bigint | number): string {
  const n = typeof centavos === 'bigint' ? centavos : BigInt(Math.round(centavos));
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const quetzales = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, '0');
  const withThousands = quetzales.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${CURRENCY_SYMBOL} ${withThousands}.${cents}`;
}

/** "1234.56" | 1234.56 -> 123456 (centavos). Lanza si no es un monto válido. */
export function toCentavos(value: string | number): number {
  const num = typeof value === 'string' ? Number(value.replace(/,/g, '')) : value;
  if (!Number.isFinite(num)) throw new Error(`Monto inválido: ${value}`);
  return Math.round(num * 100);
}
