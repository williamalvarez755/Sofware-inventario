/**
 * Sistema de temas.
 *
 * Dos ejes:
 *  - MODO: claro, oscuro o el del sistema. El anterior ofrecía cuatro fondos
 *    oscuros que se diferenciaban en la temperatura y poco más; era elegir
 *    entre cuatro negros. Un modo claro de verdad sí cambia la vida de quien
 *    atiende junto a una ventana al mediodía, que es media Guatemala.
 *  - ACENTO: el color que marca lo accionable. Todos de croma bajo
 *    (~45 % de saturación): sobre un entorno casi neutro no hace falta más, y
 *    el exceso de saturación es lo que hacía que la versión anterior se
 *    sintiera dura a las ocho horas de turno.
 *
 * Las superficies viven en el CSS (`:root` y `:root[data-mode='claro']`), no
 * aquí: el modo es una decisión de material, no de datos. Lo único que esta
 * capa inyecta es el acento, que sí es elección del usuario.
 *
 * Cada acento trae su pareja por modo, porque un color que contrasta sobre
 * basalto se pierde sobre papel. `--accent-ink` es el texto SOBRE el acento.
 */

export type Mode = 'claro' | 'oscuro' | 'sistema';
export type ResolvedMode = 'claro' | 'oscuro';

export interface Accent {
  id: string;
  name: string;
  /** Muestra del selector, tomada del valor en modo oscuro. */
  swatch: string;
  oscuro: Record<string, string>;
  claro: Record<string, string>;
}

export const ACCENTS: Accent[] = [
  {
    id: 'jade',
    name: 'Jade',
    swatch: '#4fbf9b',
    oscuro: { '--accent': '165 42% 52%', '--accent-strong': '165 48% 64%', '--accent-ink': '168 55% 8%' },
    claro: { '--accent': '168 52% 30%', '--accent-strong': '168 58% 23%', '--accent-ink': '160 40% 98%' },
  },
  {
    id: 'ambar',
    name: 'Ámbar',
    swatch: '#d79a4e',
    oscuro: { '--accent': '34 56% 58%', '--accent-strong': '34 64% 68%', '--accent-ink': '32 60% 8%' },
    claro: { '--accent': '28 66% 38%', '--accent-strong': '28 72% 30%', '--accent-ink': '36 50% 98%' },
  },
  {
    id: 'cobre',
    name: 'Cobre',
    swatch: '#cf7a5d',
    oscuro: { '--accent': '14 50% 60%', '--accent-strong': '14 58% 70%', '--accent-ink': '12 50% 8%' },
    claro: { '--accent': '12 54% 42%', '--accent-strong': '12 60% 34%', '--accent-ink': '20 40% 98%' },
  },
  {
    id: 'indigo',
    name: 'Índigo',
    swatch: '#8a9ce0',
    oscuro: { '--accent': '228 44% 68%', '--accent-strong': '228 52% 77%', '--accent-ink': '230 45% 9%' },
    claro: { '--accent': '230 44% 47%', '--accent-strong': '230 50% 38%', '--accent-ink': '225 40% 98%' },
  },
  {
    id: 'pizarra',
    name: 'Pizarra',
    swatch: '#7aa6ad',
    oscuro: { '--accent': '190 24% 60%', '--accent-strong': '190 30% 71%', '--accent-ink': '195 35% 8%' },
    claro: { '--accent': '196 32% 34%', '--accent-strong': '196 38% 26%', '--accent-ink': '190 30% 98%' },
  },
];

export const DEFAULT_MODE: Mode = 'oscuro';
export const DEFAULT_ACCENT = 'jade';

const STORAGE_KEY = 'mm.tema';

export interface ThemeChoice {
  mode: Mode;
  accent: string;
  /** Efecto vidrio: se puede apagar en equipos lentos de tienda. */
  glass: boolean;
}

const MODES: Mode[] = ['claro', 'oscuro', 'sistema'];

export function readStoredTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ThemeChoice>;
      return {
        mode: MODES.includes(parsed.mode as Mode) ? (parsed.mode as Mode) : DEFAULT_MODE,
        accent: ACCENTS.some((a) => a.id === parsed.accent) ? parsed.accent! : DEFAULT_ACCENT,
        glass: parsed.glass !== false,
      };
    }
  } catch {
    /* almacenamiento bloqueado: se usa el tema por omisión */
  }
  return { mode: DEFAULT_MODE, accent: DEFAULT_ACCENT, glass: true };
}

export function storeTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    /* sin persistencia, el tema dura la sesión */
  }
}

/** Traduce "sistema" a lo que el equipo tenga configurado ahora mismo. */
export function resolveMode(mode: Mode): ResolvedMode {
  if (mode !== 'sistema') return mode;
  if (typeof window === 'undefined' || !window.matchMedia) return 'oscuro';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'oscuro';
}

/** Color de la barra del navegador móvil, para que acompañe al tema. */
export function browserBarColor(mode: ResolvedMode): string {
  return mode === 'claro' ? '#f7f3ec' : '#1c1a18';
}

/** Escribe en :root. Es lo único que toca el DOM de forma global. */
export function applyTheme(choice: ThemeChoice): ResolvedMode {
  const resolved = resolveMode(choice.mode);
  const accent = ACCENTS.find((a) => a.id === choice.accent) ?? ACCENTS[0]!;
  const root = document.documentElement;

  root.dataset.mode = resolved;
  root.dataset.glass = choice.glass ? 'on' : 'off';
  for (const [key, value] of Object.entries(accent[resolved])) {
    root.style.setProperty(key, value);
  }
  return resolved;
}
