/**
 * Cliente HTTP del panel de plataforma. Deliberadamente separado del cliente
 * de tienda: distintas claves de almacenamiento para que una sesión de super
 * admin y una de tendero puedan coexistir en el mismo navegador sin pisarse
 * (es exactamente lo que pasa al usar "ver como tenant").
 */
import { ApiError } from './client';

const BASE_URL: string = import.meta.env.VITE_API_URL ?? '';
const REFRESH_KEY = 'mm.platformRefresh';

let accessToken: string | null = null;

export function setPlatformSession(tokens: { accessToken: string; refreshToken: string }) {
  accessToken = tokens.accessToken;
  localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function clearPlatformSession() {
  accessToken = null;
  localStorage.removeItem(REFRESH_KEY);
}

/**
 * Cierra la sesión REVOCÁNDOLA en el servidor, no solo borrándola del
 * navegador: si el refresh token fue copiado, limpiar localStorage no lo
 * invalida — seguiría sirviendo hasta expirar.
 */
export async function platformLogout(): Promise<void> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (refreshToken) {
    await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined); // la sesión local se limpia pase lo que pase
  }
  clearPlatformSession();
}

let refreshInFlight: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    clearPlatformSession();
    return false;
  }
  setPlatformSession(await res.json());
  return true;
}

async function raw(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });
}

export async function platformApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res = await raw(path, options);
  if (res.status === 401 && (await tryRefresh())) res = await raw(path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? 'Error de conexión',
    );
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export async function restorePlatformSession(): Promise<boolean> {
  return localStorage.getItem(REFRESH_KEY) ? tryRefresh() : false;
}
