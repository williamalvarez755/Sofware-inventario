/**
 * Prueba de carga del POS (Fase 6).
 *
 * Simula varias cajas vendiendo a la vez contra la API real y mide latencia.
 * Lo importante no es solo el rendimiento: al terminar verifica que **el
 * dinero y el stock cuadren** — correlativos únicos, sin discrepancias entre
 * kardex y existencias, y el efectivo de caja igual a la suma de las ventas.
 *
 * Uso:  npm run load-test -w apps/api  [ventas] [concurrencia]
 */
import 'dotenv/config';
import { v7 as uuidv7 } from 'uuid';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { prismaAdmin, withTenantTx } from '../src/lib/prisma.js';
import { applyCostedEntry } from '../src/modules/inventory/movements.service.js';
import { findStockDiscrepancies } from '../src/modules/inventory/consistency.js';

const TOTAL_SALES = Number(process.argv[2] ?? 300);
const CONCURRENCY = Number(process.argv[3] ?? 20);
const PRICE = 1000n; // Q10.00 por unidad

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

async function main() {
  const app = createApp();
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  // TENANT propio y desechable. No se reutiliza el tenant demo porque los
  // ledgers son inmutables por diseño (los triggers rechazan DELETE incluso al
  // superusuario), así que los datos de esta prueba no se pueden retirar: si
  // vivieran en el tenant demo, contaminarían para siempre sus tiendas y sus
  // reportes. Para vaciar todo: npm run db:reset && npm run db:seed.
  const stamp = Date.now();
  const unit = await prismaAdmin.unit.findFirstOrThrow({ where: { code: 'UNIDAD' } });
  const plan = await prismaAdmin.plan.findFirstOrThrow({ where: { code: 'multi' } });

  const tenant = await prismaAdmin.tenant.create({
    data: { id: uuidv7(), name: `Prueba de carga ${stamp}`, slug: `carga-${stamp}` },
  });
  await prismaAdmin.subscription.create({
    data: {
      id: uuidv7(),
      tenantId: tenant.id,
      planId: plan.id,
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 86_400_000),
      amount: 0n,
    },
  });
  const owner = await prismaAdmin.user.create({
    data: {
      id: uuidv7(),
      tenantId: tenant.id,
      username: `cajero-${stamp}`,
      email: `cajero-${stamp}@carga.local`,
      name: 'Cajero de carga',
      // Hash de la contraseña demo: la genera el seed, aquí se reutiliza para
      // no pagar el costo de Argon2 en cada corrida.
      passwordHash: (
        await prismaAdmin.user.findUniqueOrThrow({ where: { email: 'owner1@demo.local' } })
      ).passwordHash,
      mustChangePassword: false,
    },
  });
  const store = await prismaAdmin.store.create({
    data: { id: uuidv7(), tenantId: tenant.id, name: 'Tienda de carga' },
  });
  await prismaAdmin.storeMember.create({
    data: { id: uuidv7(), tenantId: tenant.id, storeId: store.id, userId: owner.id, role: 'OWNER' },
  });
  const register = await prismaAdmin.cashRegister.create({
    data: { id: uuidv7(), tenantId: tenant.id, storeId: store.id, name: 'Caja carga' },
  });

  const product = await prismaAdmin.product.create({
    data: {
      id: uuidv7(),
      tenantId: tenant.id,
      sku: `LOAD-${Date.now()}`,
      name: 'Producto de carga',
      unitId: unit.id,
      basePrice: PRICE,
    },
  });
  await withTenantTx(tenant.id, (tx) =>
    applyCostedEntry(tx, tenant.id, {
      storeId: store.id,
      productId: product.id,
      type: 'INITIAL',
      qty: TOTAL_SALES + 100,
      unitCost: 600n,
      userId: owner.id,
    }),
  );

  /** Falla ruidosamente: un error de preparación no debe leerse como "0 ventas/s". */
  async function step<T>(name: string, res: Response): Promise<T> {
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(`${name} falló (${res.status}): ${JSON.stringify(body)}`);
    }
    return body as T;
  }

  const login = await step<{ accessToken: string }>(
    'login',
    await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: owner.username,
        password: process.env.SEED_DEMO_PASSWORD ?? 'Demo!2026',
      }),
    }),
  );

  const session = await step<{ id: string }>(
    'apertura de caja',
    await fetch(`${base}/api/cash/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.accessToken}` },
      body: JSON.stringify({ cashRegisterId: register.id, openingAmount: 0 }),
    }),
  );

  console.log(`Vendiendo ${TOTAL_SALES} veces con ${CONCURRENCY} cajas simultáneas…`);

  const latencies: number[] = [];
  let failures = 0;
  let pending = TOTAL_SALES;
  const startedAt = Date.now();

  async function worker() {
    while (pending > 0) {
      pending--;
      const t0 = Date.now();
      try {
        const res = await fetch(`${base}/api/sales`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${login.accessToken}`,
          },
          body: JSON.stringify({
            storeId: store.id,
            cashSessionId: session.id,
            clientOpId: randomUUID(),
            items: [{ productId: product.id, qty: 1 }],
            discount: 0,
            payments: [{ method: 'CASH', amount: Number(PRICE) }],
          }),
        });
        if (res.status !== 201) failures++;
        await res.arrayBuffer();
      } catch {
        failures++;
      }
      latencies.push(Date.now() - t0);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const elapsed = (Date.now() - startedAt) / 1000;
  latencies.sort((a, b) => a - b);

  // ── Verificación de integridad: el dinero y el stock deben cuadrar ──
  const sales = await prismaAdmin.sale.findMany({
    where: { storeId: store.id, status: 'COMPLETED' },
    select: { number: true, total: true },
  });
  const numbers = new Set(sales.map((s) => s.number.toString()));
  const salesTotal = sales.reduce((acc, s) => acc + s.total, 0n);
  const [cash] = await prismaAdmin.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM cash_movements
    WHERE cash_session_id = ${session.id}::uuid`;
  const stock = await prismaAdmin.storeProduct.findFirstOrThrow({
    where: { storeId: store.id, productId: product.id },
  });
  const discrepancies = (await findStockDiscrepancies()).filter(
    (d) => d.productId === product.id,
  );

  console.log('\n── Rendimiento ──');
  console.log(`  ventas OK          ${sales.length} / ${TOTAL_SALES} (fallos: ${failures})`);
  console.log(`  duración           ${elapsed.toFixed(1)} s`);
  console.log(`  throughput         ${(sales.length / elapsed).toFixed(1)} ventas/s`);
  console.log(`  latencia p50/p95/p99  ${percentile(latencies, 50)} / ${percentile(latencies, 95)} / ${percentile(latencies, 99)} ms`);

  console.log('\n── Integridad ──');
  const okNumbers = numbers.size === sales.length;
  const okCash = cash!.total === salesTotal;
  const okStock = Number(stock.stockQty) === TOTAL_SALES + 100 - sales.length;
  const okLedger = discrepancies.length === 0;
  console.log(`  correlativos únicos     ${okNumbers ? '✔' : '✖'} (${numbers.size} distintos)`);
  console.log(`  efectivo = ventas       ${okCash ? '✔' : '✖'} (caja ${cash!.total} vs ventas ${salesTotal})`);
  console.log(`  stock exacto            ${okStock ? '✔' : '✖'} (${stock.stockQty})`);
  console.log(`  kardex sin discrepancia ${okLedger ? '✔' : '✖'}`);

  server.close();
  console.log(`\n(datos en el tenant desechable "${tenant.slug}"; para vaciar: npm run db:reset)`);
  await prismaAdmin.$disconnect();
  const allOk = okNumbers && okCash && okStock && okLedger && failures === 0;
  console.log(allOk ? '✔ Prueba de carga superada' : '✖ Prueba de carga con problemas');
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
