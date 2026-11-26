import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type Camara,
  type Capacidades,
  camaraRecordada,
  cambiarLinterna,
  cambiarZoom,
  confirmarEscaneo,
  leerCapacidades,
  listarCamaras,
  pedirEnfoqueContinuo,
  recordarCamara,
  regionDeInteres,
  tocaCuadroCompleto,
} from '../lib/escaner';
import { Icon } from './Icon';

/**
 * Escáner por cámara del POS (D-010, respaldo del lector físico).
 *
 * POR QUÉ SE REHIZO. La versión anterior funcionaba en el escritorio del
 * desarrollador y fallaba en el mostrador. Cuatro causas, todas de velocidad
 * o de luz:
 *
 *  1. DECODIFICABA EL MISMO CUADRO VARIAS VECES. El bucle iba en
 *     `requestAnimationFrame` (~60 Hz) sobre una cámara de 30 fps: la mitad
 *     de las pasadas analizaban una imagen ya analizada, y cada pasada cuesta
 *     decenas de milisegundos. Ahora usa `requestVideoFrameCallback`, que
 *     dispara UNA vez por cuadro nuevo; donde no existe, cae a rAF.
 *  2. ANALIZABA LOS 2 MILLONES DE PÍXELES DEL CUADRO. Ahora recorta la franja
 *     central —donde el cajero apunta— y analiza una tercera parte. Cada
 *     cinco cuadros mira el cuadro completo, para no castigar a quien apunta
 *     mal.
 *  3. NO PEDÍA ENFOQUE CONTINUO. Es la causa número uno de "a veces no lee":
 *     la cámara enfoca el fondo y el código queda borroso.
 *  4. NO PEDÍA RESOLUCIÓN. Por omisión muchos equipos entregan 640×480, y un
 *     EAN-13 a esa resolución está en el límite de lo decodificable.
 *
 * Y LA LINTERNA. Un mostrador está casi siempre a contraluz o en penumbra, y
 * un código impreso en plástico brillante no tiene contraste sin luz propia.
 * El botón enciende el flash del equipo cuando el navegador lo permite
 * (`torch`, hoy Chrome sobre Android). Se pide DESPUÉS de abrir la cámara, a
 * propósito: pedirlo dentro de `getUserMedia` hace fallar la apertura entera
 * en varios equipos y deja al cajero sin cámara.
 *
 * El vídeo se muestra con `object-contain` y no `object-cover`: así lo que se
 * ve es exactamente el cuadro que se analiza, y el recuadro guía no miente.
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
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const doneRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [motor, setMotor] = useState<'nativo' | 'zxing' | null>(null);
  const [caps, setCaps] = useState<Capacidades>({
    linterna: false,
    zoom: null,
    enfoqueContinuo: false,
  });
  const [linterna, setLinterna] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [camaras, setCamaras] = useState<Camara[]>([]);
  // `deviceId` elegido. Cambiarlo reabre la cámara: es la dependencia del
  // efecto, así que el bucle entero se rearma solo.
  const [camaraId, setCamaraId] = useState<string | null>(() => camaraRecordada());

  const alternarLinterna = useCallback(async () => {
    const siguiente = !linterna;
    const ok = await cambiarLinterna(trackRef.current, siguiente);
    if (ok) setLinterna(siguiente);
    else setCaps((c) => ({ ...c, linterna: false }));
  }, [linterna]);

  const elegirCamara = useCallback((id: string) => {
    recordarCamara(id);
    setCamaraId(id);
  }, []);

  const ajustarZoom = useCallback(async (valor: number) => {
    setZoom(valor);
    await cambiarZoom(trackRef.current, valor);
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelado = false;
    let rafId: number | null = null;
    let vfcId: number | null = null;
    let wakeLock: WakeLockSentinel | null = null;

    function emitir(codigo: string) {
      if (doneRef.current || !codigo) return;
      doneRef.current = true;
      confirmarEscaneo(); // pitido + vibración: el cajero no mira la pantalla
      onDetected(codigo.trim());
    }

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este dispositivo no permite usar la cámara desde el navegador.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            // Si el cajero ya eligió una cámara en este equipo, se respeta;
            // si no, se pide la trasera y que el sistema decida cuál.
            ...(camaraId ? { deviceId: { exact: camaraId } } : {}),
            facingMode: { ideal: 'environment' },
            // Más píxeles sobre el código. `ideal` y no `exact`: si la cámara
            // no llega, entrega lo que pueda en vez de fallar.
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
        });
      } catch (e) {
        const name = (e as DOMException)?.name;
        setError(
          name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Habilítelo en el navegador o use el lector de códigos.'
            : name === 'NotFoundError'
              ? 'No se encontró ninguna cámara en este dispositivo.'
              : 'No se pudo abrir la cámara.',
        );
        return;
      }

      if (cancelado || !videoRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const video = videoRef.current as VideoConCallback;
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;

      // Capacidades y enfoque: después de abrir, nunca antes.
      const capacidades = leerCapacidades(track);
      if (!cancelado) {
        setCaps(capacidades);
        // Flujo nuevo = linterna apagada; el botón no puede mentir.
        setLinterna(false);
      }

      // Las etiquetas solo existen una vez concedido el permiso.
      void listarCamaras().then((lista) => {
        if (!cancelado) setCamaras(lista);
      });
      if (capacidades.enfoqueContinuo) await pedirEnfoqueContinuo(track);
      if (capacidades.zoom) setZoom(capacidades.zoom.min);

      // Que la pantalla no se apague a media fila.
      try {
        wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        /* no todos los navegadores lo permiten; es un lujo, no un requisito */
      }

      // ── Lienzo de trabajo: aquí se recorta la franja a analizar ──
      const lienzo = document.createElement('canvas');
      const ctx = lienzo.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        setError('No se pudo preparar el lector de imágenes.');
        return;
      }

      let cuadro = 0;
      /** Dibuja en el lienzo lo que toca analizar y lo devuelve. */
      function prepararLienzo(): HTMLCanvasElement | null {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return null;
        const completo = tocaCuadroCompleto(cuadro);
        const r = completo ? { x: 0, y: 0, ancho: w, alto: h } : regionDeInteres(w, h);
        lienzo.width = r.ancho;
        lienzo.height = r.alto;
        ctx!.drawImage(video, r.x, r.y, r.ancho, r.alto, 0, 0, r.ancho, r.alto);
        return lienzo;
      }

      /** Pide el siguiente cuadro por la vía más barata disponible. */
      function siguienteCuadro(fn: () => void) {
        if (video.requestVideoFrameCallback) {
          vfcId = video.requestVideoFrameCallback(fn);
        } else {
          rafId = requestAnimationFrame(fn);
        }
      }

      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
        .BarcodeDetector;

      if (Detector) {
        setMotor('nativo');
        const detector = new Detector({ formats: FORMATOS });
        const paso = async () => {
          if (cancelado || doneRef.current) return;
          try {
            const fuente = prepararLienzo();
            if (fuente) {
              const r = await detector.detect(fuente);
              if (r[0]?.rawValue) return emitir(r[0].rawValue);
            }
          } catch {
            /* un cuadro ilegible no es un error: se sigue intentando */
          }
          cuadro += 1;
          siguienteCuadro(() => void paso());
        };
        void paso();
        return;
      }

      // ── Respaldo: ZXing, cargado bajo demanda ──
      setMotor('zxing');
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        if (cancelado) return;

        // Mismas restricciones de formato que el motor nativo: ZXing probando
        // los veintitantos simbologías que conoce es varias veces más lento.
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.ITF,
        ]);
        const reader = new BrowserMultiFormatReader(hints);

        // Bucle propio en vez de `decodeFromVideoElement`: así ZXing también
        // aprovecha el recorte y el cuadro-a-cuadro.
        const paso = () => {
          if (cancelado || doneRef.current) return;
          try {
            const fuente = prepararLienzo();
            if (fuente) {
              const r = reader.decodeFromCanvas(fuente);
              if (r) return emitir(r.getText());
            }
          } catch {
            /* NotFoundException en cada cuadro sin código: es lo normal */
          }
          cuadro += 1;
          siguienteCuadro(paso);
        };
        paso();
      } catch {
        setError('No se pudo iniciar el lector de códigos en este navegador.');
      }
    })();

    return () => {
      cancelado = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (vfcId !== null) (videoRef.current as VideoConCallback | null)?.cancelVideoFrameCallback?.(vfcId);
      void wakeLock?.release().catch(() => undefined);
      // Apagar la linterna antes de soltar la pista: en algunos equipos el
      // flash se queda encendido si solo se detiene el flujo.
      void cambiarLinterna(trackRef.current, false).finally(() => {
        stream?.getTracks().forEach((t) => t.stop());
        trackRef.current = null;
      });
    };
  }, [onDetected, camaraId]);

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-[hsl(var(--bg-deep)/0.95)] p-4">
      <div className="flex items-center justify-between text-white">
        <span className="font-semibold">Escanear con la cámara</span>
        <button
          onClick={onClose}
          className="rounded-lg bg-[hsl(var(--text-1)/0.12)] px-3 py-1.5 text-sm hover:bg-[hsl(var(--text-1)/0.2)]"
        >
          Cerrar
        </button>
      </div>

      <div className="relative mx-auto mt-4 w-full max-w-md flex-1 overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-contain"
          aria-label="Vista de la cámara para escanear códigos"
        />
        {/* La guía cubre la misma franja que se analiza (90 % × 38 %). */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[38%] w-[90%] rounded-lg border-2 border-[hsl(var(--ok)/0.9)] shadow-[0_0_0_9999px_rgba(0,0,0,0.38)]" />
        </div>
      </div>

      {/* ── Controles del equipo ── */}
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
      </div>

      {error ? (
        <p className="mx-auto mt-3 max-w-md rounded-lg bg-[hsl(var(--danger)/0.14)] px-3 py-2 text-center text-sm text-[hsl(var(--danger))]">
          {error}
        </p>
      ) : (
        <p className="mt-3 text-center text-sm text-white/70">
          Centre el código en el recuadro
          {caps.linterna && ' · si hay poca luz, encienda la linterna'}
          {motor === 'zxing' && ' · lector compatible'}
        </p>
      )}
    </div>
  );
}
