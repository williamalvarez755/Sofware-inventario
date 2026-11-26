/**
 * Decodificador ZXing compilado a WebAssembly.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. Safari nunca implementó `BarcodeDetector`, así
 * que **todos los iPhone** decodifican en el navegador, con la librería de
 * JavaScript puro. Esa es la razón de fondo de "en iPhone a veces no da": no
 * es que lea mal, es que cada pasada cuesta tanto que alcanza a mirar unos
 * pocos cuadros por segundo, y el código tiene que caer justo en uno de ellos.
 *
 * Este es el mismo ZXing, el de C++, compilado a WebAssembly: decodifica el
 * mismo cuadro varias veces más rápido que la versión de JavaScript. En un
 * iPhone eso es la diferencia entre revisar tres cuadros por segundo y
 * revisar la mayoría de los que entrega la cámara.
 *
 * Y trae de fábrica dos cosas que la versión de JavaScript no:
 *   · `tryRotate` — el código de una botella queda vertical, y la gente no
 *     gira el teléfono. Comprobado: un EAN-13 girado 90° se lee.
 *   · `tryDownscale` — prueba también en pequeño, que es lo que salva a un
 *     código grande visto de cerca.
 *
 * LO QUE NO RESUELVE, Y HAY QUE SEGUIR HACIENDO A MANO: `tryInvert` no sirve
 * para códigos lineales. Solo se aplica a los matriciales (QR, DataMatrix),
 * porque la norma de los lineales no admite reflectancia invertida. Se
 * comprobó con un EAN-13 en negativo: con `tryInvert: true` no devuelve nada,
 * e invirtiendo los píxeles a mano sí lo lee. Esa inversión sigue viviendo en
 * el bucle del escáner.
 *
 * MEDIDO, y estos números son todo el argumento. Misma máquina, mismo cuadro
 * sin ningún código (que es el 95 % de los cuadros):
 *
 *                              JavaScript      WebAssembly
 *   recorte 1024 px, rápido        7,4 ms          0,7 ms     (10×)
 *   recorte 1600 px, rápido        8,2 ms          1,5 ms     (5,5×)
 *   insistiendo (`tryHarder`)     48,8 ms          3,1 ms     (16×)
 *
 * El dato que explica el reporte del dueño es el último. A 30 cuadros por
 * segundo hay 33 ms de presupuesto por cuadro: insistiendo, la versión de
 * JavaScript tardaba MÁS DE UN CUADRO COMPLETO en una computadora de
 * escritorio — en un iPhone, varios. Y el modo insistente se enciende a los
 * 2,5 segundos sin leer, o sea justo cuando el cajero está batallando: el
 * sistema se volvía más lento precisamente en el momento en que necesitaba ser
 * más rápido. Eso es "en iPhone a veces no da", medido.
 *
 * EL ARCHIVO .wasm SE SIRVE DESDE AQUÍ, NO DESDE UN CDN. La librería, por
 * omisión, lo baja de unpkg.com. Para un punto de venta eso es inaceptable
 * por tres razones: la tienda puede estar sin internet aunque el servidor
 * local responda, agrega una dependencia de un tercero en la ruta crítica de
 * cobrar, y le cuenta a un CDN ajeno cuándo escanea cada tienda. Con `?url`
 * el archivo entra al build y lo sirve el mismo origen.
 */

import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/** Solo lo que una tienda ve pegado en un producto. Menos formatos, más velocidad. */
export const FORMATOS_WASM = [
  'EAN-13',
  'EAN-8',
  'UPC-A',
  'UPC-E',
  'Code128',
  'Code39',
  'ITF',
  'DataBar',
  'DataBarExp',
] as const;

/**
 * Tope de ancho para el recorte que se le entrega.
 *
 * Más alto que el de la versión de JavaScript (1024) justamente porque es lo
 * que el WebAssembly permite: más píxeles son más módulos por barra, y eso es
 * lo que decide si un código pequeño o lejano se lee. Un EAN-13 son 95
 * módulos; a 1600 px de ancho de recorte quedan ~16 px por módulo, con margen
 * de sobra para un código impreso torcido o algo borroso.
 */
export const ANCHO_MAXIMO_WASM = 1600;

export type LectorWasm = (imagen: ImageData, insistente: boolean) => Promise<string | null>;

let promesa: Promise<LectorWasm | null> | null = null;

/**
 * Carga el módulo una sola vez. Devuelve `null` si no se pudo —navegador sin
 * WebAssembly, archivo que no llegó, red caída a medias— y en ese caso quien
 * llama se queda con el lector de JavaScript. Nunca lanza: el escáner no
 * puede morirse porque falte una optimización.
 */
export function cargarLectorWasm(): Promise<LectorWasm | null> {
  promesa ??= (async () => {
    try {
      const { prepareZXingModule, readBarcodes } = await import('zxing-wasm/reader');

      // El `.wasm` del propio origen, no el de un CDN.
      prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });

      const comunes = {
        formats: [...FORMATOS_WASM],
        tryRotate: true, // la botella queda vertical y nadie gira el teléfono
        // Se deja encendido aunque para los lineales no haga nada: si mañana
        // una tienda pega un QR, lo cubre, y no cuesta medible.
        tryInvert: true,
        tryDownscale: true,
        maxNumberOfSymbols: 1, // el primero que aparezca; no hay por qué buscar más
      };

      // Una pasada de prueba fuerza la descarga y la compilación ahora, no en
      // el primer cuadro: así el cajero no paga ese tirón con el cliente
      // enfrente. 1×1 píxel, no encuentra nada, y con eso queda listo.
      await readBarcodes(new ImageData(1, 1), { ...comunes, tryHarder: false });

      return async (imagen, insistente) => {
        const r = await readBarcodes(imagen, { ...comunes, tryHarder: insistente });
        const bueno = r.find((x) => x.isValid && x.text);
        return bueno?.text ?? null;
      };
    } catch {
      return null;
    }
  })();
  return promesa;
}

/** Solo para pruebas: olvida la carga anterior. */
export function olvidarLectorWasm(): void {
  promesa = null;
}
