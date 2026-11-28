import { describe, expect, it } from 'vitest';
import {
  CLAVE_ACTIVIDAD,
  CLAVE_AL_CERRAR,
  CLAVE_MINUTOS,
  MINUTOS_POR_OMISION,
  MS_DE_AVISO,
  cierraAlCerrarPestana,
  etiquetaMinutos,
  faltaParaCerrar,
  marcarActividad,
  minutosDeInactividad,
  minutosGuardados,
  tocaAvisar,
  tocaCerrar,
  ultimaActividad,
} from './sesion';

/** Almacén de mentira, como en las pruebas del carrito. */
function almacen(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    leer: (k: string) => datos.get(k) ?? null,
  };
}

const MIN = 60_000;

describe('cuánto falta para cerrar la sesión', () => {
  it('cuenta desde la última actividad, no desde que se abrió', () => {
    const inicio = 1_000_000;
    expect(faltaParaCerrar(inicio, inicio, 30)).toBe(30 * MIN);
    expect(faltaParaCerrar(inicio, inicio + 29 * MIN, 30)).toBe(MIN);
    expect(faltaParaCerrar(inicio, inicio + 30 * MIN, 30)).toBe(0);
  });

  it('"Nunca" es sin límite, no cero', () => {
    // Confundir los dos sería el peor error posible: cerraría la sesión de
    // inmediato justo a quien pidió que no se cerrara nunca.
    expect(faltaParaCerrar(1_000_000, 1_000_000 + 999 * MIN, 0)).toBe(Infinity);
    expect(tocaCerrar(1_000_000, 1_000_000 + 999 * MIN, 0)).toBe(false);
    expect(tocaAvisar(1_000_000, 1_000_000 + 999 * MIN, 0)).toBe(false);
  });

  it('cierra al cumplirse el plazo, no antes', () => {
    const t = 5_000_000;
    expect(tocaCerrar(t, t + 30 * MIN - 1, 30)).toBe(false);
    expect(tocaCerrar(t, t + 30 * MIN, 30)).toBe(true);
    expect(tocaCerrar(t, t + 90 * MIN, 30)).toBe(true);
  });

  it('avisa un minuto antes, y solo en esa ventana', () => {
    const t = 5_000_000;
    expect(tocaAvisar(t, t + 28 * MIN, 30)).toBe(false); // todavía no
    expect(tocaAvisar(t, t + 29 * MIN, 30)).toBe(true); // falta 1 min
    expect(tocaAvisar(t, t + 30 * MIN, 30)).toBe(false); // ya venció: se cierra
    expect(MS_DE_AVISO).toBe(MIN);
  });

  it('un plazo más corto que el aviso no deja la sesión sin cerrar', () => {
    // Si el aviso durara más que el plazo, el estado "avisando" nunca se
    // alcanzaría y habría que cerrar directo. Se comprueba que cierra.
    const t = 5_000_000;
    expect(tocaCerrar(t, t + MIN, 1)).toBe(true);
  });
});

describe('la última actividad', () => {
  it('sin dato guardado, una pestaña recién abierta no nace vencida', () => {
    const ahora = 9_000_000;
    expect(ultimaActividad(ahora, almacen())).toBe(ahora);
  });

  it('toma la que escribió otra pestaña del mismo equipo', () => {
    // Trabajar en la pestaña del punto de venta tiene que contar como
    // actividad en la de reportes: si no, la segunda cerraría sesión a las
    // dos y expulsaría de las dos.
    const ahora = 9_000_000;
    const a = almacen({ [CLAVE_ACTIVIDAD]: String(ahora - 5 * MIN) });
    expect(ultimaActividad(ahora, a)).toBe(ahora - 5 * MIN);
  });

  it('un dato del futuro no regala una sesión eterna', () => {
    // Pasa de verdad: el reloj del equipo se corrige y el valor guardado
    // queda adelantado. Sin el tope, la sesión no cerraría nunca.
    const ahora = 9_000_000;
    const a = almacen({ [CLAVE_ACTIVIDAD]: String(ahora + 10 * 60 * MIN) });
    expect(ultimaActividad(ahora, a)).toBe(ahora);
  });

  it('un dato corrupto se ignora sin romper nada', () => {
    const ahora = 9_000_000;
    expect(ultimaActividad(ahora, almacen({ [CLAVE_ACTIVIDAD]: 'ayer' }))).toBe(ahora);
    expect(ultimaActividad(ahora, almacen({ [CLAVE_ACTIVIDAD]: '-5' }))).toBe(ahora);
  });

  it('se escribe para que las otras pestañas la vean', () => {
    const a = almacen();
    marcarActividad(1_234_567, a);
    expect(a.leer(CLAVE_ACTIVIDAD)).toBe('1234567');
  });
});

describe('la preferencia de este equipo', () => {
  it('sin elegir nada son 30 minutos', () => {
    expect(minutosGuardados(almacen())).toBeNull();
    expect(minutosDeInactividad(almacen())).toBe(MINUTOS_POR_OMISION);
    expect(MINUTOS_POR_OMISION).toBe(30);
  });

  it('lo elegido manda, incluido "Nunca"', () => {
    expect(minutosDeInactividad(almacen({ [CLAVE_MINUTOS]: '15' }))).toBe(15);
    expect(minutosDeInactividad(almacen({ [CLAVE_MINUTOS]: '0' }))).toBe(0);
  });

  it('un valor corrupto cae al predeterminado, no a "nunca" ni a cero', () => {
    // Las dos interpretaciones equivocadas son malas en direcciones opuestas:
    // una deja la sesión abierta para siempre y la otra expulsa al instante.
    expect(minutosDeInactividad(almacen({ [CLAVE_MINUTOS]: 'mucho' }))).toBe(MINUTOS_POR_OMISION);
    expect(minutosDeInactividad(almacen({ [CLAVE_MINUTOS]: '-10' }))).toBe(MINUTOS_POR_OMISION);
  });

  it('cerrar al cerrar la pestaña viene apagado', () => {
    // Apagado a propósito: el sistema de un teléfono descarta pestañas en
    // segundo plano, así que encenderlo por omisión expulsaría al cajero que
    // se fue a WhatsApp y volvió.
    expect(cierraAlCerrarPestana(almacen())).toBe(false);
    expect(cierraAlCerrarPestana(almacen({ [CLAVE_AL_CERRAR]: '1' }))).toBe(true);
    expect(cierraAlCerrarPestana(almacen({ [CLAVE_AL_CERRAR]: '0' }))).toBe(false);
  });

  it('sin almacén disponible el sistema sigue funcionando', () => {
    // Navegación privada o cookies bloqueadas: la preferencia no se guarda,
    // pero la sesión no puede quedar sin límite por eso.
    expect(minutosDeInactividad(null)).toBe(MINUTOS_POR_OMISION);
    expect(cierraAlCerrarPestana(null)).toBe(false);
  });

  it('las etiquetas se leen como las diría una persona', () => {
    expect(etiquetaMinutos(0)).toBe('Nunca');
    expect(etiquetaMinutos(15)).toBe('15 minutos');
    expect(etiquetaMinutos(60)).toBe('1 hora');
    expect(etiquetaMinutos(240)).toBe('4 horas');
  });
});
