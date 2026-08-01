/**
 * Estado de conexión y reintento de operaciones críticas.
 *
 * El escenario real: internet de tienda de barrio que se cae unos segundos
 * justo al cobrar. La venta ya se registró en el servidor pero la respuesta
 * nunca llegó, y el cajero vuelve a presionar "Cobrar". La idempotencia por
 * `client_op_id` (Fase 2) hace que el reintento devuelva la MISMA venta en vez
 * de duplicarla; aquí solo se automatiza ese reintento.
 */
import { useEffect, useState } from 'react';

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return online;
}

/** Un fallo de red (no una respuesta de error del servidor). */
function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError; // fetch lanza TypeError cuando no hay red
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number) => void;
}

/**
 * Reintenta SOLO ante fallos de red. Un 400 o un 409 son respuestas legítimas
 * del servidor —stock insuficiente, caja cerrada— y repetirlas no ayuda.
 * La operación debe ser idempotente; en el POS lo es por `client_op_id`.
 */
export async function retryOnNetworkFailure<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 4;
  const baseDelay = options.baseDelayMs ?? 700;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isNetworkFailure(error) || attempt === attempts) throw error;
      options.onRetry?.(attempt);
      // Espera creciente: 0.7 s, 1.4 s, 2.8 s — da tiempo a que vuelva el enlace
      // sin dejar al cajero esperando de más frente al cliente.
      await new Promise((resolve) => setTimeout(resolve, baseDelay * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}
