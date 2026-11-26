import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  type Camara,
  type Capacidades,
  camaraRecordada,
  cambiarLinterna,
  convieneCambiar,
  diagnosticoSinCamara,
  cambiarZoom,
  confirmarEscaneo,
  crearAntirrebote,
  escalaParaDecodificar,
  hayPocaLuz,
  leerCapacidades,
  linternaRecordada,
  listarCamaras,
  luminanciaMedia,
  mensajeDeAyuda,
  olvidarCamara,
  pedirEnfoqueContinuo,
  recordarCamara,
  recordarLinterna,
  reenfocar,
  regionDeInteres,
  tocaCuadroCompleto,
} from '../lib/escaner';
import { ANCHO_MAXIMO_WASM, type LectorWasm, cargarLectorWasm } from '../lib/zxingWasm';
import { Icon } from './Icon';

/**
 * Escáner por cámara del POS (D-010, respaldo del lector físico).
 *
 * Lo que se arregló y por qué, porque cada cosa responde a una falla real en
 * un mostrador y no a una idea bonita:
 *
 *  · DECODIFICABA EL MISMO CUADRO VARIAS VECES. El bucle iba en
 *    `requestAnimationFrame` (~60 Hz) sobre una cámara de 30 fps. Ahora usa
 *    `requestVideoFrameCallback`: una pasada por cuadro NUEVO.
 *  · ANALIZABA EL CUADRO COMPLETO. Ahora recorta la franja central —un tercio
 *    de los píxeles— y mira el cuadro entero cada cinco, para no castigar a
 *    quien apunta mal.
 *  · NO PEDÍA ENFOQUE CONTINUO. Causa número uno de "a veces no lee".
 *  · NO PEDÍA RESOLUCIÓN. Muchos equipos entregan 640×480, donde un EAN-13
 *    está al límite de lo decodificable.
 *  · SE QUEDABA CALLADO AL FALLAR. Ahora mide la luz del cuadro y dice qué
 *    hacer: encender la linterna, acercar, inclinar — y al final ofrece
 *    escribir el código a mano, que es la salida que un cajero con un cliente
 *    enfrente necesita de verdad.
 *
 * En `continuo` no se cierra al leer: suma producto tras producto, con
 * antirrebote por código para que apoyar algo frente al lente no lo agregue
 * treinta veces.
 */

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?(): Promise<string[]>;
}

/** Solo los formatos que una tienda ve. Limitar la lista acelera los dos motores. */
const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];

type VideoConCallback = HTMLVideoElement & {
  requestVideoFrameCallback?(cb: () => void): number;
  cancelVideoFrameCallback?(id: number): void;
};

