import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';

// BigInt (dinero en centavos) → string en JSON. El frontend formatea con formatQ.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const app = createApp();
app.listen(env.PORT, () => {
  logger.info(`API escuchando en http://localhost:${env.PORT}`);
});
