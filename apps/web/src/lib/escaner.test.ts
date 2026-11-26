import { describe, expect, it } from 'vitest';
import {
  CADA_CUANTOS_CUADRO_COMPLETO,
  cambiarLinterna,
  escalaParaDecodificar,
  leerCapacidades,
  regionDeInteres,
  tocaCuadroCompleto,
} from './escaner';

describe('región de interés', () => {
  it('recorta la franja central y reduce el trabajo por cuadro', () => {
    const r = regionDeInteres(1920, 1080);
    expect(r).toEqual({ x: 96, y: 335, ancho: 1728, alto: 410 });

    // La razón de ser del recorte: analizar una fracción de los píxeles.
    const completo = 1920 * 1080;
    const recortado = r.ancho * r.alto;
    expect(recortado / completo).toBeLessThan(0.36);
  });

  it('queda centrada en cualquier proporción', () => {
    const tamanos: [number, number][] = [
      [640, 480],
      [1280, 720],
      [720, 1280],
    ];
    for (const [w, h] of tamanos) {
      const r = regionDeInteres(w, h);
      expect(r.x * 2 + r.ancho).toBeCloseTo(w, 0);
      expect(r.y * 2 + r.alto).toBeCloseTo(h, 0);
    }
  });

  it('un vídeo sin dimensiones no produce un recorte inválido', () => {
    // `videoWidth` es 0 hasta que llega el primer cuadro; un canvas de 0×0
    // lanza al dibujar y mataría el bucle de escaneo en el arranque.
    const r = regionDeInteres(0, 0);
    expect(r.ancho).toBeGreaterThan(0);
    expect(r.alto).toBeGreaterThan(0);
  });

  it('nunca se sale del cuadro', () => {
    const r = regionDeInteres(100, 100, 2, 2);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.ancho).toBeLessThanOrEqual(100);
    expect(r.y + r.alto).toBeLessThanOrEqual(100);
  });
});

describe('intercalado del cuadro completo', () => {
  it('mira el cuadro entero cada tantos, para perdonar la mala puntería', () => {
    const completos = Array.from({ length: 20 }, (_, i) => i).filter(tocaCuadroCompleto);
    expect(completos).toEqual([0, 5, 10, 15]);
    expect(CADA_CUANTOS_CUADRO_COMPLETO).toBe(5);
  });
});

describe('capacidades de la cámara', () => {
  function pista(caps: unknown, lanza = false): MediaStreamTrack {
    return {
      getCapabilities: () => {
        if (lanza) throw new Error('no soportado');
        return caps;
      },
    } as unknown as MediaStreamTrack;
  }

  it('detecta linterna, zoom y enfoque continuo', () => {
    const c = leerCapacidades(
      pista({ torch: true, zoom: { min: 1, max: 4, step: 0.5 }, focusMode: ['continuous', 'manual'] }),
    );
    expect(c).toEqual({
      linterna: true,
      zoom: { min: 1, max: 4, paso: 0.5 },
      enfoqueContinuo: true,
    });
  });

  it('una cámara sin extras no inventa capacidades', () => {
    expect(leerCapacidades(pista({}))).toEqual({
      linterna: false,
      zoom: null,
      enfoqueContinuo: false,
    });
  });

  it('un navegador que lanza al consultar no rompe el escáner', () => {
    // Safari lanza en algunas versiones; la cámara tiene que abrir igual,
    // solo que sin botón de linterna.
    expect(leerCapacidades(pista(null, true)).linterna).toBe(false);
    expect(leerCapacidades(null).linterna).toBe(false);
  });

  it('sin getCapabilities tampoco falla', () => {
    expect(leerCapacidades({} as MediaStreamTrack).zoom).toBeNull();
  });
});

describe('linterna', () => {
  it('pide torch por restricción avanzada', async () => {
    const aplicadas: MediaTrackConstraints[] = [];
    const track = {
      applyConstraints: async (c: MediaTrackConstraints) => {
        aplicadas.push(c);
      },
    } as unknown as MediaStreamTrack;

    expect(await cambiarLinterna(track, true)).toBe(true);
    expect(aplicadas).toEqual([{ advanced: [{ torch: true }] }]);
  });

  it('si el equipo no la soporta devuelve false en vez de reventar', async () => {
    const track = {
      applyConstraints: async () => {
        throw new Error('OverconstrainedError');
      },
    } as unknown as MediaStreamTrack;

    expect(await cambiarLinterna(track, true)).toBe(false);
    expect(await cambiarLinterna(null, true)).toBe(false);
  });
});

describe('escala de decodificación para ZXing', () => {
  it('reduce los recortes grandes y deja los chicos en paz', () => {
    // 1728 es el recorte de un vídeo 1080p: se baja a 1024.
    expect(escalaParaDecodificar(1728)).toBeCloseTo(1024 / 1728, 5);
    expect(Math.round(1728 * escalaParaDecodificar(1728))).toBe(1024);

    // Nunca amplía: agrandar no inventa detalle, solo trabajo.
    expect(escalaParaDecodificar(640)).toBe(1);
    expect(escalaParaDecodificar(1024)).toBe(1);
    expect(escalaParaDecodificar(0)).toBe(1);
  });

  it('deja píxeles de sobra para un EAN-13', () => {
    // 95 módulos; con el código ocupando un tercio del recorte reducido,
    // quedan ~3 px por módulo incluso en el peor caso aceptado.
    const anchoFinal = 1728 * escalaParaDecodificar(1728);
    const pixelesPorModulo = (anchoFinal / 3) / 95;
    expect(pixelesPorModulo).toBeGreaterThan(3);
  });
});
