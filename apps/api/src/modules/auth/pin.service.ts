/**
 * Autorización por PIN de supervisor (CLAUDE.md A6):
 * un trabajador registra la operación sensible (retiro, anulación) pero un
 * admin con el permiso correspondiente la autoriza tecleando su PIN.
 * Corre dentro de la transacción de la operación (RLS: solo ve su tenant).
 */
import argon2 from 'argon2';
import type { Prisma } from '@prisma/client';
import { roleHasPermission, type PermissionCode, type Role } from '@minimarket/shared';
import { forbidden } from '../../lib/errors.js';

export async function verifyAuthorizer(
  tx: Prisma.TransactionClient,
  input: {
    email?: string;
    pin?: string;
    storeId: string;
    permission: PermissionCode;
  },
): Promise<string> {
  const fail = () =>
    forbidden('AUTHORIZER_INVALID', 'Autorización denegada: verifique correo y PIN del supervisor');

  if (!input.email || !input.pin) {
    throw forbidden(
      'AUTHORIZATION_REQUIRED',
      'Esta operación requiere la autorización de un supervisor (correo + PIN)',
    );
  }
  const authorizer = await tx.user.findFirst({
    where: { email: input.email, isActive: true },
    include: { memberships: { where: { isActive: true } } },
  });
  if (!authorizer?.supervisorPinHash) throw fail();
  if (!(await argon2.verify(authorizer.supervisorPinHash, input.pin))) throw fail();

  const isOwner = authorizer.memberships.some((m) => m.role === 'OWNER');
  const allowed = authorizer.memberships.some(
    (m) =>
      (isOwner || m.storeId === input.storeId) &&
      roleHasPermission(m.role as Role, input.permission),
  );
  if (!allowed) throw fail();
  return authorizer.id;
}
