/**
 * Captura global del lector físico de códigos de barras.
 *
 * LO QUE FALTABA. D-010 dice que el lector HID se atiende con "captura global
 * de ráfagas con sufijo Enter", pero lo implementado era un campo de texto
 * enfocado. Mientras el cursor estuviera ahí, funcionaba; y el cursor se va
 * solo todo el tiempo: al tocar la cantidad de una línea, al cerrar un
 * cuadro de diálogo, al cambiar de tienda en el selector, al volver de otra
 * pestaña. El cajero dispara el lector, no pasa nada, y no tiene forma de
 * saber por qué.
 *
 * CÓMO SE DISTINGUE UNA MÁQUINA DE UNA PERSONA. Por la velocidad, y por nada
 * más. Un lector HID teclea un EAN-13 completo en 30–60 ms: unos 4 ms entre
 * tecla y tecla. La persona más rápida del mundo no baja de ~80 ms sostenidos
 * durante trece caracteres. Si toda la ráfaga vino por debajo del umbral y
 * terminó en Enter, fue una máquina.
 *
 * Esa prueba es lo que permite escuchar el teclado ENTERO sin romper nada:
 * quien escribe en un campo de cantidad o en un buscador nunca va a disparar
 * la detección, porque escribe demasiado lento. No hace falta adivinar si el
 * foco "cuenta" o no.
 */

export interface OpcionesRafaga {
  /** Máximo entre teclas para que siga siendo una ráfaga de máquina. */
  msEntreTeclas?: number;
  /** Un código más corto que esto es ruido, no un producto. */
  largoMinimo?: number;
}

export interface DetectorDeRafaga {
  /** Alimenta una tecla. Devuelve el código cuando la ráfaga se completó. */
  tecla(key: string, ahora: number): string | null;
  /** Lo acumulado hasta ahora, para depurar. */
  parcial(): string;
}

const POR_OMISION = { msEntreTeclas: 50, largoMinimo: 6 };

export function crearDetectorDeRafaga(opciones: OpcionesRafaga = {}): DetectorDeRafaga {
  const msEntreTeclas = opciones.msEntreTeclas ?? POR_OMISION.msEntreTeclas;
  const largoMinimo = opciones.largoMinimo ?? POR_OMISION.largoMinimo;

  let buffer = '';
  let ultimaTecla = 0;

  return {
    tecla(key, ahora) {
      const lento = ahora - ultimaTecla > msEntreTeclas;
      ultimaTecla = ahora;

      if (key === 'Enter') {
        const codigo = buffer;
        buffer = '';
        // El Enter también tiene que llegar rápido: si la persona escribió
        // algo y presionó Enter un segundo después, no fue un lector.
        return !lento && codigo.length >= largoMinimo ? codigo : null;
      }

      // Solo caracteres imprimibles sueltos. Shift, Control, F5 y compañía
      // llegan como nombres largos y no forman parte de ningún código.
      if (key.length !== 1) return null;

      // Una pausa larga empieza una ráfaga nueva: lo anterior era de otra
      // cosa, o de un intento que quedó a medias.
      buffer = lento ? key : buffer + key;
      return null;
    },
    parcial: () => buffer,
  };
}
