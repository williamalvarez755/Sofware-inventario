import { randomInt } from 'node:crypto';
import argon2 from 'argon2';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { ROLE_PERMISSIONS, type Role } from '@minimarket/shared';
import { audit } from '../audit/audit.service.js';
import { AppError, forbidden, notFound } from '../../lib/errors.js';
import { prismaAdmin, withTenantTx } from '../../lib/prisma.js';
import { assertStoreAccess, type MembershipLike } from '../../lib/store-access.js';

/**
 * Usuarios de la tienda: crear cajeros y encargados, darles tiendas y rol.
 *
 * POR QUÉ ESTE MÓDULO EXISTE RECIÉN AHORA, Y POR QUÉ ES UN PROBLEMA DE
 * SEGURIDAD Y NO UNA FUNCIÓN QUE FALTABA.
 *
 * El catálogo RBAC, los roles por tienda, el PIN de supervisor y el
 * ocultamiento de costos al trabajador están construidos y probados desde la
 * Fase 0. Pero el permiso `users.manage` no lo consumía NINGÚN endpoint: el
 * único lugar donde nacía un usuario de tienda era el alta que hace el super
 * admin, y creaba exactamente uno, OWNER.
 *
 * Consecuencia real en una tienda: el dueño no podía crear un cajero, así que
 * le prestaba su propia cuenta. Quien quedaba en el mostrador tenía OWNER —
 * anular ventas, retirar efectivo, ver márgenes, cambiar precios— y, peor,
 * la bitácora atribuía todo al dueño. Un registro de auditoría que dice que
 * todo lo hizo el dueño no sirve para lo único que un registro sirve.
 *
 * Toda la maquinaria de permisos estaba lista; faltaba la puerta.
 */

export interface ActorContext {
  tenantId: string;
  userId: string;
  memberships: MembershipLike[];
}

export interface UsuarioInput {
  name: string;
  username: string;
  email?: string;
  phone?: string;
  role: Role;
  storeIds: string[];
  password?: string;
}

/**
 * Contraseña temporal legible por teléfono: sin caracteres ambiguos (l/1/O/0).
 * El dueño se la dicta al cajero en voz alta y este la cambia al entrar.
 * Misma forma que la del onboarding (D-029), por la misma razón.
 */
function contrasenaTemporal(): string {
  const letras = 'abcdefghijkmnpqrstuvwxyz';
  const digitos = '23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += letras[randomInt(letras.length)];
  out += '-';
  for (let i = 0; i < 4; i++) out += digitos[randomInt(digitos.length)];
  return out;
}

/** El rol más alto que tiene el actor, mirando todas sus membresías. */
/**
 * Correo cuando el cajero no tiene.
 *
 * `users.email` es obligatorio y UNICO GLOBAL (D-018), pero el ingreso es por
 * nombre de usuario (D-036) y un cajero de tienda de barrio muchas veces no
 * tiene correo. En vez de obligarlo a inventar uno —o a usar el del dueno,
 * que romperia la unicidad y la trazabilidad— se sintetiza uno interno con el
 * identificador del negocio. Nadie lo escribe ni le llega nada ahi.
 */
function correoInterno(username: string, slug: string): string {
  return `${username}@${slug}.local`;
}

function rolMasAlto(memberships: MembershipLike[]): Role | null {
  const orden: Role[] = ['OWNER', 'STORE_ADMIN', 'WORKER'];
  for (const rol of orden) {
    if (memberships.some((m) => m.role === rol)) return rol;
  }
  return null;
}

/**
 * NADIE PUEDE OTORGAR UN ROL QUE NO TIENE.
 *
 * Sin esta regla, un encargado con `users.manage` podría crearse a sí mismo
 * un segundo usuario OWNER y quedarse con el negocio — escalada de
 * privilegios de manual. Se compara por conjunto de permisos y no por nombre
 * de rol a propósito: si mañana se agregan roles personalizados, la regla
 * sigue valiendo sin tocarla.
 */
export function puedeOtorgarRol(memberships: MembershipLike[], destino: Role): boolean {
  const actor = rolMasAlto(memberships);
  if (!actor) return false;
  const permisosActor = new Set<string>(ROLE_PERMISSIONS[actor]);
  return ROLE_PERMISSIONS[destino].every((p) => permisosActor.has(p));
}

function assertPuedeOtorgar(ctx: ActorContext, destino: Role): void {
  if (!puedeOtorgarRol(ctx.memberships, destino)) {
    throw forbidden(
      'ROLE_ESCALATION_DENIED',
      'No puede otorgar un rol con más permisos que el suyo',
    );
  }
}

