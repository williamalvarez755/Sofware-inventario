import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import type { Request } from 'express';
import { Prisma, type StoreProduct } from '@prisma/client';
import { toCentavos, type ProductCreateInput, type ProductUpdateInput } from '@minimarket/shared';
import { AppError, notFound } from '../../lib/errors.js';
import { withTenantTx, type TenantClient } from '../../lib/prisma.js';
import { audit } from '../audit/audit.service.js';
import { applyCostedEntry } from '../inventory/movements.service.js';

const PAGE_SIZE = 50;

function newSku(): string {
  return `P-${randomBytes(4).toString('hex').toUpperCase()}`;
}

async function resolveCategory(
  tx: Prisma.TransactionClient,
  tenantId: string,
  categoryId?: string,
  categoryName?: string,
): Promise<string | null> {
  if (categoryId) return categoryId;
  if (!categoryName) return null;
  const existing = await tx.category.findFirst({
    where: { name: { equals: categoryName, mode: 'insensitive' }, deletedAt: null },
  });
  if (existing) return existing.id;
  const created = await tx.category.create({
    data: { id: uuidv7(), tenantId, name: categoryName },
  });
  return created.id;
}

/**
 * Forma mínima que necesita `toProductRow`. Se declara estructuralmente en vez
 * de derivarla de Prisma porque el `include` de la tienda es condicional: el
 * tipo generado sería una unión incómoda de leer sin ganar nada.
 */
interface ProductRowSource {
  id: string;
  sku: string;
  name: string;
  basePrice: bigint;
  isActive: boolean;
  category: { id: string; name: string } | null;
  unit: { id: string; code: string; allowsDecimals: boolean };
  barcodes: { id: string; barcode: string }[];
  storeProducts?: StoreProduct[];
}

/** Producto tal como lo consume el POS y el catálogo: precio ya resuelto
 *  (override de tienda si existe) y costos solo para quien puede verlos (A10). */
function toProductRow(p: ProductRowSource, includeCosts: boolean) {
  const sp = p.storeProducts?.[0];
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    unit: p.unit,
    barcodes: p.barcodes,
    price: sp?.priceOverride ?? p.basePrice,
    basePrice: p.basePrice,
    isActive: p.isActive,
    ...(sp
      ? {
          stockQty: sp.stockQty,
          minStock: sp.minStock,
          lowStock: Number(sp.minStock) > 0 && Number(sp.stockQty) <= Number(sp.minStock),
          ...(includeCosts ? { avgCost: sp.avgCost } : {}),
        }
      : {}),
  };
}

const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true } },
  unit: { select: { id: true, code: true, allowsDecimals: true } },
  barcodes: { select: { id: true, barcode: true } },
} as const;

