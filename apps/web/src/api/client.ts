/**
 * Cliente HTTP mínimo: access token en memoria, refresh token en localStorage
 * (D-021), auto-refresh transparente ante 401 con reintento único.
 */
const BASE_URL: string = import.meta.env.VITE_API_URL ?? '';
const REFRESH_KEY = 'mm.refreshToken';

let accessToken: string | null = null;

export function setSession(tokens: { accessToken: string; refreshToken: string }) {
  accessToken = tokens.accessToken;
  localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function clearSession() {
  accessToken = null;
  localStorage.removeItem(REFRESH_KEY);
}

export function hasStoredSession(): boolean {
  return localStorage.getItem(REFRESH_KEY) !== null;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function rawRequest(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    clearSession();
    return false;
  }
  setSession(await res.json());
  return true;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res = await rawRequest(path, options);
  if (res.status === 401 && (await tryRefresh())) {
    res = await rawRequest(path, options);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? 'Error de conexión',
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Restaura sesión al cargar la app (si hay refresh token guardado). */
export async function restoreSession(): Promise<boolean> {
  if (!hasStoredSession()) return false;
  return tryRefresh();
}

export async function logoutRequest(): Promise<void> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (refreshToken) {
    await api('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }
  clearSession();
}
