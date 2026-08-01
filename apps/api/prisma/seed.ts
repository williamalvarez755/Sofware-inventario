/**
 * Seed idempotente (upserts): puede correrse N veces sin duplicar.
 * Crea: catálogo RBAC, planes, super admin y 2 tenants demo con tienda,
 * owner y trabajador — los dos tenants alimentan los tests de aislamiento.
 */
import 'dotenv/config';
import argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';
import { PrismaClient } from '@prisma/client';
import {
  PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  ROLES,
  ROLE_PERMISSIONS,
  type PermissionCode,
} from '@minimarket/shared';

const prisma = new PrismaClient(); // DATABASE_URL (admin)

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo!2026';
const SUPER_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@minimarket.local';
const SUPER_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? 'SuperAdmin!2026';

async function seedRbac() {
  for (const code of Object.values(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { code },
      update: { description: PERMISSION_DESCRIPTIONS[code as PermissionCode] },
      create: { code, description: PERMISSION_DESCRIPTIONS[code as PermissionCode] },
    });
  }
  const all = await prisma.permission.findMany();
  const byCode = new Map(all.map((p) => [p.code, p.id]));
  for (const role of ROLES) {
    for (const code of ROLE_PERMISSIONS[role]) {
      const permissionId = byCode.get(code)!;
      await prisma.rolePermission.upsert({
        where: { role_permissionId: { role, permissionId } },
        update: {},
        create: { role, permissionId },
      });
    }
  }
}

/** Unidades de medida globales (tenant_id NULL) usuales en Guatemala. */
async function seedUnits() {
  const units = [
    { code: 'UNIDAD', name: 'Unidad', allowsDecimals: false },
    { code: 'DOCENA', name: 'Docena', allowsDecimals: false },
    { code: 'PAQUETE', name: 'Paquete', allowsDecimals: false },
    { code: 'LIBRA', name: 'Libra', allowsDecimals: true },
    { code: 'ONZA', name: 'Onza', allowsDecimals: true },
    { code: 'QUINTAL', name: 'Quintal', allowsDecimals: true },
    { code: 'LITRO', name: 'Litro', allowsDecimals: true },
    { code: 'GALON', name: 'Galón', allowsDecimals: true },
  ];
  for (const u of units) {
    const existing = await prisma.unit.findFirst({ where: { tenantId: null, code: u.code } });
    if (!existing) await prisma.unit.create({ data: { id: uuidv7(), tenantId: null, ...u } });
  }
}

async function seedPlans() {
  const plans = [
    { code: 'basico', name: 'Plan Básico', maxStores: 1, maxUsers: 5, monthlyPrice: 25000n },
    { code: 'multi', name: 'Plan Multi-tienda', maxStores: 5, maxUsers: 25, monthlyPrice: 60000n },
  ];
  for (const p of plans) {
    await prisma.plan.upsert({
      where: { code: p.code },
      update: { name: p.name, maxStores: p.maxStores, maxUsers: p.maxUsers, monthlyPrice: p.monthlyPrice },
      create: { id: uuidv7(), ...p },
    });
  }
}

async function seedPlatformUser() {
  await prisma.platformUser.upsert({
    where: { email: SUPER_EMAIL },
    update: {},
    create: {
      id: uuidv7(),
      email: SUPER_EMAIL,
      name: 'Super Admin',
      passwordHash: await argon2.hash(SUPER_PASSWORD),
    },
  });
}

