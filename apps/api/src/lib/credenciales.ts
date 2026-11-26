/**
 * Credenciales publicadas: detección al arrancar.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. El repositorio es público, y en él están —y
 * tienen que estar, porque hacen falta para levantar el proyecto— la
 * contraseña del rol de ejecución que crea la migración de RLS, la clave de
 * ejemplo del JWT y la contraseña inicial del super admin. Son valores de
 * desarrollo perfectamente razonables; el problema es el día en que alguien
 * despliega a producción y se olvida de cambiar uno.
 *
 * Eso ya pasó una vez en este proyecto: la contraseña publicada del rol
 * `app_runtime` seguía siendo válida contra la base de producción, y se
 * comprobó que lo era. RLS no protege de eso: quien se conecta con ese rol
 * elige él mismo el `app.tenant_id`.
 *
 * Una contraseña rotada se puede volver a olvidar en el próximo despliegue.
 * Un arranque que se niega, no. Por eso la comprobación vive en el código y
 * no en una lista de pasos de `docs/deploy.md`.
 *
 * Las funciones de abajo son puras para poder probarlas sin base ni entorno.
 */

/** Las que están escritas en el repositorio y por lo tanto son públicas. */
export const CLAVES_PUBLICADAS = {
  rolEjecucion: 'app_runtime_dev',
  jwt: 'cambiar-por-secreto-largo-aleatorio',
  superAdmin: 'SuperAdmin!2026',
  demo: 'Demo!2026',
} as const;

/** Largo mínimo del secreto de firma. Por debajo, la fuerza bruta es viable. */
export const LARGO_MINIMO_JWT = 32;

export interface Hallazgo {
  variable: string;
  motivo: string;
}

/**
 * ¿La cadena de conexión lleva la contraseña publicada?
 *
 * Se busca en la posición de la contraseña y no en toda la cadena: un
 * servidor que por casualidad se llamara `app_runtime_dev` no es un hallazgo.
 */
export function usaClavePublicada(connectionString: string | undefined): boolean {
  if (!connectionString) return false;
  try {
    const url = new URL(connectionString);
    return decodeURIComponent(url.password) === CLAVES_PUBLICADAS.rolEjecucion;
  } catch {
    // Cadena que no parsea: no se puede afirmar nada, y no es este el
    // chequeo que debe avisarlo — de eso se encarga la conexión al arrancar.
    return false;
  }
}

export function secretoJwtDebil(secreto: string | undefined): string | null {
  if (!secreto) return 'no está definido';
  if (secreto === CLAVES_PUBLICADAS.jwt) return 'es el valor de ejemplo del repositorio';
  if (secreto.length < LARGO_MINIMO_JWT) {
    return `tiene ${secreto.length} caracteres; el mínimo razonable son ${LARGO_MINIMO_JWT}`;
  }
  return null;
}

/**
 * Revisa el entorno y devuelve lo que esté mal. No decide qué hacer con
 * ello: en producción el arranque se detiene, en desarrollo solo se avisa.
 */
export function revisarEntorno(entorno: {
  DATABASE_URL?: string;
  APP_DATABASE_URL?: string;
  JWT_SECRET?: string;
}): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  for (const variable of ['DATABASE_URL', 'APP_DATABASE_URL'] as const) {
    if (usaClavePublicada(entorno[variable])) {
      hallazgos.push({
        variable,
        motivo:
          'usa la contraseña que la migración de RLS deja escrita en el repositorio, ' +
          'que es público. Cámbiela con ALTER ROLE y actualice la variable.',
      });
    }
  }

  const jwt = secretoJwtDebil(entorno.JWT_SECRET);
  if (jwt) {
    hallazgos.push({
      variable: 'JWT_SECRET',
      motivo: `${jwt}. Con él se firman todas las sesiones del sistema.`,
    });
  }

  return hallazgos;
}
