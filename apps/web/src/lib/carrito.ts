/**
 * Persistencia del carrito del punto de venta.
 *
 * EL PROBLEMA. El carrito vivía en un `useState` de la pantalla de Vender.
 * Ir a Productos a consultar una existencia, o recargar sin querer, lo
 * borraba entero y sin aviso, con el cliente enfrente y los productos ya
 * pasados por el lector.
 *
 * POR QUÉ localStorage Y NO SOLO UN CONTEXTO. Un contexto de React sobrevive
 * a cambiar de pantalla, pero no a recargar la página ni a que el navegador
 * descarte la pestaña — y en una tienda eso pasa: se va la luz del monitor,
 * alguien cierra sin querer, la PWA se reinicia. El disco cubre los dos
 * casos con menos piezas.
 *
 * POR TIENDA Y POR CAJA. Dos cajas de la misma tienda son dos mostradores
 * distintos; mezclar sus carritos sería peor que perderlos.
 *
 * SOBRE LOS PRECIOS GUARDADOS. Se guarda el producto completo para poder
 * pintar el carrito sin volver a pedirlo. Si el precio cambió mientras el
 * carrito estaba guardado, lo que se ve podría quedar viejo un instante —
 * pero el cobro NO: la venta se liquida con los precios del servidor
 * (§6.1), así que nunca se cobra de menos por esto.
 *
 * VIGENCIA. Un carrito de ayer no debe revivir hoy: a las 12 horas se
 * descarta. Es más que un turno y menos que un día.
 */

const PREFIJO = 'mm.carrito';
const VIGENCIA_MS = 12 * 60 * 60 * 1000;

interface Guardado<T> {
  guardadoEn: number;
  lineas: T[];
}

/** Almacén inyectable: en las pruebas no hay `localStorage`. */
export type Almacen = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function almacenPorOmision(): Almacen | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Navegación privada o cookies bloqueadas: el carrito funciona igual,
    // solo que sin sobrevivir a la recarga.
    return null;
  }
}

export function claveCarrito(storeId: string, registerId: string): string {
  return `${PREFIJO}.${storeId}.${registerId}`;
}

export function leerCarrito<T>(
  storeId: string,
  registerId: string,
  almacen: Almacen | null = almacenPorOmision(),
  ahora: number = Date.now(),
): T[] {
  if (!almacen || !storeId || !registerId) return [];
  try {
    const crudo = almacen.getItem(claveCarrito(storeId, registerId));
    if (!crudo) return [];
    const datos = JSON.parse(crudo) as Partial<Guardado<T>>;
    if (!Array.isArray(datos.lineas)) return [];
    if (typeof datos.guardadoEn !== 'number' || ahora - datos.guardadoEn > VIGENCIA_MS) {
      almacen.removeItem(claveCarrito(storeId, registerId));
      return [];
    }
    return datos.lineas;
  } catch {
    // Contenido corrupto: se descarta en silencio. Un carrito ilegible no
    // puede impedir que la caja abra.
    return [];
  }
}

export function guardarCarrito<T>(
  storeId: string,
  registerId: string,
  lineas: T[],
  almacen: Almacen | null = almacenPorOmision(),
  ahora: number = Date.now(),
): void {
  if (!almacen || !storeId || !registerId) return;
  try {
    if (lineas.length === 0) {
      almacen.removeItem(claveCarrito(storeId, registerId));
      return;
    }
    const datos: Guardado<T> = { guardadoEn: ahora, lineas };
    almacen.setItem(claveCarrito(storeId, registerId), JSON.stringify(datos));
  } catch {
    /* almacenamiento lleno o bloqueado: se sigue vendiendo sin persistencia */
  }
}

export function limpiarCarrito(
  storeId: string,
  registerId: string,
  almacen: Almacen | null = almacenPorOmision(),
): void {
  if (!almacen || !storeId || !registerId) return;
  try {
    almacen.removeItem(claveCarrito(storeId, registerId));
  } catch {
    /* nada que hacer */
  }
}