async function seedDemoTenant(opts: {
  slug: string;
  name: string;
  storeName: string;
  ownerEmail: string;
  workerEmail: string;
  planCode: string;
}) {
  const passwordHash = await argon2.hash(DEMO_PASSWORD);

  const tenant = await prisma.tenant.upsert({
    where: { slug: opts.slug },
    update: {},
    create: {
      id: uuidv7(),
      slug: opts.slug,
      name: opts.name,
      taxRegime: 'PEQUENO_CONTRIBUYENTE',
      contactEmail: opts.ownerEmail,
    },
  });

  const owner = await prisma.user.upsert({
    where: { email: opts.ownerEmail },
    update: {},
    create: {
      id: uuidv7(),
      tenantId: tenant.id,
      email: opts.ownerEmail,
      name: `Dueño ${opts.name}`,
      passwordHash,
      mustChangePassword: false,
    },
  });
  const worker = await prisma.user.upsert({
    where: { email: opts.workerEmail },
    update: {},
    create: {
      id: uuidv7(),
      tenantId: tenant.id,
      email: opts.workerEmail,
      name: `Trabajador ${opts.name}`,
      passwordHash,
      mustChangePassword: false,
    },
  });

  const store = await prisma.store.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: opts.storeName } },
    update: {},
    create: {
      id: uuidv7(),
      tenantId: tenant.id,
      name: opts.storeName,
      receiptFooter: '¡Gracias por su compra!',
    },
  });

  for (const [user, role] of [[owner, 'OWNER'], [worker, 'WORKER']] as const) {
    await prisma.storeMember.upsert({
      where: { storeId_userId: { storeId: store.id, userId: user.id } },
      update: {},
      create: { id: uuidv7(), tenantId: tenant.id, storeId: store.id, userId: user.id, role },
    });
  }

  const plan = await prisma.plan.findUniqueOrThrow({ where: { code: opts.planCode } });
  const existing = await prisma.subscription.findFirst({ where: { tenantId: tenant.id } });
  if (!existing) {
    const start = new Date();
    const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
    await prisma.subscription.create({
      data: {
        id: uuidv7(),
        tenantId: tenant.id,
        planId: plan.id,
        periodStart: start,
        periodEnd: end,
        amount: plan.monthlyPrice,
        paymentNote: 'Seed demo',
      },
    });
  }
  await seedDemoProducts(tenant.id, store.id, owner.id);
  return tenant;
}

/** Productos demo con stock inicial y kardex coherente (idempotente). */
async function seedDemoProducts(tenantId: string, storeId: string, userId: string) {
  const anyProduct = await prisma.product.findFirst({ where: { tenantId } });
  if (anyProduct) return;

  const unidad = await prisma.unit.findFirstOrThrow({ where: { tenantId: null, code: 'UNIDAD' } });
  const libra = await prisma.unit.findFirstOrThrow({ where: { tenantId: null, code: 'LIBRA' } });
  const category = await prisma.category.create({
    data: { id: uuidv7(), tenantId, name: 'Abarrotes' },
  });

  const demos = [
    { name: 'Agua pura 500ml', sku: 'AGUA-500', barcode: '7401000000017', unitId: unidad.id, price: 500n, cost: 300n, stock: 48 },
    { name: 'Maseca 1lb', sku: 'MASECA-1', barcode: '7401000000024', unitId: unidad.id, price: 850n, cost: 620n, stock: 24 },
    { name: 'Azúcar a granel', sku: 'AZUCAR-G', barcode: null, unitId: libra.id, price: 450n, cost: 320n, stock: 80.5 },
  ];
  for (const d of demos) {
    const product = await prisma.product.create({
      data: {
        id: uuidv7(),
        tenantId,
        sku: d.sku,
        name: d.name,
        categoryId: category.id,
        unitId: d.unitId,
        basePrice: d.price,
      },
    });
    if (d.barcode) {
      await prisma.productBarcode.create({
        data: { id: uuidv7(), tenantId, productId: product.id, barcode: d.barcode },
      });
    }
    const qty = d.stock.toFixed(3);
    await prisma.storeProduct.create({
      data: {
        id: uuidv7(),
        tenantId,
        storeId,
        productId: product.id,
        stockQty: qty,
        avgCost: d.cost,
        minStock: 10,
      },
    });
    await prisma.inventoryMovement.create({
      data: {
        id: uuidv7(),
        tenantId,
        storeId,
        productId: product.id,
        type: 'INITIAL',
        qty,
        unitCost: d.cost,
        balanceAfter: qty,
        userId,
        note: 'Carga inicial (seed demo)',
      },
    });
  }
}

// En producción: SEED_DEMO_TENANTS=false para no crear los tenants demo.
const INCLUDE_DEMOS = process.env.SEED_DEMO_TENANTS !== 'false';

async function main() {
  await seedRbac();
  await seedUnits();
  await seedPlans();
  await seedPlatformUser();
  if (!INCLUDE_DEMOS) {
    console.log('Seed completado (sin tenants demo) ✔');
    return;
  }
  await seedDemoTenant({
    slug: 'tienda-uno',
    name: 'Tienda La Bendición',
    storeName: 'Central',
    ownerEmail: 'owner1@demo.local',
    workerEmail: 'worker1@demo.local',
    planCode: 'multi',
  });
  await seedDemoTenant({
    slug: 'tienda-dos',
    name: 'Abarrotería El Ahorro',
    storeName: 'Principal',
    ownerEmail: 'owner2@demo.local',
    workerEmail: 'worker2@demo.local',
    planCode: 'basico',
  });
  console.log('Seed completado ✔');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