export async function listProducts(
  db: TenantClient,
  opts: { search?: string; categoryId?: string; storeId?: string; page: number },
  includeCosts: boolean,
) {
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
    ...(opts.search
      ? {
          OR: [
            { name: { contains: opts.search, mode: 'insensitive' } },
            { sku: { equals: opts.search, mode: 'insensitive' } },
            { barcodes: { some: { barcode: opts.search } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (opts.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        ...PRODUCT_INCLUDE,
        ...(opts.storeId
          ? { storeProducts: { where: { storeId: opts.storeId } } }
          : {}),
      },
    }),
    db.product.count({ where }),
  ]);
  return {
    total,
    page: opts.page,
    pageSize: PAGE_SIZE,
    rows: rows.map((p) => toProductRow(p, includeCosts)),
  };
}

/**
 * Búsqueda EXACTA por código de barras. El alta por escaneo necesita una
 * respuesta binaria —existe o no existe— y `listProducts` no sirve: su búsqueda
 * hace `contains` sobre el nombre, así que un código que coincide parcialmente
 * con otro texto devolvería falsos positivos y el tendero terminaría con dos
 * fichas del mismo producto.
 */
export async function findByBarcode(
  db: TenantClient,
  barcode: string,
  storeId: string | undefined,
  includeCosts: boolean,
) {
  const product = await db.product.findFirst({
    where: { deletedAt: null, barcodes: { some: { barcode } } },
    include: {
      ...PRODUCT_INCLUDE,
      ...(storeId ? { storeProducts: { where: { storeId } } } : {}),
    },
  });
  return product ? toProductRow(product, includeCosts) : null;
}

/**
 * Un código de barras identifica UNA presentación: si ya está tomado, decir
 * "el registro ya existe" no le sirve al tendero. Necesita saber a qué producto
 * pertenece para decidir si lo que tiene en la mano ya estaba registrado.
 */
export async function assertBarcodeFree(tx: Prisma.TransactionClient, barcode: string) {
  const taken = await tx.productBarcode.findFirst({
    where: { barcode },
    include: { product: { select: { name: true, sku: true } } },
  });
  if (taken) {
    throw new AppError(
      409,
      'BARCODE_TAKEN',
      `El código ${barcode} ya pertenece a "${taken.product.name}" (${taken.product.sku})`,
    );
  }
}

export async function getProduct(db: TenantClient, id: string, includeCosts: boolean) {
  const p = await db.product.findFirst({
    where: { id, deletedAt: null },
    include: {
      category: { select: { id: true, name: true } },
      unit: true,
      barcodes: { select: { id: true, barcode: true } },
      storeProducts: true,
    },
  });
  if (!p) throw notFound('Producto no encontrado');
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    category: p.category,
    unit: p.unit,
    barcodes: p.barcodes,
    basePrice: p.basePrice,
    isActive: p.isActive,
    stores: p.storeProducts.map((sp) => ({
      storeId: sp.storeId,
      stockQty: sp.stockQty,
      minStock: sp.minStock,
      priceOverride: sp.priceOverride,
      isActive: sp.isActive,
      ...(includeCosts ? { avgCost: sp.avgCost } : {}),
    })),
  };
}

export async function createProduct(
  tenantId: string,
  userId: string,
  input: ProductCreateInput,
  req: Request,
) {
  return withTenantTx(tenantId, async (tx) => {
    if (input.barcode) await assertBarcodeFree(tx, input.barcode);
    const categoryId = await resolveCategory(tx, tenantId, input.categoryId, input.categoryName);
    const product = await tx.product.create({
      data: {
        id: uuidv7(),
        tenantId,
        sku: input.sku?.length ? input.sku : newSku(),
        name: input.name,
        description: input.description ?? null,
        categoryId,
        unitId: input.unitId,
        basePrice: BigInt(input.price),
      },
    });
    if (input.barcode) {
      await tx.productBarcode.create({
        data: { id: uuidv7(), tenantId, productId: product.id, barcode: input.barcode },
      });
    }
    if (input.initial) {
      await applyCostedEntry(tx, tenantId, {
        storeId: input.initial.storeId,
        productId: product.id,
        type: 'INITIAL',
        qty: input.initial.qty,
        unitCost: BigInt(input.initial.unitCost),
        userId,
        note: 'Carga inicial',
      });
    }
    await audit(tx, {
      tenantId,
      userId,
      action: 'product.create',
      entityType: 'product',
      entityId: product.id,
      after: { name: product.name, sku: product.sku, price: input.price },
    }, req);
    return product;
  });
}

