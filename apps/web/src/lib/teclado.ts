/**
 * ¿Enfocar un campo de texto abriría el teclado en pantalla?
 *
 * EL PROBLEMA. El punto de venta devolvía el foco al campo de escaneo tras
 * cada acción —agregar un producto, cobrar, cerrar el comprobante— porque el
 * cajero trabaja con el lector en la mano y no con el mouse. En una
 * computadora eso no se nota. En un teléfono, enfocar un campo de texto ES
 * abrir el teclado: escaneando con la cámara, CADA producto que entraba al
 * carrito lo hacía subir y tapar media pantalla, justo encima del visor desde
 * el que se estaba escaneando.
 *
 * Y el foco ya no hace falta para lo que se puso. El lector físico se atiende
 * con captura global del teclado (D-067), no con un campo enfocado; en un
 * teléfono, además, no hay lector físico que servir. Así que ahí el foco
 * automático no compra nada y cuesta el teclado.
 *
 * CÓMO SE DECIDE. `(hover: none) and (pointer: coarse)` es el dedo como único
 * puntero: teléfono o tableta sin mouse ni lápiz. No se mira el agente de
 * usuario —que miente y envejece— ni `maxTouchPoints`, que da positivo en
 * cualquier portátil con pantalla táctil, donde el teclado es físico y el foco
 * automático sí conviene.
 *
 * Esto NO toca los campos que la persona abre para escribir (un monto, un
 * motivo, el código a mano): ahí el teclado es justo lo que se pidió.
 */

/** Consulta de medios inyectable: en las pruebas no hay `window`. */
export type Medios = (consulta: string) => boolean;

/** El dedo como único puntero. */
export const SOLO_TACTIL = '(hover: none) and (pointer: coarse)';

function mediosPorOmision(): Medios | null {
  try {
    if (typeof globalThis.matchMedia !== 'function') return null;
    return (consulta) => globalThis.matchMedia(consulta).matches;
  } catch {
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
