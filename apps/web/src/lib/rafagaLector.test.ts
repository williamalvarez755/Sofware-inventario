import { describe, expect, it } from 'vitest';
import { crearDetectorDeRafaga } from './rafagaLector';

/** Teclea una cadena con un intervalo fijo y devuelve lo que se detectó. */
function teclear(
  detector: ReturnType<typeof crearDetectorDeRafaga>,
  texto: string,
  msEntreTeclas: number,
  desde = 1000,
): string | null {
  let t = desde;
  let resultado: string | null = null;
  for (const c of texto) {
    t += msEntreTeclas;
    resultado = detector.tecla(c, t) ?? resultado;
  }
  return resultado;
}

describe('ráfaga del lector físico', () => {
  it('reconoce un EAN-13 tecleado a velocidad de máquina', () => {
    const d = crearDetectorDeRafaga();
    expect(teclear(d, '7401000000017', 4)).toBeNull(); // todavía sin Enter
    expect(d.tecla('Enter', 1056)).toBe('7401000000017');
  });

  it('NO reacciona a una persona escribiendo', () => {
    // Es la prueba que permite escuchar el teclado entero sin romper los
    // demás campos: nadie sostiene 120 ms por tecla y pasa por lector.
    const d = crearDetectorDeRafaga();
    let t = 1000;
    for (const c of '7401000000017') {
      t += 120;
      d.tecla(c, t);
    }
    expect(d.tecla('Enter', t + 120)).toBeNull();
  });

  it('una pausa en medio descarta lo anterior y empieza de nuevo', () => {
    // Pasa de verdad: el cajero teclea medio código, lo piensa, y después
    // dispara el lector. Lo viejo no puede quedar pegado adelante.
    const d = crearDetectorDeRafaga();
    teclear(d, '999', 4, 1000);
    const resultado = teclear(d, '7401000000017', 4, 9000);
    expect(resultado).toBeNull();
    expect(d.parcial()).toBe('7401000000017');
    expect(d.tecla('Enter', 9060)).toBe('7401000000017');
  });

  it('el Enter tardío tampoco cuenta', () => {
    // Alguien pegó un código y presionó Enter después: no fue un lector, y
    // tratarlo como tal podría cobrar algo que nadie escaneó.
    const d = crearDetectorDeRafaga();
    teclear(d, '7401000000017', 4);
    expect(d.tecla('Enter', 5000)).toBeNull();
  });

  it('ignora las teclas que no son caracteres', () => {
    const d = crearDetectorDeRafaga();
    let t = 1000;
    for (const k of ['Shift', '7', 'Control', '4', 'F5', '0', '1']) {
      t += 4;
      d.tecla(k, t);
    }
    expect(d.parcial()).toBe('7401');
  });

  it('descarta ráfagas demasiado cortas', () => {
    // Un Enter suelto, o dos teclas rápidas, no son un producto.
    const d = crearDetectorDeRafaga();
    teclear(d, '12', 4);
    expect(d.tecla('Enter', 1012)).toBeNull();
  });

  it('acepta códigos con letras, como los internos de proveedor', () => {
    const d = crearDetectorDeRafaga();
    teclear(d, 'ABC-1234', 4);
    expect(d.tecla('Enter', 1040)).toBe('ABC-1234');
  });

  it('dos escaneos seguidos entran los dos', () => {
    // El cajero pasa productos sin pausa; el segundo no puede arrastrar
    // restos del primero.
    const d = crearDetectorDeRafaga();
    teclear(d, '7401000000017', 4, 1000);
    expect(d.tecla('Enter', 1056)).toBe('7401000000017');
    teclear(d, '7441029111234', 4, 1100);
    expect(d.tecla('Enter', 1156)).toBe('7441029111234');
  });

  it('los umbrales se pueden ajustar', () => {
    const d = crearDetectorDeRafaga({ msEntreTeclas: 200, largoMinimo: 3 });
    teclear(d, 'abc', 150);
    expect(d.tecla('Enter', 1600)).toBe('abc');
  });
});
