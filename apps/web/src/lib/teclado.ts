/**
 * ¿El campo de escaneo se queda el foco en este equipo?
 *
 * EL PROBLEMA. El punto de venta devolvía el foco al campo de escaneo tras
 * cada acción —agregar un producto, cobrar, cerrar el comprobante— porque el
 * cajero trabaja con el lector en la mano y no con el mouse. En una
 * computadora eso no se nota. En un teléfono, enfocar un campo de texto ES
 * abrir el teclado: escaneando con la cámara, CADA producto que entraba al
 * carrito lo hacía subir y tapar media pantalla, justo encima del visor desde
 * el que se estaba escaneando.
 *
 * LO DECIDE LA PERSONA, NO UNA ADIVINANZA. Quien tiene el equipo enfrente
 * sabe si hay lector conectado; el navegador solo puede inferirlo. Así que el
 * interruptor vive en el menú de la cuenta, se guarda POR EQUIPO —la
 * computadora del mostrador tiene lector y el teléfono del dueño no, y son
 * la misma cuenta— y manda sobre cualquier heurística.
 *
 * LA HEURÍSTICA SOLO PONE EL VALOR INICIAL, para que nadie tenga que
 * configurar nada el primer día: `(hover: none) and (pointer: coarse)` es el
 * dedo como único puntero, o sea teléfono o tableta sin mouse ni lápiz. No se
 * mira el agente de usuario —que miente y envejece— ni `maxTouchPoints`, que
 * da positivo en cualquier portátil con pantalla táctil, donde el teclado es
 * físico y el foco automático sí conviene.
 *
 * QUÉ NO TOCA. Los campos que la persona abre para escribir —un monto, un
 * motivo, el código a mano— se siguen autoenfocando siempre: ahí el teclado
 * es justo lo que se pidió.
 */
import { useCallback, useSyncExternalStore } from 'react';

/** Consulta de medios inyectable: en las pruebas no hay `window`. */
export type Medios = (consulta: string) => boolean;

/** Almacén inyectable, igual que en `carrito.ts`. */
export type Almacen = Pick<Storage, 'getItem' | 'setItem'>;

/** El dedo como único puntero. */
export const SOLO_TACTIL = '(hover: none) and (pointer: coarse)';

export const CLAVE_LECTOR = 'mm.escaner.lectorFisico';

/** Para que el interruptor se note en el acto y no hasta el próximo escaneo. */
const EVENTO = 'mm:lector-fisico';

function mediosPorOmision(): Medios | null {
  try {
    if (typeof globalThis.matchMedia !== 'function') return null;
    return (consulta) => globalThis.matchMedia(consulta).matches;
  } catch {
    return null;
  }
}

function almacenPorOmision(): Almacen | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Navegación privada o cookies bloqueadas: funciona igual, solo que la
    // preferencia no sobrevive a cerrar el navegador.
    return null;
  }
}

/**
 * `true` cuando enfocar un campo levantaría el teclado en pantalla.
 *
 * Ante la duda —sin `matchMedia`, o si la consulta revienta— devuelve `false`:
 * dejar el foco donde estaba es el comportamiento de toda la vida, y de los
 * dos errores posibles es el que nadie nota.
 */
export function enfocarAbreTeclado(medios: Medios | null = mediosPorOmision()): boolean {
  if (!medios) return false;
  try {
    return medios(SOLO_TACTIL);
  } catch {
    return false;
  }
}

/** Lo que este equipo tiene configurado, o `null` si nadie lo ha tocado. */
export function lectorGuardado(almacen: Almacen | null = almacenPorOmision()): boolean | null {
  if (!almacen) return null;
  try {
    const v = almacen.getItem(CLAVE_LECTOR);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

export function guardarLector(
  usa: boolean,
  almacen: Almacen | null = almacenPorOmision(),
): void {
  try {
    almacen?.setItem(CLAVE_LECTOR, usa ? '1' : '0');
  } catch {
    /* sin persistencia: vale para esta sesión y se vuelve a elegir */
  }
  try {
    globalThis.dispatchEvent?.(new Event(EVENTO));
  } catch {
    /* sin ventana (pruebas): quien lea volverá a consultar por su cuenta */
  }
}

/**
 * LA DECISIÓN. Lo elegido manda; si nadie eligió, la heurística: sí en una
 * computadora, no en un teléfono.
 */
export function usaLectorFisico(
  almacen: Almacen | null = almacenPorOmision(),
  medios: Medios | null = mediosPorOmision(),
): boolean {
  const elegido = lectorGuardado(almacen);
  return elegido ?? !enfocarAbreTeclado(medios);
}

function suscribir(avisar: () => void): () => void {
  globalThis.addEventListener?.(EVENTO, avisar);
  // `storage` avisa de los cambios hechos en OTRA pestaña del mismo equipo:
  // dos pestañas del punto de venta abiertas no deben discrepar.
  globalThis.addEventListener?.('storage', avisar);
  return () => {
    globalThis.removeEventListener?.(EVENTO, avisar);
    globalThis.removeEventListener?.('storage', avisar);
  };
}

/** El interruptor y su valor, para la interfaz y para el punto de venta. */
export function useLectorFisico(): [boolean, (usa: boolean) => void] {
  const usa = useSyncExternalStore(
    suscribir,
    () => usaLectorFisico(),
    () => true, // en el servidor no hay teléfono que proteger
  );
  return [usa, useCallback((v: boolean) => guardarLector(v), [])];
}
