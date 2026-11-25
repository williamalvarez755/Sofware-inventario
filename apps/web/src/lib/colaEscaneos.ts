/**
 * Cola de escaneos del punto de venta.
 *
 * EL PROBLEMA. Un lector HID no espera a nadie: teclea el código y manda
 * Enter en unos 40 ms, y el cajero pasa cuatro productos seguidos sin
 * levantar la vista. El código anterior resolvía cada escaneo así:
 *
 *     onSubmit → await buscar(term) → al volver, limpiar el campo
 *
 * y ahí se perdían. Dos razones, las dos por el mismo `await`:
 *
 *   1. El campo se limpiaba DESPUÉS de la respuesta. Para entonces el lector
 *      ya había tecleado el código siguiente, y esa limpieza se lo llevaba.
 *   2. Nada ordenaba los envíos. Dos búsquedas en vuelo competían por el
 *      mismo estado y ganaba la que respondiera de último.
 *
 * De cuatro códigos seguidos entraba uno, sin aviso, y el cajero cobraba de
 * menos. Es el peor tipo de falla: silenciosa y con dinero de por medio.
 *
 * LA SOLUCIÓN. Separar "recibir" de "procesar". Recibir es instantáneo y
 * nunca se pierde; procesar va de uno en uno y en orden. El campo se limpia
 * al RECIBIR, no al terminar, así que nunca borra lo que el lector acaba de
 * escribir.
 *
 * Se descartó el caché local del catálogo por código de barras: resuelve lo
 * mismo pero agrega invalidación —precios y existencias cambian— y el
 * problema no era la latencia sino el orden.
 */

export interface ColaEscaneos {
  /** Recibe un código. No espera: devuelve de inmediato. */
  encolar(codigo: string): void;
  /** Cuántos quedan sin procesar. Para avisar "procesando 3…". */
  pendientes(): number;
  /** Tira lo que quede sin procesar (cambio de tienda, venta confirmada). */
  vaciar(): void;
}

/**
 * @param procesar  Qué hacer con cada código, de uno en uno. Si lanza, la
 *                  cola NO se detiene: el error se reporta y sigue con el
 *                  siguiente. Un código que no existe no puede dejar colgados
 *                  a los que vienen atrás.
 * @param alFallar  Dónde avisar del error de un código concreto.
 */
export function crearColaEscaneos(
  procesar: (codigo: string) => Promise<void>,
  alFallar?: (codigo: string, error: unknown) => void,
): ColaEscaneos {
  const cola: string[] = [];
  let corriendo = false;

  async function drenar(): Promise<void> {
    if (corriendo) return;
    corriendo = true;
    try {
      // `shift` dentro del bucle y no un `for`: lo que se encole mientras
      // se procesa entra en esta misma vuelta, que es justo el caso de los
      // escaneos seguidos.
      while (cola.length > 0) {
        const codigo = cola.shift()!;
        try {
          await procesar(codigo);
        } catch (error) {
          alFallar?.(codigo, error);
        }
      }
    } finally {
      corriendo = false;
    }
  }

  return {
    encolar(codigo) {
      const limpio = codigo.trim();
      if (!limpio) return;
      cola.push(limpio);
      void drenar();
    },
    pendientes: () => cola.length,
    vaciar: () => {
      cola.length = 0;
    },
  };
}
