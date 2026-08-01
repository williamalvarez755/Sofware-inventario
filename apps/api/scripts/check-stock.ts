import 'dotenv/config';
import { findStockDiscrepancies } from '../src/modules/inventory/consistency.js';
import { prismaAdmin } from '../src/lib/prisma.js';

const diffs = await findStockDiscrepancies();
if (diffs.length === 0) {
  console.log('✔ Stock consistente: el kardex y store_products coinciden.');
} else {
  console.error(`✖ ${diffs.length} discrepancia(s) kardex ↔ stock:`);
  for (const d of diffs) {
    console.error(
      `  producto "${d.productName}" (${d.productId}) tienda ${d.storeId}: ` +
        `materializado=${d.materialized} ledger=${d.ledger}`,
    );
  }
}
await prismaAdmin.$disconnect();
process.exit(diffs.length === 0 ? 0 : 1);
