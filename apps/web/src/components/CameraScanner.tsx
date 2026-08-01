import { useEffect, useRef, useState } from 'react';

/**
 * Escáner por cámara para el POS (D-010, fallback del lector físico).
 *
 * Dos motores, en orden:
 *  1. BarcodeDetector nativo (Chrome/Android): rápido y sin descargar nada.
 *  2. ZXing-JS: cubre iOS/Safari y navegadores sin el API nativo. Se carga
 *     de forma diferida — el 90 % de las tiendas usará lector físico y no
 *     debe pagar el peso de la librería en cada arranque del POS.
 *
 * Prefiere la cámara trasera: la tienda escanea productos, no selfies.
 */

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?(): Promise<string[]>;
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];

export function CameraScanner({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<'nativo' | 'zxing' | null>(null);
  // Un ref evita entregar el mismo código dos veces mientras se cierra el modal.
  const doneRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId: number | null = null;
    let zxingControls: { stop: () => void } | null = null;
    let cancelled = false;

    function emit(code: string) {
      if (doneRef.current || !code) return;
      doneRef.current = true;
      // Vibración corta: confirma el escaneo sin mirar la pantalla.
      navigator.vibrate?.(60);
      onDetected(code.trim());
    }

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este dispositivo no permite usar la cámara desde el navegador.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
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
      if (cancelled || !videoRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => undefined);

      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
        .BarcodeDetector;

      if (Detector) {
        setEngine('nativo');
        const detector = new Detector({ formats: FORMATS });
        const tick = async () => {
          if (cancelled || doneRef.current || !videoRef.current) return;
          try {
            const results = await detector.detect(videoRef.current);
            if (results[0]?.rawValue) return emit(results[0].rawValue);
          } catch {
            /* un cuadro ilegible no es un error: se sigue intentando */
          }
          rafId = requestAnimationFrame(() => void tick());
        };
        void tick();
        return;
      }

      // Fallback: ZXing cargado bajo demanda
      setEngine('zxing');
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        zxingControls = await reader.decodeFromVideoElement(videoRef.current, (result) => {
          if (result) emit(result.getText());
        });
      } catch {
        setError('No se pudo iniciar el lector de códigos en este navegador.');
      }
    })();

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      zxingControls?.stop();
      stream?.getTracks().forEach((t) => t.stop()); // apagar la cámara SIEMPRE
    };
  }, [onDetected]);

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-black/90 p-4">
      <div className="flex items-center justify-between text-white">
        <span className="font-semibold">Escanear con la cámara</span>
        <button onClick={onClose} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">
          Cerrar
        </button>
      </div>

      <div className="relative mx-auto mt-4 w-full max-w-md flex-1">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full rounded-xl object-cover"
          aria-label="Vista de la cámara para escanear códigos"
        />
        {/* Guía visual: el cajero apunta el código dentro del marco */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-28 w-4/5 rounded-lg border-2 border-emerald-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
      </div>

      {error ? (
        <p className="mx-auto mt-4 max-w-md rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">
          {error}
        </p>
      ) : (
        <p className="mt-3 text-center text-sm text-white/70">
          Centre el código de barras en el recuadro
          {engine === 'zxing' && ' · usando lector compatible'}
        </p>
      )}
    </div>
  );
}
