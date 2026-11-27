import { describe, expect, it } from 'vitest';
import { SOLO_TACTIL, enfocarAbreTeclado } from './teclado';

/** Navegador de mentira: responde a una sola consulta y registra qué se le pidió. */
function medios(respuesta: boolean, pedidas: string[] = []) {
  return (consulta: string) => {
    pedidas.push(consulta);
    return respuesta;
  };
}

describe('enfocarAbreTeclado', () => {
  it('en un teléfono o tableta sin mouse, sí', () => {
    expect(enfocarAbreTeclado(medios(true))).toBe(true);
  });

  it('en una computadora, no', () => {
    expect(enfocarAbreTeclado(medios(false))).toBe(false);
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
    // Es el caso del render en servidor y el de las pruebas: ante la duda, el
    // comportamiento de toda la vida.
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