/** Las tiendas que se asignan tienen que ser tiendas a las que el actor accede. */
function assertTiendasPropias(ctx: ActorContext, storeIds: string[]): void {
  if (storeIds.length === 0) {
    throw new AppError(400, 'SIN_TIENDAS', 'Asigne al menos una tienda');
  }
  for (const storeId of storeIds) assertStoreAccess(ctx.memberships, storeId);
}

/**
 * Y además tienen que EXISTIR EN ESTE NEGOCIO.
 *
 * `canAccessStore` le da al OWNER todas las tiendas "de su tenant", pero
 * recibe solo un identificador: no puede saber de qué negocio es. Sin esta
 * comprobación se podía crear una membresía apuntando a la tienda de OTRO
 * cliente — la llave foránea la acepta porque esa tienda existe, y RLS la
 * acepta porque la fila nueva lleva el tenant correcto.
 *
 * El daño no es solo teórico: la membresía queda apuntando a una tienda que
 * RLS no deja ver, y el listado de usuarios revienta al intentar resolverla.
 * Lo encontró una prueba de aislamiento que esperaba un 403 y recibió un 201.
 *
 * La consulta corre DENTRO de `withTenantTx`, así que RLS ya solo devuelve
 * las tiendas de este negocio: comparar cantidades alcanza.
 */
async function assertTiendasDelNegocio(
  tx: Prisma.TransactionClient,
  storeIds: string[],
): Promise<void> {
  const unicas = [...new Set(storeIds)];
  const encontradas = await tx.store.count({ where: { id: { in: unicas } } });
  if (encontradas !== unicas.length) {
    throw forbidden('STORE_ACCESS_DENIED', 'Alguna tienda no pertenece a este negocio');
  }
}

/**
 * Cierra todas las sesiones abiertas de alguien.
 *
 * Va por `prismaAdmin` y FUERA de la transacción de tenant a propósito:
 * `refresh_tokens` tiene REVOCADO el acceso para el rol de ejecución desde la
 * migración de RLS, igual que el material de 2FA (D-033). Es una buena
 * propiedad —un fallo de la aplicación no puede manipular sesiones— y no se
 * va a debilitar para esta función; lo que se hace es usar el rol
 * administrativo solo para este paso, como ya hace el cambio de contraseña
 * (D-045).
 *
 * El orden importa: primero se desactiva o se cambia la clave dentro de la
 * transacción, y recién después se revocan los tokens. Si fallara este paso,
 * el acceso ya está cortado igual —el refresco comprueba `isActive`— y lo
 * único que queda pendiente es la limpieza.
 */
async function cerrarSesionesDe(userId: string): Promise<void> {
  await prismaAdmin.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function listarUsuarios(tenantId: string) {
  return withTenantTx(tenantId, async (tx) => {
    const usuarios = await tx.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        phone: true,
        isActive: true,
        mustChangePassword: true,
        lastLoginAt: true,
        memberships: {
          where: { isActive: true, store: { is: {} } },
          select: { storeId: true, role: true, store: { select: { name: true } } },
        },
      },
    });
    return usuarios.map(({ memberships, ...u }) => ({
      ...u,
      stores: memberships.map((m) => ({
        storeId: m.storeId,
        storeName: m.store.name,
        role: m.role,
      })),
    }));
  });
}

export async function crearUsuario(ctx: ActorContext, input: UsuarioInput, req?: Request) {
  assertPuedeOtorgar(ctx, input.role);
  assertTiendasPropias(ctx, input.storeIds);

  const password = input.password ?? contrasenaTemporal();
  const passwordHash = await argon2.hash(password);
  const userId = uuidv7();

  await withTenantTx(ctx.tenantId, async (tx) => {
    await assertTiendasDelNegocio(tx, input.storeIds);

    const repetido = await tx.user.findFirst({
      where: { username: input.username },
      select: { id: true },
    });
    if (repetido) {
      throw new AppError(409, 'USERNAME_TAKEN', `El usuario "${input.username}" ya existe`);
    }

    const negocio = await tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: { slug: true },
    });

    await tx.user.create({
      data: {
        id: userId,
        tenantId: ctx.tenantId,
        username: input.username,
        email: input.email ?? correoInterno(input.username, negocio.slug),
        name: input.name,
        phone: input.phone ?? null,
        passwordHash,
        // Siempre temporal, incluso si la eligió el dueño: la conocen dos
        // personas hasta que el cajero la cambia (mismo criterio que D-045).
        mustChangePassword: true,
      },
    });
    for (const storeId of input.storeIds) {
      await tx.storeMember.create({
        data: { id: uuidv7(), tenantId: ctx.tenantId, storeId, userId, role: input.role },
      });
    }
    await audit(
      tx,
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'user.create',
        entityType: 'user',
        entityId: userId,
        after: { username: input.username, role: input.role, storeIds: input.storeIds },
      },
      req,
    );
  });

  // La contraseña se devuelve UNA sola vez y no se guarda en claro en ningún
  // lado: el dueño se la dicta al cajero en ese momento.
  return { id: userId, username: input.username, password };
}