export async function updateProduct(
  tenantId: string,
  userId: string,
  productId: string,
  input: ProductUpdateInput,
  req: Request,
) {
  return withTenantTx(tenantId, async (tx) => {
    const before = await tx.product.findFirst({ where: { id: productId, deletedAt: null } });
    if (!before) throw notFound('Producto no encontrado');

    const product = await tx.product.update({
      where: { id: productId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.price !== undefined ? { basePrice: BigInt(input.price) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    // Cambio de precio: acción auditable específica (CLAUDE.md §3.1)
    if (input.price !== undefined && BigInt(input.price) !== before.basePrice) {
      await audit(tx, {
        tenantId,
        userId,
        action: 'product.price_change',
        entityType: 'product',
        entityId: productId,
        before: { price: before.basePrice.toString() },
        after: { price: String(input.price) },
      }, req);
    } else {
      await audit(tx, {
        tenantId,
        userId,
        action: 'product.update',
        entityType: 'product',
        entityId: productId,
      }, req);
    }
    return product;
  });
}

// ─────────────────────────── Importación CSV ───────────────────────────
// Formato: nombre,sku,codigo_barras,categoria,unidad,precio,costo,stock_inicial
// precio/costo en Quetzales (ej. 12.50); unidad = código (UNIDAD, LIBRA...).

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

export interface ImportResult {
  created: number;
  updated: number;
  errors: { line: number; message: string }[];
}

export async function importProductsCsv(
  tenantId: string,
  userId: string,
  storeId: string,
  csvText: string,
  req: Request,
): Promise<ImportResult> {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new AppError(400, 'VALIDATION', 'El CSV está vacío (se requiere encabezado + filas)');
  }
  const result: ImportResult = { created: 0, updated: 0, errors: [] };
  const dataLines = lines.slice(1); // encabezado fuera

  const CHUNK = 50;
  for (let start = 0; start < dataLines.length; start += CHUNK) {
    const chunk = dataLines.slice(start, start + CHUNK);
    await withTenantTx(tenantId, async (tx) => {
      const units = await tx.unit.findMany();
      const unitByCode = new Map(units.map((u) => [u.code.toUpperCase(), u]));

      for (let i = 0; i < chunk.length; i++) {
        const lineNumber = start + i + 2; // 1-based + encabezado
        const [nombre, sku, barcode, categoria, unidad, precio, costo, stockInicial] =
          parseCsvLine(chunk[i]!);
        // Savepoint por fila: un error (p. ej. barcode duplicado) revierte SOLO
        // esa fila; sin esto, Postgres aborta la transacción del chunk entero.
        await tx.$executeRaw`SAVEPOINT import_row`;
        try {
          if (!nombre || nombre.length < 2) throw new Error('nombre requerido');
          const unit = unitByCode.get((unidad || 'UNIDAD').toUpperCase());
          if (!unit) throw new Error(`unidad desconocida: ${unidad}`);
          const price = BigInt(toCentavos(precio || '0'));
          const cost = BigInt(toCentavos(costo || '0'));
          const stock = Number(stockInicial || '0');
          if (!Number.isFinite(stock) || stock < 0) throw new Error('stock_inicial inválido');
          if (!unit.allowsDecimals && !Number.isInteger(stock)) {
            throw new Error('la unidad no admite decimales en stock_inicial');
          }

          const categoryId = categoria
            ? await resolveCategory(tx, tenantId, undefined, categoria)
            : null;

          const existing = sku
            ? await tx.product.findFirst({ where: { sku, deletedAt: null } })
            : null;

          if (existing) {
            await tx.product.update({
              where: { id: existing.id },
              data: { name: nombre, basePrice: price, categoryId, unitId: unit.id },
            });
            result.updated++; // sin movimiento de stock: evita doble conteo
          } else {
            const product = await tx.product.create({
              data: {
                id: uuidv7(),
                tenantId,
                sku: sku || newSku(),
                name: nombre,
                categoryId,
                unitId: unit.id,
                basePrice: price,
              },
            });
            if (barcode) {
              await tx.productBarcode.create({
                data: { id: uuidv7(), tenantId, productId: product.id, barcode },
              });
            }
            if (stock > 0) {
              await applyCostedEntry(tx, tenantId, {
                storeId,
                productId: product.id,
                type: 'INITIAL',
                qty: stock,
                unitCost: cost,
                userId,
                note: 'Importación CSV',
              });
            }
            result.created++;
          }
        } catch (e) {
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT import_row`;
          result.errors.push({
            line: lineNumber,
            message: e instanceof Error ? e.message.split('\n')[0]!.slice(0, 200) : 'error desconocido',
          });
        }
      }
    });
  }

  await withTenantTx(tenantId, (tx) =>
    audit(tx, {
      tenantId,
      userId,
      storeId,
      action: 'product.import_csv',
      after: { created: result.created, updated: result.updated, errors: result.errors.length },
    }, req),
  );
  return result;
}
