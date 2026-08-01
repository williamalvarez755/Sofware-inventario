import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { logger } from './logger.js';

/** Error de dominio con status HTTP y código estable para el frontend. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = (msg = 'Credenciales inválidas') =>
  new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (code: string, msg: string) => new AppError(403, code, msg);
export const notFound = (msg = 'Recurso no encontrado') =>
  new AppError(404, 'NOT_FOUND', msg);

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
}

/**
 * Errores que body-parser lanza antes de llegar a nuestro código: JSON
 * malformado o cuerpo demasiado grande. Traen su propio `status`, y sin este
 * mapeo saldrían como 500 — un cliente con un bug parecería una caída del
 * servidor, y un intento de agotar memoria se perdería entre los 500 reales.
 */
function bodyParserStatus(err: unknown): { status: number; code: string; message: string } | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { type?: string; status?: number; statusCode?: number };
  const status = e.status ?? e.statusCode;
  if (e.type === 'entity.too.large') {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'El contenido enviado es demasiado grande' };
  }
  if (e.type === 'entity.parse.failed' || (err instanceof SyntaxError && status === 400)) {
    return { status: 400, code: 'MALFORMED_JSON', message: 'El cuerpo de la petición no es JSON válido' };
  }
  return null;
}

/**
 * Errores conocidos de Prisma que en realidad son culpa de la petición, no del
 * servidor. Sin este mapeo, pedir /api/products/hola devuelve 500: el
 * monitoreo se llena de "errores internos" falsos cada vez que un escáner
 * prueba URLs al azar, y los fallos de verdad se pierden entre el ruido.
 */
function prismaStatus(err: unknown): { status: number; code: string; message: string } | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;
  switch (err.code) {
    case 'P2023': // dato con formato inválido (típicamente un UUID mal escrito)
    case 'P2000': // valor demasiado largo para la columna
      return { status: 400, code: 'VALIDATION', message: 'Los datos enviados no son válidos' };
    case 'P2025': // registro no encontrado
      return { status: 404, code: 'NOT_FOUND', message: 'Recurso no encontrado' };
    case 'P2002': // violación de unicidad
      return { status: 409, code: 'CONFLICT', message: 'El registro ya existe' };
    case 'P2003': // violación de llave foránea
      return {
        status: 409,
        code: 'REFERENCE_IN_USE',
        message: 'El registro está referenciado por otros datos',
      };
    default:
      return null;
  }
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const parserError = bodyParserStatus(err);
  if (parserError) {
    res.status(parserError.status).json({
      error: { code: parserError.code, message: parserError.message },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION',
        message: 'Datos inválidos',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  const prismaError = prismaStatus(err);
  if (prismaError) {
    res.status(prismaError.status).json({
      error: { code: prismaError.code, message: prismaError.message },
    });
    return;
  }
  logger.error({ err, url: req.originalUrl }, 'Error no controlado');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno del servidor' } });
}
