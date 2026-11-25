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
import { twoFactorRouter } from './modules/auth/twofactor.router.js';
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

  app.use(
    helmet({
      // El API solo devuelve JSON: nada de scripts, estilos ni marcos.
      // Si alguna respuesta llegara a interpretarse como HTML, esta política
      // impide que ejecute nada.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      // HSTS: un año, incluidos subdominios. Render ya sirve por HTTPS.
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  // El navegador manda el origen SIN barra final ni espacios. Configurar
  // "https://mi-app.com/" es un error tan común como silencioso: no coincide
  // con nada, el login falla con "no se pudo conectar" y no hay error en el
  // servidor que lo delate. Se normaliza acá en vez de confiar en que quien
  // despliega lo escriba perfecto.
  const allowedOrigins = env.CORS_ORIGIN.split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o.length > 0);
  logger.info({ allowedOrigins }, 'CORS configurado');
  app.use(cors({ origin: allowedOrigins, credentials: false }));

  /**
   * Cuerpos comprimidos: rechazados.
   *
   * Nada de lo que manda este sistema los usa — la aplicación web envía JSON
   * plano y el CSV de importación va en texto — así que aceptarlos solo
   * agrega superficie de ataque. Y la agrega de verdad: `body-parser` 2.3.0,
   * que es la que arrastra Express 5.3.0, tiene un aviso de denegación de
   * servicio por bytes de más después de un cuerpo comprimido
   * (GHSA-27r3-jxmh-p828). Un `override` de npm no prende en este monorepo
   * —bug conocido de npm 10 con workspaces, deja el árbol en estado inválido
   * y eso sí rompería el build—, pero la ruta vulnerable requiere
   * `Content-Encoding`, así que cerrarla aquí la elimina por completo y no
   * depende de que una dependencia transitiva suba de versión.
   *
   * Va ANTES de `express.json` a propósito: el objetivo es que el cuerpo
   * comprimido nunca llegue al parser.
   */
  app.use((req, res, next) => {
    const encoding = req.headers['content-encoding'];
    if (encoding && encoding.trim().toLowerCase() !== 'identity') {
      res.status(415).json({
        error: { code: 'ENCODING_NO_SOPORTADA', message: 'No se aceptan cuerpos comprimidos' },
      });
      return;
    }
    next();
  });

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
  app.use('/api/auth/2fa', twoFactorRouter);
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
