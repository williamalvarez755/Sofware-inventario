import { describe, expect, it } from 'vitest';
import { type Almacen, claveCarrito, guardarCarrito, leerCarrito, limpiarCarrito } from './carrito';

/** Almacén de mentira: un Map, y uno que se puede romper a voluntad. */
function almacenFalso(roto = false): Almacen & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k) => {
      if (roto) throw new Error('bloqueado');
      return datos.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (roto) throw new Error('bloqueado');
      datos.set(k, v);
    },
    removeItem: (k) => {
      if (roto) throw new Error('bloqueado');
      datos.delete(k);
    },
  };
}

interface Linea {
  id: string;
  qty: number;
}
const LINEAS: Linea[] = [
  { id: 'coca', qty: 2 },
  { id: 'pan', qty: 1 },
];

describe('persistencia del carrito', () => {
  it('lo que se guarda se recupera igual', () => {
    // Es la prueba del fallo reportado: agregar, irse a otra pantalla y
    // volver. Volver = leer con un componente recién montado.
    const a = almacenFalso();
    guardarCarrito('t1', 'c1', LINEAS, a);
    expect(leerCarrito<Linea>('t1', 'c1', a)).toEqual(LINEAS);
  });

  it('cada caja tiene el suyo', () => {
    const a = almacenFalso();
    guardarCarrito('t1', 'c1', LINEAS, a);
    guardarCarrito('t1', 'c2', [{ id: 'arroz', qty: 3 }], a);

    expect(leerCarrito<Linea>('t1', 'c1', a)).toEqual(LINEAS);
    expect(leerCarrito<Linea>('t1', 'c2', a)).toEqual([{ id: 'arroz', qty: 3 }]);
    expect(leerCarrito<Linea>('t2', 'c1', a)).toEqual([]);
  });

  it('un carrito de hace más de 12 horas no revive', () => {
    const a = almacenFalso();
    const ayer = Date.UTC(2026, 10, 23, 20, 0, 0);
    guardarCarrito('t1', 'c1', LINEAS, a, ayer);

    const onceHoras = ayer + 11 * 60 * 60 * 1000;
    expect(leerCarrito<Linea>('t1', 'c1', a, onceHoras)).toEqual(LINEAS);

    const treceHoras = ayer + 13 * 60 * 60 * 1000;
    expect(leerCarrito<Linea>('t1', 'c1', a, treceHoras)).toEqual([]);
    // Y además se borra, para no arrastrar basura.
    expect(a.datos.has(claveCarrito('t1', 'c1'))).toBe(false);
  });

  it('guardar vacío equivale a limpiar', () => {
    const a = almacenFalso();
    guardarCarrito('t1', 'c1', LINEAS, a);
    guardarCarrito('t1', 'c1', [], a);
    expect(a.datos.has(claveCarrito('t1', 'c1'))).toBe(false);
  });

  it('limpiar borra solo esa caja', () => {
    const a = almacenFalso();
    guardarCarrito('t1', 'c1', LINEAS, a);
    guardarCarrito('t1', 'c2', LINEAS, a);
    limpiarCarrito('t1', 'c1', a);

    expect(leerCarrito<Linea>('t1', 'c1', a)).toEqual([]);
    expect(leerCarrito<Linea>('t1', 'c2', a)).toEqual(LINEAS);
  });

  it('contenido corrupto no rompe la caja', () => {
    const a = almacenFalso();
    a.datos.set(claveCarrito('t1', 'c1'), '{esto no es json');
    expect(leerCarrito<Linea>('t1', 'c1', a)).toEqual([]);
  });

  it('sin almacenamiento disponible sigue funcionando', () => {
    // Navegación privada, cookies bloqueadas o almacenamiento lleno: se
    // pierde la persistencia, nunca la venta.
    const roto = almacenFalso(true);
    expect(() => guardarCarrito('t1', 'c1', LINEAS, roto)).not.toThrow();
    expect(leerCarrito<Linea>('t1', 'c1', roto)).toEqual([]);
    expect(() => limpiarCarrito('t1', 'c1', roto)).not.toThrow();
    expect(leerCarrito<Linea>('t1', 'c1', null)).toEqual([]);
  });

  it('sin tienda o sin caja no guarda nada', () => {
    // Al entrar, `storeId` llega vacío un instante; no debe escribir una
    // clave basura como "mm.carrito..".
    const a = almacenFalso();
    guardarCarrito('', '', LINEAS, a);
    expect(a.datos.size).toBe(0);
  });
});