export function CameraScanner({
  onDetected,
  onClose,
  continuo = false,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
  /** Seguir escaneando tras cada lectura, en vez de cerrarse. */
  continuo?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const listoRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [motor, setMotor] = useState<'nativo' | 'zxing' | 'wasm' | null>(null);
  const [caps, setCaps] = useState<Capacidades>({
    linterna: false,
    zoom: null,
    enfoqueContinuo: false,
  });
  const [linterna, setLinterna] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [camaras, setCamaras] = useState<Camara[]>([]);
  const [camaraId, setCamaraId] = useState<string | null>(() => camaraRecordada());
  const [leidos, setLeidos] = useState(0);
  const [ultimo, setUltimo] = useState<string | null>(null);
  const [ayuda, setAyuda] = useState<string | null>(null);
  const [aMano, setAMano] = useState(false);
  const [manual, setManual] = useState('');

  const alternarLinterna = useCallback(async () => {
    const siguiente = !linterna;
    const ok = await cambiarLinterna(trackRef.current, siguiente);
    if (ok) {
      setLinterna(siguiente);
      recordarLinterna(siguiente);
    } else {
      setCaps((c) => ({ ...c, linterna: false }));
    }
  }, [linterna]);

  const elegirCamara = useCallback((id: string) => {
    recordarCamara(id);
    setCamaraId(id);
  }, []);

  const ajustarZoom = useCallback(async (valor: number) => {
    setZoom(valor);
    await cambiarZoom(trackRef.current, valor);
  }, []);

  function enviarAMano(e: FormEvent) {
    e.preventDefault();
    const codigo = manual.trim();
    if (!codigo) return;
    setManual('');
    confirmarEscaneo();
    onDetected(codigo);
    if (!continuo) onClose();
  }

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelado = false;
    let rafId: number | null = null;
    let vfcId: number | null = null;
    let wakeLock: WakeLockSentinel | null = null;

    const antirrebote = crearAntirrebote(1800);
    let desdeUltimaLectura = Date.now();
    let pocaLuz = false;

    function emitir(codigo: string) {
      const limpio = codigo.trim();
      if (!limpio) return;
      if (!continuo && listoRef.current) return;
      if (!antirrebote.aceptar(limpio)) return;

      desdeUltimaLectura = Date.now();
      confirmarEscaneo(); // pitido + vibración: el cajero no mira la pantalla
      setLeidos((n) => n + 1);
      setUltimo(limpio);
      setAyuda(null);
      onDetected(limpio);

      if (!continuo) {
        listoRef.current = true;
      }
    }

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          diagnosticoSinCamara({
            contextoSeguro: window.isSecureContext !== false,
            hayApi: false,
            origen: window.location.origin,
          }),
        );
        setAMano(true);
        return;
      }

      // Resolución alta a propósito: más píxeles son más módulos por barra, y
      // eso es lo que decide si un código pequeño o algo lejano se lee. Media
      // tienda tiene equipos que entregan 640×480 si uno no pide nada.
      const IDEALES = {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      };

      /**
       * Tres intentos, cada uno menos exigente que el anterior.
       *
       * EL PRIMERO FALLA POR UNA RAZÓN TONTA Y CARÍSIMA: el identificador de
       * cámara recordado puede ser de otro teléfono, de otro navegador o de
       * una cámara que ya no está, y `exact` hace que el navegador rechace
       * TODO con OverconstrainedError. Eso dejaba el escáner muerto para
       * siempre en ese equipo, porque el identificador malo seguía guardado y
       * el siguiente intento volvía a pedirlo. Ahora se olvida y se reintenta.
       *
       * El último intento es `video: true` a secas: si un equipo raro no
       * tolera ni los valores ideales, más vale una cámara mala que ninguna.
       */
      const intentos: MediaStreamConstraints[] = [
        ...(camaraId ? [{ video: { deviceId: { exact: camaraId }, ...IDEALES } }] : []),
        { video: { facingMode: { ideal: 'environment' }, ...IDEALES } },
        { video: true },
      ];

      let ultimoFallo: DOMException | null = null;
      for (const [i, restriccion] of intentos.entries()) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(restriccion);
          break;
        } catch (e) {
          ultimoFallo = e as DOMException;
          // El permiso denegado no se arregla pidiendo menos: no insistir.
          if (ultimoFallo?.name === 'NotAllowedError') break;
          // Si lo que falló fue la cámara recordada, se descarta de una vez.
          if (i === 0 && camaraId) olvidarCamara();
        }
      }

      if (!stream) {
        const name = ultimoFallo?.name;
        setError(
          name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Habilítelo en el navegador o escriba el código.'
            : name === 'NotFoundError'
              ? 'No se encontró ninguna cámara en este dispositivo.'
              : diagnosticoSinCamara({
                  contextoSeguro: window.isSecureContext !== false,
                  hayApi: true,
                  origen: window.location.origin,
                }),
        );
        // Sin cámara, lo único que salva al cajero es poder teclearlo.
        setAMano(true);
        return;
      }

      if (cancelado || !videoRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const video = videoRef.current as VideoConCallback;
      // iOS solo reproduce en línea si el vídeo está silenciado Y marcado como
      // `playsinline` EN EL MOMENTO del play. React pone las propiedades, pero
      // no siempre deja el atributo en el DOM, y sin el atributo Safari abre el
      // reproductor a pantalla completa o deja el cuadro en negro. Ponerlos a
      // mano cuesta dos líneas y es la diferencia entre ver la cámara o no.
      video.muted = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;

      const capacidades = leerCapacidades(track);
      if (!cancelado) setCaps(capacidades);
      if (capacidades.enfoqueContinuo) await pedirEnfoqueContinuo(track);
      if (capacidades.zoom) setZoom(capacidades.zoom.min);

      // La linterna se recuerda: una tienda oscura lo es todos los días.
      if (capacidades.linterna && linternaRecordada()) {
        if (await cambiarLinterna(track, true)) setLinterna(true);
      } else {
        setLinterna(false);
      }

      void listarCamaras().then((lista) => {
        if (cancelado) return;
        setCamaras(lista);

        // SI EL SISTEMA NOS DIO LA CÁMARA EQUIVOCADA, CAMBIARLA SIN PREGUNTAR.
        // `facingMode: environment` deja que el sistema elija entre las tres o
        // cuatro traseras de un teléfono moderno, y muchas veces elige la ultra
        // gran angular, que reparte los píxeles en un campo tres veces más
        // ancho y deforma el código. Esa es la causa de "en este teléfono no
        // escanea". Solo se reabre cuando el cambio vale el parpadeo, y nunca
        // si el cajero ya eligió una a mano.
        if (camaraId) return;
        const mejor = convieneCambiar(track?.label ?? null, lista);
        if (mejor) {
          recordarCamara(mejor.id);
          setCamaraId(mejor.id); // reabre el efecto con la cámara buena
        }
      });

      try {
        wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        /* es un lujo, no un requisito */
      }

      const lienzo = document.createElement('canvas');
      const ctx = lienzo.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        setError('No se pudo preparar el lector de imágenes.');
        setAMano(true);
        return;
      }

      let cuadro = 0;

      /**
       * Dibuja lo que toca analizar. `reducir` solo lo usa ZXing: es
       * JavaScript puro y paga cada píxel, y como Safari nunca implementó
       * `BarcodeDetector`, todos los iPhone caen ahí.
       */
      function prepararLienzo(reducir: boolean, maximo?: number): HTMLCanvasElement | null {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return null;
        const completo = tocaCuadroCompleto(cuadro);
        const r = completo ? { x: 0, y: 0, ancho: w, alto: h } : regionDeInteres(w, h);
        const escala = reducir ? escalaParaDecodificar(r.ancho, maximo) : 1;
        lienzo.width = Math.max(1, Math.round(r.ancho * escala));
        lienzo.height = Math.max(1, Math.round(r.alto * escala));
        ctx!.drawImage(video, r.x, r.y, r.ancho, r.alto, 0, 0, lienzo.width, lienzo.height);
        return lienzo;
      }

      /** Mide la luz del último lienzo dibujado. Quien llama decide cada cuándo. */
      function medirLuz() {
        if (lienzo.width === 0) return;
        try {
          const datos = ctx!.getImageData(0, 0, lienzo.width, lienzo.height).data;
          pocaLuz = hayPocaLuz(luminanciaMedia(datos));
        } catch {
          /* algunos navegadores restringen getImageData; se sigue sin medir */
        }
      }

      function actualizarAyuda() {
        setAyuda(
          mensajeDeAyuda({
            msSinLeer: Date.now() - desdeUltimaLectura,
            pocaLuz,
            linterna,
            hayLinterna: capacidades.linterna,
          }),
        );
      }

      function siguienteCuadro(fn: () => void) {
        if (video.requestVideoFrameCallback) {
          vfcId = video.requestVideoFrameCallback(fn);
        } else {
          rafId = requestAnimationFrame(fn);
        }
      }

      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
        .BarcodeDetector;

      /**
       * PREGUNTARLE AL DETECTOR NATIVO SI DE VERDAD SIRVE.
       *
       * En Android, BarcodeDetector se apoya en el módulo de códigos de
       * Google Play Services. En los equipos donde ese módulo no está
       * instalado —teléfonos sin servicios de Google, versiones recortadas
       * de fábrica, algunas ROMs— el objeto EXISTE, construirlo no falla, y
       * detect() devuelve una lista vacía para siempre. El escáner se queda
       * mirando sin leer nunca nada, y no hay ningún error que lo delate: es
       * el caso textual de "en algunos entornos no da".
       *
       * getSupportedFormats() lo desenmascara en una línea: si no declara
       * ninguno de los formatos de tienda, se usa el WebAssembly, que no
       * depende de nada del sistema.
       */
      let hayNativo = false;
      if (Detector) {
        try {
          const soportados = (await Detector.getSupportedFormats?.()) ?? [];
          hayNativo = FORMATOS.some((f) => soportados.includes(f));
        } catch {
          hayNativo = false;
        }
      }
      if (cancelado) return;

      if (Detector && hayNativo) {
        setMotor('nativo');
        const detector = new Detector({ formats: FORMATOS });
        const paso = async () => {
          if (cancelado || (!continuo && listoRef.current)) return;
          try {
            // AL VÍDEO DIRECTO, SIN PASAR POR UN LIENZO. El detector de Chrome
            // está compilado y traga el cuadro completo de sobra; el
            // `drawImage` de 1920×1080 que se hacía antes en CADA cuadro era
            // trabajo puro de más, y en un Android barato eso se come buena
            // parte del presupuesto por cuadro. De paso ahora mira siempre el
            // cuadro ENTERO, así que deja de castigar a quien apunta un poco
            // fuera de la franja.
            if (video.videoWidth) {
              const r = await detector.detect(video);
              if (r[0]?.rawValue) emitir(r[0].rawValue);
            }
          } catch {
            /* un cuadro ilegible no es un error */
          }
          cuadro += 1;
          // El lienzo ya solo existe para medir la luz, una vez cada 15 cuadros.
          if (cuadro % 15 === 0) {
            if (prepararLienzo(true)) medirLuz();
            actualizarAyuda();
          }
          if (!cancelado && (continuo || !listoRef.current)) siguienteCuadro(() => void paso());
        };
        void paso();
        return;
      }

      setMotor('zxing');

      /**
       * El WebAssembly se carga EN PARALELO, no antes de empezar.
       *
       * Son unos cientos de kilobytes: esperarlo dejaría el visor muerto los
       * primeros segundos, que es justo cuando el cajero ya está apuntando. Así
       * que se empieza a decodificar con la versión de JavaScript y, en cuanto
       * el módulo está listo, el bucle lo usa a él y nada más. El cambio no se
       * nota salvo en la velocidad.
       */
      let wasm: LectorWasm | null = null;
      void cargarLectorWasm().then((lector) => {
        if (cancelado || !lector) return;
        wasm = lector;
        setMotor('wasm');
      });

      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        if (cancelado) return;

        const formatos = [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.ITF,
        ];
        const rapido = new Map();
        rapido.set(DecodeHintType.POSSIBLE_FORMATS, formatos);

        /**
         * Lector INSISTENTE: `TRY_HARDER` prueba más filas y más escalas del
         * mismo cuadro. Cuesta varias veces más, así que no se usa de
         * entrada; se enciende tras unos segundos sin leer, que es cuando al
         * cajero ya le vale más una lectura lenta que ninguna.
         */
        const insistente = new Map(rapido);
        insistente.set(DecodeHintType.TRY_HARDER, true);

        const lectorRapido = new BrowserMultiFormatReader(rapido);
        const lectorInsistente = new BrowserMultiFormatReader(insistente);
        const MS_ANTES_DE_INSISTIR = 2500;

        /**
         * Invierte el lienzo. Algunas básculas y etiquetadoras imprimen el
         * código en blanco sobre fondo oscuro, y ZXing solo busca barras
         * oscuras sobre claro. Esta versión de la librería no trae la opción
         * `ALSO_INVERTED`, así que se invierte a mano — cuesta una pasada
         * sobre un lienzo ya reducido, y solo se hace cuando lo normal falló.
         */
        function invertir() {
          const img = ctx!.getImageData(0, 0, lienzo.width, lienzo.height);
          const d = img.data;
          for (let i = 0; i < d.length; i += 4) {
            d[i] = 255 - d[i]!;
            d[i + 1] = 255 - d[i + 1]!;
            d[i + 2] = 255 - d[i + 2]!;
          }
          ctx!.putImageData(img, 0, 0);
        }

        const paso = async () => {
          if (cancelado || (!continuo && listoRef.current)) return;
          const duro = Date.now() - desdeUltimaLectura > MS_ANTES_DE_INSISTIR;
          try {
            if (wasm) {
              // Con WebAssembly se le entrega un recorte MÁS GRANDE (1600 px
              // en vez de 1024): más píxeles son más módulos por barra, y eso
              // es lo que decide si un código pequeño o lejano se lee. Antes
              // había que achicarlo porque cada píxel lo pagaba JavaScript;
              // medido, un cuadro de 1600×600 le cuesta 1,7 ms.
              const fuente = prepararLienzo(true, ANCHO_MAXIMO_WASM);
              if (fuente) {
                if (cuadro % 15 === 0) medirLuz();
                const img = ctx!.getImageData(0, 0, fuente.width, fuente.height);
                const texto = await wasm(img, duro);
                if (texto) emitir(texto);
                // EL NEGATIVO SIGUE SIENDO NUESTRO TRABAJO. `tryInvert` de la
                // librería solo se aplica a los códigos matriciales (QR,
                // DataMatrix): la norma de los lineales no admite reflectancia
                // invertida, así que un EAN-13 blanco sobre negro —lo que
                // imprimen algunas básculas y etiquetadoras— no lo lee. Se
                // comprobó: en negativo devuelve nada; invirtiendo los píxeles
                // a mano, lo lee. `tryRotate` sí funciona (un código girado 90°
                // se lee), así que eso no hay que hacerlo.
                else if (duro && cuadro % 2 === 0) {
                  const d = img.data;
                  for (let i = 0; i < d.length; i += 4) {
                    d[i] = 255 - d[i]!;
                    d[i + 1] = 255 - d[i + 1]!;
                    d[i + 2] = 255 - d[i + 2]!;
                  }
                  const negativo = await wasm(img, duro);
                  if (negativo) emitir(negativo);
                }
              }
            } else {
              const lector = duro ? lectorInsistente : lectorRapido;
              const fuente = prepararLienzo(true);
              if (fuente) {
                if (cuadro % 15 === 0) medirLuz();
                try {
                  const r = lector.decodeFromCanvas(fuente);
                  if (r) emitir(r.getText());
                } catch {
                  // Insistiendo y en cuadros alternos, probar en negativo.
                  if (duro && cuadro % 2 === 0) {
                    invertir();
                    const r2 = lector.decodeFromCanvas(fuente);
                    if (r2) emitir(r2.getText());
                  }
                }
              }
            }
          } catch {
            /* NotFoundException en cada cuadro sin código: es lo normal */
          }
          cuadro += 1;
          if (cuadro % 15 === 0) actualizarAyuda();
          if (!cancelado && (continuo || !listoRef.current)) siguienteCuadro(() => void paso());
        };
        void paso();
      } catch {
        setError('No se pudo iniciar el lector de códigos en este navegador.');
        setAMano(true);
      }
    })();

    return () => {
      cancelado = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (vfcId !== null)
        (videoRef.current as VideoConCallback | null)?.cancelVideoFrameCallback?.(vfcId);
      void wakeLock?.release().catch(() => undefined);
      // Apagar la linterna antes de soltar la pista: en algunos equipos el
      // flash se queda encendido si solo se detiene el flujo.
      void cambiarLinterna(trackRef.current, false).finally(() => {
        stream?.getTracks().forEach((t) => t.stop());
        trackRef.current = null;
      });
    };
    // `linterna` queda fuera a propósito: cambiarla no debe reabrir la cámara.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDetected, camaraId, continuo]);

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-[hsl(var(--bg-deep)/0.95)] p-4">
      <div className="flex items-center justify-between text-white">
        <span className="font-semibold">
          {continuo ? 'Escanear productos' : 'Escanear con la cámara'}
          {leidos > 0 && (
            <span className="ml-2 rounded-full bg-[hsl(var(--ok)/0.25)] px-2 py-0.5 text-xs">
              {leidos} agregado(s)
            </span>
          )}
        </span>
        <button
          onClick={onClose}
          className="rounded-lg bg-[hsl(var(--text-1)/0.12)] px-3 py-1.5 text-sm hover:bg-[hsl(var(--text-1)/0.2)]"
        >
          {continuo && leidos > 0 ? 'Listo' : 'Cerrar'}
        </button>
      </div>

      <div className="relative mx-auto mt-4 w-full max-w-md flex-1 overflow-hidden rounded-xl bg-black">
        {/* Tocar el visor vuelve a enfocar: el enfoque continuo se queda
            pegado cuando el fondo tiene más contraste que el código. */}
        <video
          ref={videoRef}
          playsInline
          muted
          onClick={() => void reenfocar(trackRef.current)}
          className="h-full w-full cursor-pointer object-contain"
          aria-label="Vista de la cámara para escanear códigos. Tóquela para enfocar."
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={`h-[38%] w-[90%] rounded-lg border-2 transition-colors ${
              ultimo ? 'border-[hsl(var(--ok))]' : 'border-[hsl(var(--ok)/0.85)]'
            } shadow-[0_0_0_9999px_rgba(0,0,0,0.38)]`}
          />
        </div>
        {ultimo && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[hsl(var(--ok)/0.9)] px-3 py-1.5 text-center text-sm font-semibold text-[hsl(var(--bg-deep))]">
            {ultimo}
          </div>
        )}
      </div>

      <div className="mx-auto mt-3 flex w-full max-w-md flex-col gap-3">
        {caps.linterna && (
          <button
            onClick={() => void alternarLinterna()}
            aria-pressed={linterna}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
              linterna
                ? 'bg-[hsl(var(--warn))] text-[hsl(var(--bg-deep))]'
                : 'bg-[hsl(var(--text-1)/0.12)] text-white hover:bg-[hsl(var(--text-1)/0.2)]'
            }`}
          >
            <Icon name="rayo" size={18} />
            {linterna ? 'Apagar la luz' : 'Encender la luz'}
          </button>
        )}

        {camaras.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-white/70">
            Cámara
            <select
              value={camaraId ?? ''}
              onChange={(e) => elegirCamara(e.target.value)}
              aria-label="Elegir cámara"
              className="flex-1 rounded-lg bg-[hsl(var(--text-1)/0.12)] px-2 py-1.5 text-white"
            >
              {!camaraId && <option value="">Automática</option>}
              {camaras.map((c) => (
                <option key={c.id} value={c.id} className="text-black">
                  {c.etiqueta}
                </option>
              ))}
            </select>
          </label>
        )}

        {caps.zoom && caps.zoom.max > caps.zoom.min && (
          <label className="flex items-center gap-3 text-xs text-white/70">
            Acercar
            <input
              type="range"
              min={caps.zoom.min}
              max={caps.zoom.max}
              step={caps.zoom.paso}
              value={zoom}
              onChange={(e) => void ajustarZoom(Number(e.target.value))}
              className="flex-1 accent-[hsl(var(--accent))]"
              aria-label="Acercar la cámara"
            />
          </label>
        )}

        {/* La salida de emergencia: hay un cliente esperando. */}
        {aMano ? (
          <form onSubmit={enviarAMano} className="flex gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Escriba el código"
              inputMode="numeric"
              autoFocus
              aria-label="Código escrito a mano"
              className="money flex-1 rounded-xl bg-[hsl(var(--text-1)/0.12)] px-3 py-2.5 text-white placeholder:text-white/40"
            />
            <button
              type="submit"
              className="rounded-xl bg-[hsl(var(--accent))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--accent-ink))]"
            >
              Buscar
            </button>
          </form>
        ) : (
          <button
            onClick={() => setAMano(true)}
            className="text-xs text-white/60 underline-offset-2 hover:underline"
          >
            Escribir el código a mano
          </button>
        )}
      </div>

      {error ? (
        <p className="mx-auto mt-3 max-w-md rounded-lg bg-[hsl(var(--danger)/0.14)] px-3 py-2 text-center text-sm text-[hsl(var(--danger))]">
          {error}
        </p>
      ) : (
        <p className="mt-3 min-h-[1.25rem] text-center text-sm text-white/70">
          {ayuda ?? (
            <>
              Centre el código en el recuadro
              {continuo && ' · puede pasar varios seguidos'}
              {/* Qué motor está leyendo. No es un detalle técnico de adorno:
                  cuando el dueño reporte "en este teléfono no da", esta línea
                  dice si cayó en el lector lento o no, y eso es media
                  respuesta sin tener el teléfono en la mano. */}
              {motor === 'zxing' && ' · lector compatible'}
              {motor === 'wasm' && ' · lector rápido'}
            </>
          )}
        </p>
      )}
    </div>
  );
}
