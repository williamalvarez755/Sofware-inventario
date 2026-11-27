import { describe, expect, it } from 'vitest';
import {
  CLAVE_LECTOR,
  SOLO_TACTIL,
  enfocarAbreTeclado,
  guardarLector,
  lectorGuardado,
  usaLectorFisico,
} from './teclado';

/** Navegador de mentira: responde a una sola consulta y anota qué se le pidió. */
function medios(respuesta: boolean, pedidas: string[] = []) {
  return (consulta: string) => {
    pedidas.push(consulta);
    return respuesta;
  };
}

const TELEFONO = medios(true);
const COMPUTADORA = medios(false);

/** Almacén de mentira, y uno que se puede romper a voluntad. */
function almacenFalso(roto = false) {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k: string) => {
      if (roto) throw new Error('bloqueado');
      return datos.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (roto) throw new Error('bloqueado');
      datos.set(k, v);
    },
  };
}

describe('enfocarAbreTeclado (la heurística)', () => {
  it('en un teléfono o tableta sin mouse, sí', () => {
    expect(enfocarAbreTeclado(TELEFONO)).toBe(true);
  });

  it('en una computadora, no', () => {
    expect(enfocarAbreTeclado(COMPUTADORA)).toBe(false);
  });

  it('pregunta por el dedo como ÚNICO puntero, no solo por el táctil', () => {
    // Si preguntara solo `(pointer: coarse)`, un portátil con pantalla táctil
    // daría positivo — y ahí el teclado es físico, así que el foco automático
    // es justo lo que se quiere conservar.
    const pedidas: string[] = [];
    enfocarAbreTeclado(medios(true, pedidas));
    expect(pedidas).toEqual([SOLO_TACTIL]);
    expect(SOLO_TACTIL).toContain('hover: none');
    expect(SOLO_TACTIL).toContain('pointer: coarse');
  });

  it('sin matchMedia no se inventa nada: deja el foco como siempre', () => {
    expect(enfocarAbreTeclado(null)).toBe(false);
  });

  it('si la consulta revienta, tampoco se cae la pantalla', () => {
    expect(
      enfocarAbreTeclado(() => {
        throw new Error('no soportado');
      }),
    ).toBe(false);
  });
});

describe('el interruptor manda sobre la heurística', () => {
  it('sin tocar nada, una computadora sí usa lector y un teléfono no', () => {
    // Es el valor inicial: nadie debería tener que configurar nada el primer
    // día para que el mostrador funcione.
    expect(usaLectorFisico(almacenFalso(), COMPUTADORA)).toBe(true);
    expect(usaLectorFisico(almacenFalso(), TELEFONO)).toBe(false);
  });

  it('un lector Bluetooth en el teléfono: se enciende y manda', () => {
    // El caso que el interruptor existe para resolver. La heurística diría
    // que no, porque sigue siendo un teléfono — y se equivocaría.
    const a = almacenFalso();
    guardarLector(true, a);
    expect(usaLectorFisico(a, TELEFONO)).toBe(true);
  });

  it('una computadora sin lector: se apaga y también manda', () => {
    const a = almacenFalso();
    guardarLector(false, a);
    expect(usaLectorFisico(a, COMPUTADORA)).toBe(false);
  });

  it('apagarlo se distingue de no haberlo tocado', () => {
    // `false` guardado y `null` sin guardar dan lo mismo en una computadora,
    // así que si no se distinguieran el error pasaría inadvertido: en un
    // TELÉFONO, no haberlo tocado es `false` y encenderlo es `true`.
    const a = almacenFalso();
    expect(lectorGuardado(a)).toBeNull();
    guardarLector(false, a);
    expect(lectorGuardado(a)).toBe(false);
    guardarLector(true, a);
    expect(lectorGuardado(a)).toBe(true);
  });

  it('se guarda por equipo, bajo su propia clave', () => {
    const a = almacenFalso();
    guardarLector(true, a);
    expect(a.datos.get(CLAVE_LECTOR)).toBe('1');
  });

  it('con el almacén bloqueado no revienta: se cae a la heurística', () => {
    // Navegación privada. Peor es que el punto de venta no abra.
    const roto = almacenFalso(true);
    expect(() => guardarLector(true, roto)).not.toThrow();
    expect(usaLectorFisico(roto, TELEFONO)).toBe(false);
    expect(usaLectorFisico(roto, COMPUTADORA)).toBe(true);
  });
});
