import { pino } from 'pino';
import { isProd } from '../config/env.js';

export const logger = pino({
  level: isProd ? 'info' : 'debug',
  ...(isProd
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true } } }),
});
