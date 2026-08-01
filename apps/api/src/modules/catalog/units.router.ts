import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';

export const unitsRouter = Router();
unitsRouter.use(requireAuth);

// La política RLS de units devuelve globales (tenant_id NULL) + las del tenant.
unitsRouter.get('/', async (req, res) => {
  res.json(
    await req.db!.unit.findMany({
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, allowsDecimals: true },
    }),
  );
});
