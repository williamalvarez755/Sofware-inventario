/**
 * Cuánto dura una sesión en ESTE equipo.
 *
 * EL RIESGO REAL, Y NO ES EL SERVIDOR. Una pestaña cerrada no hace trabajar al
 * API: es stateless, y sin pestaña no hay peticiones. Lo que sí queda es el
 * refresh token, que vive 30 días en el navegador (D-021). En la computadora
 * del mostrador —que es compartida— eso significa que el siguiente que se
 * siente **es** el cajero del turno anterior: puede anular ventas, retirar
 * efectivo y ver márgenes, y la bitácora se lo atribuirá a quien ya se fue.
 * Ese es el agujero que esto cierra.
 *
 * (Lo que sí hacía trabajar al servidor era una pestaña ABIERTA y olvidada: la
 * campana sondeaba cada 2 minutos sin parar, incluso oculta. Eso se arregló
 * aparte, pausándola cuando la pestaña no se ve.)
 *
 * DOS MECANISMOS, Y POR QUÉ EL PREDETERMINADO ES EL DE INACTIVIDAD:
 *
 *  · **Inactividad** (encendido, 30 min). Es el que protege de verdad el caso
 *    que importa: la computadora que queda sola. No depende de que alguien
 *    cierre nada, que es justo lo que no va a pasar al final de un turno.
 *
 *  · **Cerrar al cerrar la pestaña** (apagado, opcional). Se implementa
 *    guardando el token en `sessionStorage`: muere con la pestaña pero
 *    SOBREVIVE a recargar, que es la distinción que importa en una tienda
 *    (D-059: ahí se recarga). Queda apagado por omisión porque el sistema
 *    operativo de un teléfono descarta pestañas en segundo plano por su
 *    cuenta: un cajero que se va a WhatsApp y vuelve se encontraría fuera,
 *    con el cliente enfrente. Quien quiera esa garantía la enciende.
 *
 * NO SE USA `beforeunload` NI UN BEACON para revocar al cerrar. Suena correcto
 * y está mal: esos eventos también se disparan AL RECARGAR, así que revocarían
 * el token que la página está a punto de volver a usar. `sessionStorage` hace
 * la distinción que el evento no puede hacer.
 *
 * Por equipo y no por cuenta, igual que el lector de códigos: la computadora
 * del mostrador y el teléfono del dueño son el mismo usuario y necesitan
 * respuestas distintas.
 */
import { useCallback, useSyncExternalStore } from 'react';

/** Almacén inyectable, igual que en `carrito.ts` y `teclado.ts`. */
export type Almacen = Pick<Storage, 'getItem' | 'setItem'>;

export const CLAVE_MINUTOS = 'mm.sesion.minutos';
export const CLAVE_AL_CERRAR = 'mm.sesion.alCerrarPestana';
/** Compartida entre pestañas: trabajar en una cuenta como actividad en todas. */
export const CLAVE_ACTIVIDAD = 'mm.sesion.ultimaActividad';

const EVENTO = 'mm:sesion-politica';

/**
 * Treinta minutos por omisión.
 *
 * Más corto expulsa a un cajero que está trabajando: una tarde floja en una
 * tienda de barrio tiene ratos largos sin nadie en el mostrador, y volver a
 * entrar con un cliente enfrente es la fricción que este producto lleva
 * rechazando desde el principio. Más largo deja la computadora compartida
 * abierta demasiado tiempo, que es justo lo que se quiere evitar.
 */
export const MINUTOS_POR_OMISION = 30;

/** `0` es "nunca": tiene sentido en el teléfono propio del dueño. */
export const OPCIONES_MINUTOS = [15, 30, 60, 240, 0] as const;

export function etiquetaMinutos(min: number): string {
  if (min === 0) return 'Nunca';
  if (min < 60) return `${min} minutos`;
  if (min === 60) return '1 hora';
  return `${min / 60} horas`;
}

/** Aviso antes de cerrar: suficiente para reaccionar, no tanto como para estorbar. */
export const MS_DE_AVISO = 60_000;

/** Cada cuánto se escribe la actividad compartida. Mover el mouse no puede costar un write por píxel. */
export const MS_ENTRE_ESCRITURAS = 15_000;

