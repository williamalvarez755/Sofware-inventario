import { z } from 'zod';

// ---- Auth ----
/**
 * Ingreso por NOMBRE DE USUARIO (D-036). Se sigue aceptando `email` para no
 * romper integraciones existentes; ambos desembocan en el mismo identificador,
 * y el servicio lo busca contra usuario o correo indistintamente.
 */
export const loginSchema = z
  .object({
    username: z.string().trim().min(1).max(60).optional(),
    email: z.string().trim().max(120).optional(),
    password: z.string().min(1, 'Contraseña requerida'),
  })
  .refine((v) => Boolean(v.username?.length || v.email?.length), {
    message: 'Usuario requerido',
    path: ['username'],
  })
  .transform((v) => ({
    identifier: (v.username || v.email || '').toLowerCase().trim(),
    password: v.password,
  }));
export type LoginInput = z.infer<typeof loginSchema>;

/** Reglas del nombre de usuario al crearlo o cambiarlo. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Mínimo 3 caracteres')
  .max(30, 'Máximo 30 caracteres')
  .regex(/^[a-z0-9._-]+$/, 'Solo letras, números, punto, guion y guion bajo');

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

/**
 * Contraseña de cuenta. El mínimo es 8 porque la contraseña temporal que
 * genera el alta ya viene fuerte; el riesgo real es que el tendero la cambie
 * por algo de cuatro letras al primer ingreso.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Mínimo 8 caracteres')
  .max(200, 'Máximo 200 caracteres');

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Ingrese su contraseña actual'),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'La nueva contraseña debe ser distinta de la actual',
    path: ['newPassword'],
  });
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;

// ---- 2FA (Fase 6) ----
/** Acepta 6 dígitos (TOTP) o un código de recuperación con guion. */
const secondFactorCode = z
  .string()
  .trim()
  .min(6, 'Código incompleto')
  .max(12)
  .transform((v) => v.replace(/\s/g, ''));

export const twoFactorLoginSchema = z.object({
  challengeToken: z.string().min(20),
  code: secondFactorCode,
});

export const twoFactorEnableSchema = z.object({ code: secondFactorCode });

export const twoFactorDisableSchema = z.object({
  password: z.string().min(1, 'Contraseña requerida'),
  code: secondFactorCode,
});

// ---- Tiendas ----
export const storeCreateSchema = z.object({
  name: z.string().trim().min(2, 'Nombre muy corto').max(80),
  address: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(20).optional(),
  receiptHeader: z.string().trim().max(200).optional(),
  receiptFooter: z.string().trim().max(200).optional(),
});
export type StoreCreateInput = z.infer<typeof storeCreateSchema>;

// ---- Plataforma ----
export const tenantStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'CANCELLED']),
  reason: z.string().trim().min(3, 'Motivo requerido').max(300),
});

/**
 * Eliminación definitiva. Se pide escribir el identificador del cliente:
 * un botón de "¿seguro?" se acepta sin leer, escribir "dona-mari" no.
 */
export const tenantPurgeSchema = z.object({
  confirmSlug: z.string().trim().min(1, 'Escriba el identificador del cliente'),
  reason: z.string().trim().min(10, 'Explique por qué se elimina (mínimo 10 caracteres)').max(300),
});

// ---- Catálogo (Fase 1) ----
/** Dinero SIEMPRE como entero en centavos (CLAUDE.md A9). */
const centavos = z.number().int('Debe ser centavos enteros').min(0).max(999_999_999);
/** Cantidades de stock: hasta 3 decimales (granel). */
const stockQty = z
  .number()
  .positive('La cantidad debe ser mayor que cero')
  .max(999_999)
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, 'Máximo 3 decimales');

export const categorySchema = z.object({
  name: z.string().trim().min(2, 'Nombre muy corto').max(60),
});

export const productCreateSchema = z.object({
  name: z.string().trim().min(2, 'Nombre muy corto').max(120),
  sku: z.string().trim().max(40).optional(),
  description: z.string().trim().max(500).optional(),
  categoryId: z.string().uuid().optional(),
  categoryName: z.string().trim().min(2).max(60).optional(), // crea la categoría al vuelo
  unitId: z.string().uuid('Unidad requerida'),
  price: centavos,
  barcode: z.string().trim().min(3).max(64).optional(),
  initial: z
    .object({
      storeId: z.string().uuid(),
      qty: stockQty,
      unitCost: centavos,
    })
    .optional(),
});
export type ProductCreateInput = z.infer<typeof productCreateSchema>;

