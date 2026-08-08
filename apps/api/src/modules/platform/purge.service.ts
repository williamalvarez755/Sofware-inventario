/**
 * Eliminación definitiva de un cliente que se dio de baja.
 *
 * Esto NO es la operación normal cuando alguien deja de pagar: para eso está
 * dar de baja (`CANCELLED`), que bloquea el acceso al instante, conserva el
 * historial y permite que el cliente vuelva. Esta función es el paso siguiente
 * e irreversible: retira los datos de la base para siempre.
 *
 * Tres condiciones antes de tocar nada:
 *  1. El cliente ya tiene que estar dado de baja. No se borra a alguien que
 *     está operando su tienda.
 *  2. Quien la ejecuta escribe el identificador del cliente. Un botón de
 *     "seguro?" se acepta sin leer; escribir "dona-mari" no.
 *  3. Queda registrada en la bitácora de plataforma ANTES de borrar, con el
 *     recuento de lo que se llevó por delante.
 */
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { AppError, notFound } from '../../lib/errors.js';
import { prismaAdmin } from '../../lib/prisma.js';
import { invalidateTenantCache } from '../../middleware/auth.js';
import { audit } from '../audit/audit.service.js';

/**
 * Orden de borrado: de las hojas hacia la raíz. Las llaves foráneas están en
 * RESTRICT a propósito (D-007), así que un orden equivocado no corrompe nada
 * —falla y revierte—, pero sí haría fallar la purga.
 */
const TABLAS_EN_ORDEN = [
  'notifications',
  'stock_alerts',
  'daily_store_stats',
  'sale_payments',
  'sale_items',
  'sales',
  'purchase_items',
  'purchases',
  'expenses',
  'expense_categories',
  'cash_movements',
  'cash_sessions',
  'cash_registers',
  'counters',
  'inventory_movements',
  'store_products',
  'product_suppliers',
  'product_barcodes',
  'products',
  'categories',
  // Las unidades globales del sistema tienen tenant_id NULL, así que este
  // borrado solo alcanza a las que el cliente creó para sí mismo.
  'units',
  'suppliers',
  'store_members',
  'stores',
  'refresh_tokens',
  'recovery_codes',
  'user_totp',
  'users',
  'subscriptions',
  'audit_logs',
] as const;

/** Se exporta para que una prueba verifique que no falta ninguna tabla: si
 *  mañana se agrega una con tenant_id y nadie la suma acá, la purga fallaría
 *  al final por llave foránea. Mejor que lo diga una prueba y no un cliente. */
export const TABLAS_PURGA: readonly string[] = TABLAS_EN_ORDEN;

export interface PurgeResult {
  tenant: { id: string; name: string; slug: string };
  filasBorradas: Record<string, number>;
  total: number;
}

export async function purgeTenant(
  tenantId: string,
  confirmacion: string,
  platformUserId: string,
  req: Request,
): Promise<PurgeResult> {
  const tenant = await prismaAdmin.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw notFound('Cliente no encontrado');

  if (tenant.status !== 'CANCELLED') {
    throw new AppError(
      409,
      'TENANT_NOT_CANCELLED',
      'Primero dé de baja al cliente. Solo se elimina definitivamente a quien ya está dado de baja.',
    );
  }
  if (confirmacion.trim() !== tenant.slug) {
    throw new AppError(
      400,
      'CONFIRMATION_MISMATCH',
      `Para confirmar, escriba el identificador del cliente: ${tenant.slug}`,
    );
  }

  const filasBorradas: Record<string, number> = {};

  await prismaAdmin.$transaction(
    async (tx) => {
      // La bitácora se escribe ANTES: es la única huella que va a quedar de
      // que este cliente existió, y se guarda sin tenant_id para que no se
      // borre a sí misma en el barrido de audit_logs.
      await audit(tx, {
        platformUserId,
        action: 'platform.tenant_purged',
        entityType: 'tenant',
        entityId: tenantId,
        before: {
          name: tenant.name,
          slug: tenant.slug,
          createdAt: tenant.createdAt.toISOString(),
        },
      }, req);

      // Abre la puerta de los disparadores de inmutabilidad SOLO en esta
      // transacción y solo para el rol administrativo (ver la migración).
      await tx.$executeRawUnsafe(`SET LOCAL app.purge_tenant = 'on'`);

      for (const tabla of TABLAS_EN_ORDEN) {
        const borradas = await tx.$executeRaw`
          DELETE FROM ${Prisma.raw(`"${tabla}"`)} WHERE tenant_id = ${tenantId}::uuid`;
        if (borradas > 0) filasBorradas[tabla] = borradas;
      }

      await tx.$executeRaw`DELETE FROM tenants WHERE id = ${tenantId}::uuid`;
    },
    { timeout: 120_000 },
  );

  invalidateTenantCache(tenantId);

  return {
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    filasBorradas,
    total: Object.values(filasBorradas).reduce((a, b) => a + b, 0),
  };
}
