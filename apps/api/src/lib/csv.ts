/**
 * Serialización CSV para exportaciones de reportes.
 * BOM UTF-8 al inicio: sin él, Excel en Windows destroza las tildes y la Ñ
 * (los usuarios abren estos archivos en Excel, no en un editor de texto).
 */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(
  columns: { key: string; label: string }[],
  rows: Record<string, unknown>[],
): string {
  const header = columns.map((c) => escapeCell(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escapeCell(row[c.key])).join(','));
  return `﻿${[header, ...body].join('\r\n')}\r\n`;
}

/** Centavos (BigInt/string) → "1234.56" para que Excel lo lea como número. */
export function csvMoney(centavos: bigint | number | string | null | undefined): string {
  if (centavos === null || centavos === undefined) return '0.00';
  const n = BigInt(centavos);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