export const productUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  price: centavos.optional(),
  isActive: z.boolean().optional(),
});
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

export const barcodeSchema = z.object({
  barcode: z.string().trim().min(3).max(64),
});

export const storeProductSchema = z.object({
  minStock: stockQty.or(z.literal(0)).optional(),
  priceOverride: centavos.nullable().optional(),
  isActive: z.boolean().optional(),
});

export const productListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  categoryId: z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

// ---- Inventario (Fase 1) ----
export const ADJUSTMENT_TYPES = [
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'WASTE',
  'INTERNAL_USE',
] as const;

export const adjustmentSchema = z.object({
  storeId: z.string().uuid(),
  productId: z.string().uuid(),
  type: z.enum(ADJUSTMENT_TYPES),
  qty: stockQty,
  reason: z.string().trim().min(3, 'El motivo es obligatorio').max(300),
});
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

export const kardexQuerySchema = z.object({
  storeId: z.string().uuid(),
  productId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
});

// ---- Caja (Fase 2) ----
export const openSessionSchema = z.object({
  cashRegisterId: z.string().uuid(),
  openingAmount: centavos,
});

export const closeSessionSchema = z.object({
  countedAmount: centavos,
  countedDetail: z.record(z.string(), z.number().int().min(0)).optional(), // denominación → cantidad
  notes: z.string().trim().max(300).optional(),
});

/** Retiros y depósitos. El PIN de un autorizador solo es necesario cuando quien
 *  registra no tiene el permiso de autorizar por sí mismo (trabajador). */
export const cashTxSchema = z.object({
  amount: z.number().int().positive('Monto en centavos, mayor que cero').max(999_999_999),
  reason: z.string().trim().min(3, 'El motivo es obligatorio').max(300),
  authorizerEmail: z.string().email().toLowerCase().trim().optional(),
  authorizerPin: z.string().trim().min(4).max(12).optional(),
});
export type CashTxInput = z.infer<typeof cashTxSchema>;

export const registerCreateSchema = z.object({
  storeId: z.string().uuid(),
  name: z.string().trim().min(2).max(40),
});

// ---- Ventas (Fase 2) ----
export const PAYMENT_METHODS = ['CASH', 'CARD', 'TRANSFER'] as const;

const salePaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z.number().int().positive().max(999_999_999),
  amountTendered: centavos.optional(), // solo CASH: efectivo recibido
  reference: z.string().trim().max(60).optional(),
});

export const saleCreateSchema = z.object({
  storeId: z.string().uuid(),
  cashSessionId: z.string().uuid(),
  clientOpId: z.string().uuid(), // idempotencia: reintentos no duplican
  items: z
    .array(z.object({ productId: z.string().uuid(), qty: stockQty }))
    .min(1, 'La venta necesita al menos un producto'),
  discount: centavos.default(0),
  payments: z.array(salePaymentSchema).min(1, 'Falta la forma de pago'),
});
export type SaleCreateInput = z.infer<typeof saleCreateSchema>;

export const voidSaleSchema = z.object({
  reason: z.string().trim().min(3, 'El motivo es obligatorio').max(300),
  authorizerEmail: z.string().email().toLowerCase().trim().optional(),
  authorizerPin: z.string().trim().min(4).max(12).optional(),
});
export type VoidSaleInput = z.infer<typeof voidSaleSchema>;

export const salesListQuerySchema = z.object({
  storeId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

// ---- Proveedores y compras (Fase 3) ----
export const supplierSchema = z.object({
  name: z.string().trim().min(2, 'Nombre muy corto').max(80),
  taxId: z.string().trim().max(20).optional(),
  contactName: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().email().toLowerCase().trim().optional(),
  notes: z.string().trim().max(300).optional(),
});
export type SupplierInput = z.infer<typeof supplierSchema>;

export const supplierUpdateSchema = supplierSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const purchaseCreateSchema = z.object({
  storeId: z.string().uuid(),
  supplierId: z.string().uuid(),
  supplierInvoice: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(300).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: stockQty,
        unitCost: z.number().int().positive('Costo en centavos, mayor que cero').max(999_999_999),
      }),
    )
    .min(1, 'La compra necesita al menos un producto'),
});
export type PurchaseCreateInput = z.infer<typeof purchaseCreateSchema>;

export const voidPurchaseSchema = z.object({
  reason: z.string().trim().min(3, 'El motivo es obligatorio').max(300),
});

