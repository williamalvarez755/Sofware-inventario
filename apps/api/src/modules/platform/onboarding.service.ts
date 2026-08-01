/**
 * Onboarding de un cliente nuevo en UNA transacción (criterio Fase 5: alta en
 * menos de 5 minutos). Crea todo lo mínimo para que el tendero pueda vender el
 * mismo día: tenant + dueño + tienda + caja + suscripción + categorías de gasto.
 *
 * Usa prismaAdmin porque opera POR ENCIMA de los tenants (aún no existe el que
 * se está creando, así que no hay contexto RLS que fijar).
 */
import { randomInt } from 'node:crypto';
import argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';
import type { Request } from 'express';
import type { TenantOnboardInput } from '@minimarket/shared';
import { AppError, notFound } from '../../lib/errors.js';
import { prismaAdmin } from '../../lib/prisma.js';
import { audit } from '../audit/audit.service.js';

const EXPENSE_CATEGORIES = ['Servicios (luz/agua)', 'Transporte', 'Limpieza', 'Otros'];

/**
 * Contraseña temporal legible por teléfono: sin caracteres ambiguos (l/1/O/0),
 * porque el super admin se la va a dictar al cliente por WhatsApp o llamada.
 */
function temporaryPassword(): string {
  const letters = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += letters[randomInt(letters.length)];
  out += '-';
  for (let i = 0; i < 4; i++) out += digits[randomInt(digits.length)];
  return out;
}

export async function onboardTenant(
  input: TenantOnboardInput,
  platformUserId: string,
  req: Request,
) {
  const plan = await prismaAdmin.plan.findUnique({ where: { code: input.planCode } });
  if (!plan) throw notFound('Plan no encontrado');

  // Si no se indicó usuario, se deriva del correo (parte antes del arroba).
  const desiredUsername =
    input.ownerUsername ??
    input.ownerEmail.split('@')[0]!.toLowerCase().replace(/[^a-z0-9._-]/g, '');

  const [slugTaken, emailTaken, usernameTaken] = await Promise.all([
    prismaAdmin.tenant.findUnique({ where: { slug: input.slug }, select: { id: true } }),
    prismaAdmin.user.findUnique({ where: { email: input.ownerEmail }, select: { id: true } }),
    prismaAdmin.user.findUnique({ where: { username: desiredUsername }, select: { id: true } }),
  ]);
  if (slugTaken) throw new AppError(409, 'SLUG_TAKEN', 'Ese identificador ya está en uso');
  if (emailTaken) {
    throw new AppError(409, 'EMAIL_TAKEN', 'Ese correo ya pertenece a un usuario del sistema');
  }
  if (usernameTaken) {
    throw new AppError(
      409,
      'USERNAME_TAKEN',
      `El usuario "${desiredUsername}" ya existe. Indique uno distinto.`,
    );
  }

  const password = temporaryPassword();
  const passwordHash = await argon2.hash(password);
  const tenantId = uuidv7();
  const storeId = uuidv7();
  const userId = uuidv7();

  await prismaAdmin.$transaction(async (tx) => {
    await tx.tenant.create({
      data: {
        id: tenantId,
        name: input.name,
        slug: input.slug,
        taxRegime: input.taxRegime,
        taxId: input.taxId ?? null,
        contactName: input.ownerName,
        contactEmail: input.ownerEmail,
        contactPhone: input.ownerPhone ?? null,
      },
    });
    await tx.user.create({
      data: {
        id: userId,
        tenantId,
        username: desiredUsername,
        email: input.ownerEmail,
        name: input.ownerName,
        phone: input.ownerPhone ?? null,
        passwordHash,
        mustChangePassword: true, // el dueño cambia la temporal al primer ingreso
      },
    });
    await tx.store.create({
      data: {
        id: storeId,
        tenantId,
        name: input.storeName,
        receiptFooter: '¡Gracias por su compra!',
      },
    });
    await tx.storeMember.create({
      data: { id: uuidv7(), tenantId, storeId, userId, role: 'OWNER' },
    });
    await tx.cashRegister.create({
      data: { id: uuidv7(), tenantId, storeId, name: 'Caja 1' },
    });
    await tx.expenseCategory.createMany({
      data: EXPENSE_CATEGORIES.map((name) => ({ id: uuidv7(), tenantId, name })),
    });

    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + input.trialDays);
    await tx.subscription.create({
      data: {
        id: uuidv7(),
        tenantId,
        planId: plan.id,
        status: input.trialDays > 0 ? 'TRIAL' : 'ACTIVE',
        periodStart: start,
        periodEnd: end,
        amount: input.trialDays > 0 ? 0n : plan.monthlyPrice,
        paymentNote: input.trialDays > 0 ? `Prueba de ${input.trialDays} días` : null,
        createdBy: platformUserId,
      },
    });

    await audit(tx, {
      tenantId,
      platformUserId,
      action: 'platform.tenant_onboard',
      entityType: 'tenant',
      entityId: tenantId,
      after: {
        name: input.name,
        slug: input.slug,
        plan: plan.code,
        owner: desiredUsername,
        store: input.storeName,
        trialDays: input.trialDays,
      },
    }, req);
  });

  // La contraseña temporal se devuelve UNA sola vez: no se guarda en claro.
  return {
    tenantId,
    slug: input.slug,
    owner: {
      username: desiredUsername,
      email: input.ownerEmail,
      temporaryPassword: password,
    },
    storeId,
    plan: plan.code,
  };
}