export async function actualizarUsuario(
  ctx: ActorContext,
  userId: string,
  cambios: { name?: string; email?: string | null; phone?: string | null; isActive?: boolean },
  req?: Request,
) {
  if (cambios.isActive === false && userId === ctx.userId) {
    // Desactivarse a uno mismo deja el negocio sin quien administre si era el
    // único dueño, y de inmediato sin sesión.
    throw new AppError(400, 'NO_AUTO_DESACTIVAR', 'No puede desactivar su propia cuenta');
  }

  const resultado = await withTenantTx(ctx.tenantId, async (tx) => {
    const antes = await tx.user.findFirst({ where: { id: userId } });
    if (!antes) throw notFound('Usuario no encontrado');

    if (cambios.isActive === false) {
      await assertNoEsElUltimoDueno(tx, userId);
    }

    const despues = await tx.user.update({
      where: { id: userId },
      data: {
        ...(cambios.name !== undefined ? { name: cambios.name } : {}),
        // El correo no se puede vaciar: la columna es obligatoria y unica.
        ...(cambios.email ? { email: cambios.email } : {}),
        ...(cambios.phone !== undefined ? { phone: cambios.phone } : {}),
        ...(cambios.isActive !== undefined ? { isActive: cambios.isActive } : {}),
      },
    });

    await audit(
      tx,
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: cambios.isActive === false ? 'user.deactivate' : 'user.update',
        entityType: 'user',
        entityId: userId,
        before: { name: antes.name, isActive: antes.isActive },
        after: { name: despues.name, isActive: despues.isActive },
      },
      req,
    );
    return { id: despues.id, isActive: despues.isActive };
  });

  // Desactivar a alguien tiene que sacarlo de TODOS sus dispositivos en el
  // acto: si se va un empleado, no basta con que no pueda volver a entrar.
  if (cambios.isActive === false) await cerrarSesionesDe(userId);
  return resultado;
}

export async function asignarTiendas(
  ctx: ActorContext,
  userId: string,
  asignaciones: { storeId: string; role: Role }[],
  req?: Request,
) {
  for (const a of asignaciones) assertPuedeOtorgar(ctx, a.role);
  assertTiendasPropias(
    ctx,
    asignaciones.map((a) => a.storeId),
  );

  return withTenantTx(ctx.tenantId, async (tx) => {
    const usuario = await tx.user.findFirst({ where: { id: userId } });
    if (!usuario) throw notFound('Usuario no encontrado');
    await assertTiendasDelNegocio(
      tx,
      asignaciones.map((a) => a.storeId),
    );

    const quedaDueno = asignaciones.some((a) => a.role === 'OWNER');
    if (!quedaDueno) await assertNoEsElUltimoDueno(tx, userId);

    // Se desactivan las membresías viejas en vez de borrarlas: la bitácora
    // de una venta apunta a la tienda, y queremos poder reconstruir quién
    // tenía acceso a qué en el pasado.
    await tx.storeMember.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });
    for (const a of asignaciones) {
      await tx.storeMember.create({
        data: {
          id: uuidv7(),
          tenantId: ctx.tenantId,
          storeId: a.storeId,
          userId,
          role: a.role,
        },
      });
    }
    await audit(
      tx,
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'user.stores',
        entityType: 'user',
        entityId: userId,
        after: { asignaciones },
      },
      req,
    );
    return { id: userId, stores: asignaciones };
  });
}

export async function reiniciarContrasena(ctx: ActorContext, userId: string, req?: Request) {
  const password = contrasenaTemporal();
  const passwordHash = await argon2.hash(password);

  await withTenantTx(ctx.tenantId, async (tx) => {
    const usuario = await tx.user.findFirst({ where: { id: userId } });
    if (!usuario) throw notFound('Usuario no encontrado');

    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true },
    });
    await audit(
      tx,
      {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'user.password_reset',
        entityType: 'user',
        entityId: userId,
      },
      req,
    );
  });

  // Si le reinician la clave es porque se perdió el control de la cuenta:
  // las sesiones abiertas se cierran.
  await cerrarSesionesDe(userId);

  return { id: userId, password };
}

/**
 * Un negocio sin ningún dueño activo queda sin quien administre y sin quien
 * pueda devolverle el acceso a nadie: solo lo podría rescatar el super admin.
 */
async function assertNoEsElUltimoDueno(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const otrosDuenos = await tx.storeMember.count({
    where: { role: 'OWNER', isActive: true, userId: { not: userId }, user: { isActive: true } },
  });
  if (otrosDuenos === 0) {
    throw new AppError(
      400,
      'ULTIMO_DUENO',
      'Es el único dueño del negocio: nombre a otro dueño antes de quitarle el acceso',
    );
  }
}