export const purchasesListQuerySchema = z.object({
  storeId: z.string().uuid(),
  supplierId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

// ---- Gastos (Fase 3) ----
export const expenseCategorySchema = z.object({
  name: z.string().trim().min(2, 'Nombre muy corto').max(60),
});

export const expenseCreateSchema = z.object({
  storeId: z.string().uuid(),
  categoryId: z.string().uuid(),
  amount: z.number().int().positive('Monto en centavos, mayor que cero').max(999_999_999),
  description: z.string().trim().min(3, 'La justificación es obligatoria').max(300),
  cashSessionId: z.string().uuid().optional(), // si el gasto sale de la caja abierta
});
export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;

export const expenseUpdateSchema = z.object({
  categoryId: z.string().uuid().optional(),
  description: z.string().trim().min(3).max(300).optional(),
});

export const expensesListQuerySchema = z.object({
  storeId: z.string().uuid(),
  categoryId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

// ---- Plataforma / SaaS (Fase 5) ----

/** Onboarding completo de un cliente nuevo en una sola operación. */
export const tenantOnboardSchema = z.object({
  name: z.string().trim().min(2, 'Nombre del negocio muy corto').max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Identificador muy corto')
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Solo minúsculas, números y guiones'),
  planCode: z.string().trim().min(2),
  ownerName: z.string().trim().min(2, 'Nombre del dueño requerido').max(80),
  ownerUsername: usernameSchema.optional(), // si se omite, se deriva del correo
  ownerEmail: z.string().email('Correo inválido').toLowerCase().trim(),
  // Si se omite, el sistema genera una temporal legible por teléfono (D-029).
  // En ambos casos el dueño está obligado a cambiarla al primer ingreso.
  ownerPassword: passwordSchema.optional(),
  ownerPhone: z.string().trim().max(20).optional(),
  storeName: z.string().trim().min(2, 'Nombre de la tienda requerido').max(80),
  taxRegime: z.enum(['GENERAL', 'PEQUENO_CONTRIBUYENTE', 'NINGUNO']).default('NINGUNO'),
  taxId: z.string().trim().max(20).optional(),
  trialDays: z.coerce.number().int().min(0).max(365).default(30),
});
export type TenantOnboardInput = z.infer<typeof tenantOnboardSchema>;

export const planSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(30)
    .regex(/^[a-z0-9-]+$/, 'Solo minúsculas, números y guiones'),
  name: z.string().trim().min(2).max(60),
  maxStores: z.coerce.number().int().min(1).max(1000),
  maxUsers: z.coerce.number().int().min(1).max(10_000),
  monthlyPrice: z.coerce.number().int().min(0).max(999_999_999), // centavos
  isActive: z.boolean().optional(),
});

export const subscriptionSchema = z.object({
  planCode: z.string().trim().min(2),
  months: z.coerce.number().int().min(1).max(36).default(1),
  amount: z.coerce.number().int().min(0).max(999_999_999).optional(), // omitido = precio del plan
  status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED']).default('ACTIVE'),
  paymentNote: z.string().trim().max(200).optional(),
});

export const impersonateSchema = z.object({
  reason: z.string().trim().min(5, 'Indique el motivo del acceso').max(200),
});

// ---- Reportes (Fase 4) ----
/** Fechas en formato YYYY-MM-DD, interpretadas en horario de Guatemala. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use el formato AAAA-MM-DD');

export const reportRangeSchema = z
  .object({
    storeId: z.string().uuid().optional(), // omitido = todas las tiendas visibles
    from: isoDate,
    to: isoDate,
    format: z.enum(['json', 'csv']).default('json'),
  })
  .refine((v) => v.from <= v.to, { message: 'El rango de fechas está invertido' });
export type ReportRange = z.infer<typeof reportRangeSchema>;

export const salesReportSchema = reportRangeSchema.innerType().extend({
  groupBy: z.enum(['day', 'user', 'category', 'store', 'product']).default('day'),
});

export const auditQuerySchema = z.object({
  storeId: z.string().uuid().optional(),
  action: z.string().trim().max(60).optional(),
  userId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
});

/** Acciones consideradas críticas para la vista de auditoría por defecto. */
export const CRITICAL_ACTIONS = [
  'sale.void',
  'cash.withdrawal',
  'cash.close',
  'inventory.adjust',
  'product.price_change',
  'purchase.void',
  'expense.update',
  'auth.login_failed',
  'auth.refresh_reuse_detected',
] as const;