function almacenPorOmision(): Almacen | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function minutosGuardados(almacen: Almacen | null = almacenPorOmision()): number | null {
  if (!almacen) return null;
  try {
    const v = almacen.getItem(CLAVE_MINUTOS);
    if (v === null) return null;
    const n = Number(v);
    // Un valor corrupto no debe dejar la sesión sin límite ni cerrarla ya.
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function minutosDeInactividad(almacen: Almacen | null = almacenPorOmision()): number {
  return minutosGuardados(almacen) ?? MINUTOS_POR_OMISION;
}

export function cierraAlCerrarPestana(almacen: Almacen | null = almacenPorOmision()): boolean {
  if (!almacen) return false;
  try {
    return almacen.getItem(CLAVE_AL_CERRAR) === '1';
  } catch {
    return false;
  }
}

function avisar(): void {
  try {
    globalThis.dispatchEvent?.(new Event(EVENTO));
  } catch {
    /* sin ventana (pruebas) */
  }
}

export function guardarMinutos(min: number, almacen: Almacen | null = almacenPorOmision()): void {
  try {
    almacen?.setItem(CLAVE_MINUTOS, String(min));
  } catch {
    /* vale para esta sesión */
  }
  avisar();
}

export function guardarAlCerrarPestana(
  si: boolean,
  almacen: Almacen | null = almacenPorOmision(),
): void {
  try {
    almacen?.setItem(CLAVE_AL_CERRAR, si ? '1' : '0');
  } catch {
    /* vale para esta sesión */
  }
  avisar();
}

// ───────────────────────────── El reloj ─────────────────────────────

/**
 * Cuánto falta para cerrar, en milisegundos. `Infinity` si no hay límite.
 *
 * Pura a propósito: el reloj y el almacén entran como argumentos, así que la
 * regla se prueba sin esperar media hora.
 */
export function faltaParaCerrar(
  ultimaActividad: number,
  ahora: number,
  minutos: number,
): number {
  if (minutos <= 0) return Infinity;
  return ultimaActividad + minutos * 60_000 - ahora;
}

export function tocaCerrar(ultimaActividad: number, ahora: number, minutos: number): boolean {
  return faltaParaCerrar(ultimaActividad, ahora, minutos) <= 0;
}

export function tocaAvisar(ultimaActividad: number, ahora: number, minutos: number): boolean {
  const falta = faltaParaCerrar(ultimaActividad, ahora, minutos);
  return falta > 0 && falta <= MS_DE_AVISO;
}

/**
 * La última actividad conocida, mirando también lo que escribieron las otras
 * pestañas. Sin dato, "ahora": una pestaña que acaba de abrirse no puede
 * nacer vencida.
 */
export function ultimaActividad(
  ahora: number,
  almacen: Almacen | null = almacenPorOmision(),
): number {
  if (!almacen) return ahora;
  try {
    const v = Number(almacen.getItem(CLAVE_ACTIVIDAD));
    if (!Number.isFinite(v) || v <= 0) return ahora;
    // Un reloj que se movió hacia atrás, o un dato del futuro, no debe
    // regalar una sesión eterna.
    return Math.min(v, ahora);
  } catch {
    return ahora;
  }
}

export function marcarActividad(
  ahora: number,
  almacen: Almacen | null = almacenPorOmision(),
): void {
  try {
    almacen?.setItem(CLAVE_ACTIVIDAD, String(ahora));
  } catch {
    /* sin persistencia la sesión sigue viva en esta pestaña */
  }
}

// ───────────────────────── Enganche con React ─────────────────────────

function suscribir(notificar: () => void): () => void {
  globalThis.addEventListener?.(EVENTO, notificar);
  globalThis.addEventListener?.('storage', notificar);
  return () => {
    globalThis.removeEventListener?.(EVENTO, notificar);
    globalThis.removeEventListener?.('storage', notificar);
  };
}

export function useMinutosDeInactividad(): [number, (min: number) => void] {
  const min = useSyncExternalStore(
    suscribir,
    () => minutosDeInactividad(),
    () => MINUTOS_POR_OMISION,
  );
  return [min, useCallback((v: number) => guardarMinutos(v), [])];
}

export function useCerrarAlCerrarPestana(): [boolean, (si: boolean) => void] {
  const si = useSyncExternalStore(
    suscribir,
    () => cierraAlCerrarPestana(),
    () => false,
  );
  return [si, useCallback((v: boolean) => guardarAlCerrarPestana(v), [])];
}
