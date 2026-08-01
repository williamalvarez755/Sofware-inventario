/**
 * Limitadores de intentos de autenticación.
 *
 * Por qué NO basta con limitar por IP: una tienda entera sale por una sola
 * conexión. Si el cubo es por IP, tres cajeros equivocándose de contraseña en
 * el cambio de turno dejan al cuarto sin poder entrar — y el sistema tiene que
 * funcionar en el mostrador, con clientes esperando.
 *
 * Esquema en dos niveles:
 *  1. Por CUENTA (ip + correo): frena el ataque a una cuenta concreta sin
 *     castigar a los compañeros que comparten la conexión.
 *  2. Por IP, mucho más holgado: frena el abuso masivo desde un solo origen.
 */
import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../config/env.js';

const WINDOW_MS = 15 * 60 * 1000;

/**
 * Los límites son configurables por entorno. En la suite de pruebas se elevan
 * (RATE_LIMIT_MULTIPLIER) para que las decenas de inicios de sesión de los
 * tests no choquen con una defensa pensada para humanos; la lógica de las
 * claves —lo que de verdad hay que garantizar— se prueba por unidad.
 */
const factor = env.RATE_LIMIT_MULTIPLIER;

/**
 * Clave de IP estable. En IPv6 se agrupa por prefijo /64: un atacante suele
 * tener un bloque entero a su disposición, así que limitar por dirección
 * exacta no frenaría nada.
 */
export function ipKey(req: Request): string {
  const ip = req.ip ?? 'desconocida';
  if (!ip.includes(':')) return ip;
  return ip.split(':').slice(0, 4).join(':');
}

function message(text: string): Partial<Options> {
  return {
    windowMs: WINDOW_MS,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: text } },
  };
}

/**
 * Combina la conexión con la cuenta que se está intentando abrir.
 * Corre ANTES de la validación, así que lee el cuerpo crudo: acepta tanto
 * `username` (lo que envía la app) como `email` (compatibilidad).
 */
export function accountKey(req: Request): string {
  const raw = req.body?.username ?? req.body?.email;
  const account = typeof raw === 'string' ? raw.toLowerCase().trim() : '';
  return `${ipKey(req)}|${account}`;
}

/** Intentos de contraseña contra UNA cuenta desde una conexión. */
export const passwordAttemptLimiter = rateLimit({
  ...message('Demasiados intentos con esta cuenta. Espere unos minutos.'),
  limit: 10 * factor,
  keyGenerator: accountKey,
});

/** Tope global por conexión: alto, para no estorbar a una tienda con varios cajeros. */
export const authIpLimiter = rateLimit({
  ...message('Demasiados intentos desde esta conexión. Espere unos minutos.'),
  limit: 100 * factor,
  keyGenerator: ipKey,
});

/**
 * Verificación del segundo factor: cubo propio y estrecho. El código tiene
 * un millón de combinaciones, así que 10 intentos por desafío es de sobra
 * para un humano y muy poco para adivinar.
 */
export const twoFactorLimiter = rateLimit({
  ...message('Demasiados intentos de verificación. Ingrese de nuevo.'),
  limit: 10 * factor,
  keyGenerator: (req: Request) => {
    const token = typeof req.body?.challengeToken === 'string' ? req.body.challengeToken : '';
    // La firma del JWT identifica el desafío sin exponer nada del usuario.
    return `${ipKey(req)}|${token.slice(-24)}`;
  },
});
