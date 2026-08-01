import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

/** Valida y normaliza req.body con Zod; ZodError la captura errorHandler. */
export function validate(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.body = schema.parse(req.body);
    next();
  };
}
