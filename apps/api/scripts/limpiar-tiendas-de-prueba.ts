/**
 * Retira del selector las tiendas que dejaron las pruebas.
 *
 * EL PROBLEMA. `reports.test.ts` y `fase7-correcciones.test.ts` necesitan una
 * tienda virgen en cada corrida: calculan totales a mano y cualquier venta
 * previa rompería la aritmética. Eso está bien. Lo que nadie consideró es que
 * los ledgers son inmutables por diseño (D-007), así que esas tiendas **no se
 * pueden borrar nunca**: cada `npm test` dejaba cuatro más, para siempre, en
 * la lista que el cajero ve al abrir turno. En esta base llegaron a 122 contra
 * 1 real.
 *
 * LA CAUSA YA ESTÁ ARREGLADA: ahora los fixtures nacen con `isActive: false` y
 * el listado de tiendas filtra las inactivas. Este script existe para las que
 * quedaron de antes.
 *
 * POR QUÉ DESACTIVA Y NO BORRA. Porque borrar exigiría abrir la puerta de
 * inmutabilidad (D-046) sobre un cliente que NO se está dando de baja, para
 * destruir 757 ventas y 4.372 movimientos de kardex. Desactivar consigue
 * exactamente lo que se pide —que desaparezcan del selector— sin tocar un solo
 * asiento, y es reversible con un UPDATE. Lo irreversible se reserva para
 * cuando alguien lo pida con ese nombre.
 *
 *   npm run limpiar:tiendas          -w apps/api   → solo informa
 *   npm run limpiar:tiendas -- --si  -w apps/api   → aplica
 */

import { prismaAdmin } from '../src/lib/prisma.js';

/**
 * Los nombres que generan los fixtures, cada uno con su `Date.now()`.
 *
 * Deliberadamente estrecho: exige el sufijo de 10 o más dígitos, así que una
 * tienda real llamada "Reportes" o "Carga" no entra. El patrón es lo único que
 * separa la basura del inventario de alguien.
 */
const PATRON = '^(Reportes|Sucursal (propia|ajena)|Descuentos|Carga) [0-9]{10,}$';

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--si');

  if (process.env.NODE_ENV === 'production') {
    console.error('Este script no corre en producción. Es limpieza de una base de desarrollo.');
    process.exit(1);
  }

  const candidatas = await prismaAdmin.$queryRawUnsafe<
    { id: string; name: string; tenant: string; is_active: boolean }[]
  >(`
    select s.id, s.name, t.slug as tenant, s.is_active
    from stores s join tenants t on t.id = s.tenant_id
    where s.name ~ '${PATRON}'
    order by t.slug, s.name
  `);

  const activas = candidatas.filter((c) => c.is_active);

  // El contraste que importa: cuántas quedan visibles de verdad.
  const porCliente = await prismaAdmin.$queryRawUnsafe<
    { tenant: string; visibles: number; total: number }[]
  >(`
    select t.slug as tenant,
           count(*) filter (where s.is_active)::int as visibles,
           count(*)::int as total
    from stores s join tenants t on t.id = s.tenant_id
    group by t.slug having count(*) > 1 order by 2 desc
  `);

  console.log(`Tiendas que coinciden con el patrón de prueba: ${candidatas.length}`);
  console.log(`  de ellas, todavía activas (visibles en el selector): ${activas.length}`);
  console.log('\nClientes con más de una tienda, antes:');
  for (const c of porCliente) {
    console.log(`  ${c.tenant.padEnd(28)} ${c.visibles} visibles de ${c.total}`);
  }

  if (activas.length === 0) {
    console.log('\nNada que hacer: ninguna está activa.');
    return;
  }

  if (!aplicar) {
    console.log('\nMuestra de las que se desactivarían:');
    for (const c of activas.slice(0, 5)) console.log(`  [${c.tenant}] ${c.name}`);
    if (activas.length > 5) console.log(`  … y ${activas.length - 5} más`);
    console.log('\nNada se modificó. Para aplicarlo: npm run limpiar:tiendas -- --si -w apps/api');
    return;
  }

  const { count } = await prismaAdmin.store.updateMany({
    where: { id: { in: activas.map((a) => a.id) } },
    data: { isActive: false },
  });

  // Lo que el dueño verá en el selector después del cambio.
  const despues = await prismaAdmin.$queryRawUnsafe<{ tenant: string; visibles: number }[]>(`
    select t.slug as tenant, count(*)::int as visibles
    from stores s join tenants t on t.id = s.tenant_id
    where s.is_active group by t.slug having count(*) > 1 order by 2 desc
  `);

  console.log(`\nDesactivadas: ${count}. No se borró ningún dato.`);
  console.log('Clientes con más de una tienda visible, después:');
  if (despues.length === 0) console.log('  (ninguno)');
  for (const d of despues) console.log(`  ${d.tenant.padEnd(28)} ${d.visibles} visibles`);
}

await main();
await prismaAdmin.$disconnect();
