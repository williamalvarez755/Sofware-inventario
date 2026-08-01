/**
 * Reconciliación kardex ↔ stock materializado (CLAUDE.md §7):
 * el ledger es la verdad; si store_products.stock_qty difiere de la suma de
 * movimientos, se REPORTA (nunca se corrige en silencio). Corre como script
 * (npm run check:stock) y en tests; en producción se agenda diario.
 */
import { prismaAdmin } from '../../lib/prisma.js';

export interface StockDiscrepancy {
  storeId: string;
  productId: string;
  productName: string;
  materialized: string;
  ledger: string;
}

export async function findStockDiscrepancies(): Promise<StockDiscrepancy[]> {
  const rows = await prismaAdmin.$queryRaw<
    { store_id: string; product_id: string; name: string; materialized: unknown; ledger: unknown }[]
  >`
    SELECT sp.store_id, sp.product_id, p.name,
           sp.stock_qty AS materialized,
           COALESCE(SUM(im.qty), 0) AS ledger
    FROM store_products sp
    JOIN products p ON p.id = sp.product_id
    LEFT JOIN inventory_movements im
      ON im.store_id = sp.store_id AND im.product_id = sp.product_id
    GROUP BY sp.store_id, sp.product_id, sp.stock_qty, p.name
    HAVING sp.stock_qty <> COALESCE(SUM(im.qty), 0)`;
  return rows.map((r) => ({
    storeId: r.store_id,
    productId: r.product_id,
    productName: r.name,
    materialized: String(r.materialized),
    ledger: String(r.ledger),
  }));
}
