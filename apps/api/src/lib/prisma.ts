/**
 * Dos clientes Prisma — pilar del aislamiento multi-tenant (CLAUDE.md §2.2):
 *
 *  - prismaAdmin: URL de ADMIN. SOLO para: auth pre-login (buscar usuario por
 *    email, refresh tokens), módulo de plataforma (super admin) y seed/jobs.
 *    Cada uso nuevo debe justificarse en revisión.
 *
 *  - forTenant(tenantId): cliente RUNTIME (rol app_runtime, SIN BYPASSRLS).
 *    Cada operación corre en una transacción que primero fija
 *    app.tenant_id — las políticas RLS hacen el resto. Aunque un bug omita
 *    un filtro, la base no devuelve filas de otro tenant.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export const prismaAdmin = new PrismaClient({ datasourceUrl: env.DATABASE_URL });

/** Cliente runtime SIN contexto de tenant. SOLO para tests de RLS y health. */
export const prismaRuntime = new PrismaClient({ datasourceUrl: env.APP_DATABASE_URL });

function buildTenantClient(tenantId: string) {
  return prismaRuntime.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await prismaRuntime.$transaction([
            prismaRuntime.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof buildTenantClient>;

// Cache simple de clientes extendidos (la extensión es barata pero no gratis).
const clients = new Map<string, TenantClient>();
const MAX_CACHED = 500;

export function forTenant(tenantId: string): TenantClient {
  let client = clients.get(tenantId);
  if (!client) {
    if (clients.size >= MAX_CACHED) {
      const oldest = clients.keys().next().value;
      if (oldest) clients.delete(oldest);
    }
    client = buildTenantClient(tenantId);
    clients.set(tenantId, client);
  }
  return client;
}

/**
 * Transacción multi-paso con contexto de tenant (ventas, cierres de caja...).
 * set_config con is_local=TRUE muere con la transacción: sin fugas de contexto.
 */
export function withTenantTx<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prismaRuntime.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    return fn(tx);
  });
}
