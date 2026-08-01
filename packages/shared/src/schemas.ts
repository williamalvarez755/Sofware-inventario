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
