import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { logger } from './lib/logger.js';
// BigInt (dinero en centavos) → string en JSON, en TODO punto de entrada
// (servidor real y tests montan la app desde aquí). El front formatea con formatQ.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

import { authRouter } from './modules/auth/auth.router.js';
import { categoriesRouter } from './modules/catalog/categories.router.js';
import { productsRouter } from './modules/catalog/products.router.js';
import { unitsRouter } from './modules/catalog/units.router.js';
import { cashRouter } from './modules/cash/cash.router.js';
import { expensesRouter } from './modules/expenses/expenses.router.js';
import { inventoryRouter } from './modules/inventory/inventory.router.js';
import { notificationsRouter } from './modules/notifications/notifications.router.js';
import { platformRouter } from './modules/platform/platform.router.js';
import { reportsRouter } from './modules/reports/reports.router.js';
import { purchasesRouter } from './modules/purchasing/purchases.router.js';
import { suppliersRouter } from './modules/purchasing/suppliers.router.js';
import { salesRouter } from './modules/sales/sales.router.js';
import { storesRouter } from './modules/tenancy/stores.router.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render corre detrás de proxy

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(',') }));
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: env.NODE_ENV !== 'test',
      customProps: (req) => ({
        tenantId: (req as express.Request).auth?.tenantId,
        userId: (req as express.Request).auth?.userId,
      }),
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/stores', storesRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/units', unitsRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/cash', cashRouter);
  app.use('/api/sales', salesRouter);
  app.use('/api/suppliers', suppliersRouter);
  app.use('/api/purchases', purchasesRouter);
  app.use('/api/expenses', expensesRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/platform', platformRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
