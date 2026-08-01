import type { NextFunction, Request, Response } from 'express';
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

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
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
  logger.error({ err, url: req.originalUrl }, 'Error no controlado');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Error interno del servidor' } });
}
