/**
 * Cliente HTTP mínimo: access token en memoria, refresh token en localStorage
 * (D-021), auto-refresh transparente ante 401 con reintento único.
 */
const BASE_URL: string = import.meta.env.VITE_API_URL ?? '';
const REFRESH_KEY = 'mm.refreshToken';
/** Token de soporte ("ver como tenant"): vive en sessionStorage porque muere
 *  con la pestaña, es de solo lectura y nunca debe sobrevivir al cierre. */
const IMPERSONATION_KEY = 'mm.impersonation';

let accessToken: string | null = null;

export interface ImpersonationInfo {
  accessToken: string;
  tenantName: string;
  actingAs: string;
}

export function getImpersonation(): ImpersonationInfo | null {
  const raw = sessionStorage.getItem(IMPERSONATION_KEY);
  return raw ? (JSON.parse(raw) as ImpersonationInfo) : null;
}

export function startImpersonation(info: ImpersonationInfo) {
  sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify(info));
  accessToken = info.accessToken;
}

export function stopImpersonation() {
  sessionStorage.removeItem(IMPERSONATION_KEY);
  accessToken = null;
}

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

/**
 * Refresh SINGLE-FLIGHT: si varios requests reciben 401 a la vez (o StrictMode
 * duplica un efecto), todos comparten UNA sola llamada de refresh. Sin esto,
 * el segundo refresh enviaría el token ya rotado y la detección de reuso del
 * backend revocaría la familia completa (cerraría la sesión por "seguridad").
 */
let refreshInFlight: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<boolean> {
  // Una sesión de soporte no se renueva: expira a los 15 min y el super admin
  // debe volver a pedirla, dejando otra huella en la bitácora.
  if (getImpersonation()) return false;
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

/** Restaura sesión al cargar la app: primero la de soporte, luego la propia. */
export async function restoreSession(): Promise<boolean> {
  const impersonation = getImpersonation();
  if (impersonation) {
    accessToken = impersonation.accessToken;
    return true;
  }
  if (!hasStoredSession()) return false;
  return tryRefresh();
}

/**
 * Descarga un CSV autenticado: fetch con Bearer → blob → click sintético.
 * Un <a href> directo no sirve porque el token va en la cabecera, no en la URL
 * (y meterlo en la URL lo dejaría en logs e historial).
 */
export async function downloadCsv(path: string, filename: string): Promise<void> {
  let res = await rawRequest(path);
  if (res.status === 401 && (await tryRefresh())) res = await rawRequest(path);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? 'Error al exportar');
  }
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
