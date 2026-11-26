/**
 * Piezas del escáner por cámara que se pueden razonar (y probar) sin cámara.
 *
 * El componente se queda con lo que necesita un `<video>` de verdad; aquí
 * vive la aritmética y el acceso a las capacidades del hardware, que es
 * donde estaban los problemas de velocidad.
 */

/** Rectángulo en píxeles del cuadro de vídeo. */
export interface Region {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

/**
 * Región de interés: la franja central donde el cajero apunta el código.
 *
 * POR QUÉ. Decodificar el cuadro completo de 1920×1080 es ~8 veces más
 * trabajo que decodificar la franja central, y el 95 % de esos píxeles son
 * el mostrador, la mano y el resto del empaque. Recortar es la diferencia
 * entre analizar 2 millones de píxeles por cuadro y analizar 250 mil.
 *
 * La franja es generosa a propósito (90 % de ancho, 38 % de alto): apretarla
 * más obligaría a apuntar con precisión, y quien escanea lo hace de prisa y
 * sin mirar la pantalla.
 */
export function regionDeInteres(
  ancho: number,
  alto: number,
  fraccionAncho = 0.9,
  fraccionAlto = 0.38,
): Region {
  // Nunca menos de 1 px ni más que el cuadro: un vídeo que todavía no tiene
  // dimensiones reporta 0 y reventaría el recorte del canvas.
  const w = Math.max(1, Math.min(ancho, Math.round(ancho * fraccionAncho)));
  const h = Math.max(1, Math.min(alto, Math.round(alto * fraccionAlto)));
  return {
    x: Math.max(0, Math.round((ancho - w) / 2)),
    y: Math.max(0, Math.round((alto - h) / 2)),
    ancho: w,
    alto: h,
  };
}

/**
 * Cada cuántos cuadros conviene mirar el cuadro COMPLETO en vez de la franja.
 *
 * El recorte acelera, pero castiga a quien apunta mal: si el código quedó
 * arriba del recuadro, no se lee nunca. Intercalar un cuadro completo cada
 * tantos recupera esa tolerancia sin perder la velocidad del recorte.
 */
export const CADA_CUANTOS_CUADRO_COMPLETO = 5;

export function tocaCuadroCompleto(numeroDeCuadro: number): boolean {
  return numeroDeCuadro % CADA_CUANTOS_CUADRO_COMPLETO === 0;
}

// ─────────────────────────── Capacidades del hardware ───────────────────────

/** Lo que una pista de vídeo puede ofrecer, según el navegador. */
export interface Capacidades {
  linterna: boolean;
  zoom: { min: number; max: number; paso: number } | null;
  enfoqueContinuo: boolean;
}

type CapsCrudas = MediaTrackCapabilities & {
  torch?: boolean;
  zoom?: { min: number; max: number; step?: number };
  focusMode?: string[];
};

export function leerCapacidades(track: MediaStreamTrack | null): Capacidades {
  const vacias: Capacidades = { linterna: false, zoom: null, enfoqueContinuo: false };
  if (!track?.getCapabilities) return vacias;
  let caps: CapsCrudas;
  try {
    caps = track.getCapabilities() as CapsCrudas;
  } catch {
    // Safari lanza en algunas versiones en vez de devolver vacío.
    return vacias;
  }
  return {
    linterna: caps.torch === true,
    zoom:
      caps.zoom && typeof caps.zoom.max === 'number'
        ? { min: caps.zoom.min ?? 1, max: caps.zoom.max, paso: caps.zoom.step ?? 0.1 }
        : null,
    enfoqueContinuo: Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous'),
  };
}

/**
 * Enciende o apaga la linterna.
 *
 * Es la mejora que más se nota en una tienda de verdad: el mostrador casi
 * siempre está a contraluz o en penumbra, y un código impreso en plástico
 * brillante sin luz propia no tiene contraste suficiente para decodificarse.
 * Con la linterna, el mismo código entra al primer intento.
 *
 * `torch` solo existe en Chrome sobre Android y hay que pedirlo DESPUÉS de
 * abrir el flujo, nunca en `getUserMedia` — pedirlo antes hace fallar la
 * apertura entera en varios equipos y el cajero se queda sin cámara.
 */
export async function cambiarLinterna(
  track: MediaStreamTrack | null,
  encendida: boolean,
): Promise<boolean> {
  if (!track) return false;
  try {
    await track.applyConstraints({
      advanced: [{ torch: encendida } as MediaTrackConstraintSet],
    });
    return true;
  } catch {
    return false;
  }
}

/** Zoom óptico/digital de la cámara, para códigos pequeños o lejanos. */
export async function cambiarZoom(track: MediaStreamTrack | null, zoom: number): Promise<boolean> {
  if (!track) return false;
  try {
    await track.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Enfoque continuo.
 *
 * La causa número uno de "a veces no escanea": la cámara enfoca el fondo y
 * el código queda borroso. Por omisión muchos navegadores dejan el enfoque
 * en automático de una sola pasada; pedir `continuous` hace que vuelva a
 * enfocar cuando el cajero acerca el producto.
 */
export async function pedirEnfoqueContinuo(track: MediaStreamTrack | null): Promise<boolean> {
  if (!track) return false;
  try {
    await track.applyConstraints({
      advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Vuelve a enfocar, a pedido.
 *
 * El enfoque continuo resuelve la mayoría de los casos, pero se queda pegado
 * cuando el fondo tiene más contraste que el código — un mostrador de vidrio,
 * una bolsa brillante. Tocar la pantalla fuerza una pasada nueva, que es el
 * gesto que la gente ya hace por costumbre con la cámara del teléfono.
 *
 * Se pide `single-shot` y se vuelve a `continuous`: pedir dos veces seguidas
 * `continuous` no reinicia nada en la mayoría de los equipos.
 */
export async function reenfocar(track: MediaStreamTrack | null): Promise<void> {
  if (!track) return;
  try {
    await track.applyConstraints({
      advanced: [{ focusMode: 'single-shot' } as MediaTrackConstraintSet],
    });
    await track.applyConstraints({
      advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
    });
  } catch {
    /* el equipo no deja controlar el enfoque: el gesto simplemente no hace nada */
  }
}

const CLAVE_LINTERNA = 'mm.escaner.linterna';

/**
 * La preferencia de linterna se recuerda por equipo: una tienda oscura lo es
 * todos los días, y obligar a encenderla en cada escaneo es fricción pura.
 */
export function linternaRecordada(): boolean {
  try {
    return localStorage.getItem(CLAVE_LINTERNA) === '1';
  } catch {
    return false;
  }
}

export function recordarLinterna(encendida: boolean): void {
  try {
    localStorage.setItem(CLAVE_LINTERNA, encendida ? '1' : '0');
  } catch {
    /* sin persistencia: hay que encenderla cada vez */
  }
}

// ──────────────────────────────── Realimentación ────────────────────────────

/**
 * Pitido de confirmación.
 *
 * Se genera con el oscilador del navegador en vez de cargar un archivo: son
 * tres líneas, no pesa nada y no hay que servir un .mp3 más. El cajero
 * necesita saber que el producto entró SIN mirar la pantalla, que es como se
 * trabaja con la fila enfrente.
 */
export function pitar(frecuencia = 1760, milisegundos = 70): void {
  try {
    const Ctx: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = frecuencia;
    // Rampa de bajada: un corte seco suena a "clic" roto en los parlantes
    // malos de una tableta de tienda.
    vol.gain.setValueAtTime(0.09, ctx.currentTime);
    vol.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + milisegundos / 1000);
    osc.connect(vol).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + milisegundos / 1000);
    osc.onended = () => void ctx.close().catch(() => undefined);
  } catch {
    /* sin audio disponible: queda la vibración */
  }
}

/** Confirmación completa: sonido y vibración. */
export function confirmarEscaneo(): void {
  pitar();
  navigator.vibrate?.(60);
}

/** Aviso de código no encontrado: dos tonos graves, distinto del acierto. */
export function avisarFallo(): void {
  pitar(380, 110);
  navigator.vibrate?.([40, 60, 40]);
}

// ──────────────────────────── Elección de cámara ────────────────────────────

const CLAVE_CAMARA = 'mm.escaner.camara';

export interface Camara {
  id: string;
  etiqueta: string;
}

/**
 * Cámaras disponibles, con nombre legible.
 *
 * POR QUÉ HACE FALTA ELEGIR. Un teléfono Android moderno expone tres o cuatro
 * cámaras traseras, y `facingMode: environment` deja que el sistema elija.
 * Muchas veces elige la GRAN ANGULAR, que tiene distancia mínima de enfoque
 * de unos 10-15 cm: justo donde se pone un código de barras. El resultado es
 * "en este teléfono no escanea" aunque la cámara principal lo lea al
 * instante. Dejar cambiarla es la diferencia entre que el equipo sirva o no.
 *
 * Solo se puede enumerar con nombres DESPUÉS de conceder el permiso: antes,
 * el navegador devuelve etiquetas vacías por privacidad.
 */
export async function listarCamaras(): Promise<Camara[]> {
  try {
    const todos = await navigator.mediaDevices.enumerateDevices();
    return todos
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ id: d.deviceId, etiqueta: d.label || `Cámara ${i + 1}` }));
  } catch {
    return [];
  }
}

export function camaraRecordada(): string | null {
  try {
    return localStorage.getItem(CLAVE_CAMARA);
  } catch {
    return null;
  }
}

export function recordarCamara(deviceId: string): void {
  try {
    localStorage.setItem(CLAVE_CAMARA, deviceId);
  } catch {
    /* sin persistencia: hay que elegirla en cada escaneo */
  }
}

export function olvidarCamara(): void {
  try {
    localStorage.removeItem(CLAVE_CAMARA);
  } catch {
    /* nada que olvidar */
  }
}

/**
 * Qué tan buena es una cámara para leer un código a 15 cm, a partir de su
 * nombre. Más alto es mejor; por debajo de cero no sirve.
 *
 * POR QUÉ POR EL NOMBRE Y NO POR SUS CAPACIDADES. Porque el navegador no
 * expone la distancia mínima de enfoque de ninguna manera. Lo único que hay
 * es la etiqueta, y resulta que las etiquetas son bastante honestas: el
 * fabricante escribe "Ultra Wide", "Macro" o "Telephoto" porque es lo que la
 * cámara es.
 *
 * LO QUE SE PENALIZA Y POR QUÉ:
 *  · ULTRA GRAN ANGULAR — enfoca desde ~10 cm pero deforma y reparte los
 *    mismos píxeles en un campo tres veces más ancho: el código queda con un
 *    tercio de resolución. Es la que el sistema elige mal más seguido.
 *  · TELEOBJETIVO — no enfoca de cerca, punto. A 15 cm devuelve una mancha.
 *  · PROFUNDIDAD / INFRARROJA / MONOCROMO — no son cámaras de foto; algunas
 *    entregan 240×180.
 *  · MACRO — sí enfoca de cerca, pero en los equipos que la traen suele ser
 *    de 2 MP y de foco fijo. Se penaliza poco: es mejor que la ultra ancha.
 *
 * "Wide" a secas NO se penaliza: en un iPhone, "Back Dual Wide Camera" es la
 * cámara principal, no la ultra ancha. Penalizar esa palabra habría elegido
 * mal justo en el equipo que el dueño está probando.
 */
export function puntuarCamara(etiqueta: string): number {
  const t = etiqueta.toLowerCase();

  // La frontal nunca: aunque fuera la única, apuntarla a un producto obliga a
  // leer el código al revés y a ciegas.
  if (/front|frontal|selfie|user facing|facing front|delantera/.test(t)) return -1000;

  let p = 0;
  if (/back|rear|trasera|posterior|environment|facing back|world/.test(t)) p += 100;

  if (/ultra|ultrawide|ultra wide|gran angular|granangular/.test(t)) p -= 50;
  if (/tele|teleobjetivo|telephoto|zoom/.test(t)) p -= 40;
  if (/depth|profundidad|tof|time of flight/.test(t)) p -= 40;
  if (/infra|\bir\b|monochrom|monocrom/.test(t)) p -= 35;
  if (/macro/.test(t)) p -= 15;

  // A igualdad de todo, la etiqueta más simple es la cámara principal:
  // "Back Camera" gana a "Back Dual Wide Camera".
  p -= Math.min(10, t.split(/[\s,]+/).filter(Boolean).length);
  return p;
}

/** La mejor cámara de la lista, o `null` si ninguna sirve o no hay nombres. */
export function mejorCamaraTrasera(camaras: Camara[]): Camara | null {
  let mejor: Camara | null = null;
  let mejorP = -Infinity;
  for (const c of camaras) {
    // Sin etiqueta no hay nada que juzgar (el navegador las oculta antes de
    // conceder el permiso), y "Cámara 2" es un relleno nuestro, no un nombre.
    if (!c.etiqueta || /^cámara \d+$/i.test(c.etiqueta)) continue;
    const p = puntuarCamara(c.etiqueta);
    if (p > mejorP) {
      mejorP = p;
      mejor = c;
    }
  }
  return mejorP > 0 ? mejor : null;
}

/** Diferencia de puntaje a partir de la cual vale la pena reabrir la cámara. */
export const VENTAJA_PARA_CAMBIAR = 20;

/**
 * Si el sistema nos dio una cámara claramente peor que otra disponible,
 * devuelve la buena. Si la que tenemos ya está bien, devuelve `null`.
 *
 * Reabrir la cámara se ve: hay un parpadeo. Así que solo se hace cuando el
 * cambio importa de verdad —de la ultra ancha a la principal— y no para
 * ganar un punto de desempate.
 */
export function convieneCambiar(etiquetaActual: string | null, camaras: Camara[]): Camara | null {
  const mejor = mejorCamaraTrasera(camaras);
  if (!mejor) return null;
  if (!etiquetaActual) return mejor;
  if (mejor.etiqueta === etiquetaActual) return null;
  return puntuarCamara(mejor.etiqueta) - puntuarCamara(etiquetaActual) >= VENTAJA_PARA_CAMBIAR
    ? mejor
    : null;
}

// ───────────────────────── Por qué no hay cámara ────────────────────────────

/**
 * Explica en una frase por qué no se puede abrir la cámara.
 *
 * LA CAUSA QUE MÁS CONFUNDE, Y LA MENOS OBVIA: el navegador solo entrega la
 * cámara en un contexto seguro. Probar el sistema desde el teléfono entrando
 * a `http://192.168.1.x:5173` —que es exactamente lo que uno hace para probar
 * en la red de la tienda— deja `getUserMedia` sin existir, y el mensaje
 * genérico "no se pudo abrir la cámara" manda a buscar el problema en el
 * permiso, en el teléfono o en el código. Decirlo ahorra la tarde.
 */
export function diagnosticoSinCamara(entorno: {
  contextoSeguro: boolean;
  hayApi: boolean;
  origen?: string;
}): string {
  if (!entorno.contextoSeguro) {
    const donde = entorno.origen ? ` Está entrando por ${entorno.origen}.` : '';
    return (
      'El navegador solo permite usar la cámara en sitios seguros (https).' +
      donde +
      ' Entre por https o escriba el código a mano.'
    );
  }
  if (!entorno.hayApi) {
    return 'Este navegador no permite usar la cámara. Escriba el código a mano.';
  }
  return 'No se pudo abrir la cámara.';
}

// ───────────────────── Decodificación en JavaScript (iPhone) ────────────────

/**
 * Ancho máximo del recorte que se le entrega a ZXing.
 *
 * POR QUÉ SOLO A ZXING. El detector nativo de Chrome está compilado y traga
 * 1080p sin despeinarse; ZXing es JavaScript puro y el costo crece con cada
 * píxel. En iPhone NO EXISTE `BarcodeDetector` —Safari nunca lo implementó—,
 * así que todos los iPhone caen en ZXing y son justo los que pagan el recorte
 * grande. De ahí que "en iPhone a veces no da": no es que no lea, es que no
 * alcanza a leer antes de que la mano se mueva.
 *
 * CUÁNTO SE PUEDE BAJAR. Un EAN-13 son 95 módulos (barras y espacios). Para
 * decodificarlo con holgura hacen falta unos 3 píxeles por módulo, o sea
 * ~285 px a lo ancho del código. Con 1024 px de recorte, un código que ocupe
 * un tercio del encuadre todavía tiene 10 px por módulo. Bajar de ahí sí
 * empieza a comerse las barras finas.
 */
export const ANCHO_MAXIMO_ZXING = 1024;

/**
 * Factor por el que hay que multiplicar el recorte para que no supere el
 * ancho máximo. Nunca amplía: agrandar no inventa detalle, solo trabajo.
 */
export function escalaParaDecodificar(ancho: number, maximo = ANCHO_MAXIMO_ZXING): number {
  if (ancho <= 0) return 1;
  return Math.min(1, maximo / ancho);
}

// ─────────────────────── Luz: por qué "a veces no da" ──────────────────────

/**
 * Luminancia media de un cuadro, de 0 (negro) a 1 (blanco).
 *
 * Se mide para poder DECIR por qué no lee. Un código de barras necesita
 * contraste; si el cuadro viene oscuro, ninguna cantidad de insistencia lo
 * va a decodificar, y lo único útil es encender la linterna. Sin esta
 * medición, el escáner solo puede quedarse callado mientras falla, que es
 * exactamente lo que reportó el dueño como "en algunos entornos no da".
 *
 * Se muestrea 1 de cada 16 píxeles: la media no necesita más y recorrer un
 * cuadro entero por cada fotograma sí se nota.
 */
export function luminanciaMedia(datos: Uint8ClampedArray): number {
  if (datos.length < 4) return 1;
  let suma = 0;
  let cuenta = 0;
  // Coeficientes de luminancia percibida (Rec. 601), que es lo que importa
  // para el contraste de unas barras negras sobre fondo blanco.
  for (let i = 0; i < datos.length; i += 4 * 16) {
    suma += 0.299 * datos[i]! + 0.587 * datos[i + 1]! + 0.114 * datos[i + 2]!;
    cuenta += 1;
  }
  return cuenta === 0 ? 1 : suma / cuenta / 255;
}

/** Por debajo de esto, el problema es la luz y no el lector. */
export const UMBRAL_POCA_LUZ = 0.25;

export function hayPocaLuz(luminancia: number): boolean {
  return luminancia < UMBRAL_POCA_LUZ;
}

// ───────────────────── Modo continuo: no repetir el mismo ───────────────────

/**
 * Antirrebote por código.
 *
 * En modo continuo la cámara ve el mismo código treinta veces por segundo. Sin
 * esto, apoyar un producto frente al lente agregaría treinta unidades al
 * carrito. Se bloquea el MISMO código durante un rato, pero uno distinto entra
 * de inmediato: el cajero pasa productos seguidos sin esperar.
 */
export function crearAntirrebote(ventanaMs = 1800) {
  const vistos = new Map<string, number>();
  return {
    aceptar(codigo: string, ahora: number = Date.now()): boolean {
      const ultimo = vistos.get(codigo);
      if (ultimo !== undefined && ahora - ultimo < ventanaMs) return false;
      vistos.set(codigo, ahora);
      return true;
    },
    olvidar(codigo: string) {
      vistos.delete(codigo);
    },
  };
}

// ──────────────────────── Qué decirle a quien escanea ───────────────────────

export interface EstadoAyuda {
  msSinLeer: number;
  pocaLuz: boolean;
  linterna: boolean;
  hayLinterna: boolean;
}

/**
 * El mensaje que se muestra bajo el visor.
 *
 * Callarse mientras falla es la peor opción: quien escanea no sabe si el
 * problema es la distancia, la luz o el código. Los consejos salen en el
 * orden en que resuelven el problema más veces, y solo después de un par de
 * segundos — antes de eso el escaneo normal ya habría entrado y un mensaje
 * sería ruido.
 */
export function mensajeDeAyuda(estado: EstadoAyuda): string | null {
  if (estado.msSinLeer < 2000) return null;
  if (estado.pocaLuz && estado.hayLinterna && !estado.linterna) {
    return 'Hay poca luz: encienda la linterna';
  }
  if (estado.pocaLuz) return 'Hay poca luz: acerque el producto a una lámpara';
  if (estado.msSinLeer < 5000) return 'Acerque o aleje el código despacio';
  if (estado.msSinLeer < 9000) return 'Evite el reflejo: incline un poco el producto';
  return 'Si no entra, escriba el código a mano';
}
