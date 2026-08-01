import { z } from 'zod';

// ---- Auth ----
export const loginSchema = z.object({
  email: z.string().email('Email inválido').toLowerCase().trim(),
  password: z.string().min(1, 'Contraseña requerida'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
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
