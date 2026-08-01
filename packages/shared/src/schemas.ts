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
