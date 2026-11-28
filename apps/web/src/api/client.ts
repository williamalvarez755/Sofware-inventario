/**
 * Cliente HTTP mínimo: access token en memoria, refresh token en localStorage
 * (D-021), auto-refresh transparente ante 401 con reintento único.
 */
import { cierraAlCerrarPestana } from '../lib/sesion';

const BASE_URL: string = import.meta.env.VITE_API_URL ?? '';
const REFRESH_KEY = 'mm.refreshToken';
/** Token de soporte ("ver como tenant"): vive en sessionStorage porque muere
 *  con la pestaña, es de solo lectura y nunca debe sobrevivir al cierre. */
const IMPERSONATION_KEY = 'mm.impersonation';

let accessToken: string | null = null;

/**
 * Dónde se guarda el refresh token en ESTE equipo.
 *
 * `sessionStorage` muere con la pestaña pero sobrevive a recargar — que es
 * exactamente la distinción que hace falta: en una tienda se recarga (D-059),
 * y lo que no debe sobrevivir es cerrar el navegador y dejar la computadora
 * del mostrador con la sesión del cajero abierta.
 *
 * Se importa la preferencia en vez de preguntarla por parámetro para que
 * `setSession` siga teniendo la misma firma en los seis lugares que la llaman.
 */
function almacenDeSesion(): Storage {
  return cierraAlCerrarPestana() ? sessionStorage : localStorage;
}

/**
 * El token, buscando en los dos almacenes.
 *
 * `sessionStorage` primero: si hay uno ahí es el de esta pestaña, y manda
 * sobre cualquier resto que haya quedado en `localStorage` de antes de
 * cambiar la preferencia.
 */
function leerRefresh(): string | null {
  try {
    return sessionStorage.getItem(REFRESH_KEY) ?? localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

/**
 * Mueve el token al almacén que corresponde cuando la preferencia cambia.
 *
 * SIN ESTO EL INTERRUPTOR SERÍA LETRA MUERTA hasta el siguiente ingreso: con
 * la sesión ya abierta, el token sigue en `localStorage` y seguiría
 * sobreviviendo al cierre de la pestaña aunque la persona acabara de pedir lo
 * contrario. Un interruptor que no hace nada al tocarlo es peor que no
 * tenerlo.
 */
export function reubicarSesion(): void {
  const token = leerRefresh();
  if (!token) return;
  const destino = almacenDeSesion();
  const otro = destino === sessionStorage ? localStorage : sessionStorage;
  try {
    destino.setItem(REFRESH_KEY, token);
    otro.removeItem(REFRESH_KEY);
  } catch {
    /* sin persistencia la sesión vive en memoria hasta recargar */
  }
}

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
  almacenDeSesion().setItem(REFRESH_KEY, tokens.refreshToken);
  // El otro almacén se limpia siempre: un token duplicado en el que ya no
  // manda es justamente el que sobreviviría a lo que la persona pidió.
  (almacenDeSesion() === sessionStorage ? localStorage : sessionStorage).removeItem(REFRESH_KEY);
}

export function clearSession() {
  accessToken = null;
  // Los dos, sin preguntar: cerrar sesión no puede depender de que la
  // preferencia siga siendo la misma que cuando se abrió.
  try {
    localStorage.removeItem(REFRESH_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
  } catch {
    /* nada que limpiar */
  }
}

export function hasStoredSession(): boolean {
  return leerRefresh() !== null;
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
  const refreshToken = leerRefresh();
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
  const refreshToken = leerRefresh();
  if (refreshToken) {
    await api('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }
  clearSession();
}
