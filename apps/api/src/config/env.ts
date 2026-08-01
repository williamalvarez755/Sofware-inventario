import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),      // admin: migraciones + módulo plataforma
  APP_DATABASE_URL: z.string().min(1),  // runtime tenant: rol sin BYPASSRLS
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PORT: z.coerce.number().int().default(4000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Multiplicador de los límites de autenticación. 1 en producción; la suite
   *  de pruebas lo eleva para no chocar con defensas pensadas para humanos. */
  RATE_LIMIT_MULTIPLIER: z.coerce.number().int().min(1).max(1000).default(1),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';
