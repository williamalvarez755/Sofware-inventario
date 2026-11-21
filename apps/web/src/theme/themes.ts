/**
 * Tema de la aplicación.
 *
 * Dos ejes, y solo dos:
 *   · MODO — claro, oscuro o el del sistema. Por omisión sigue al equipo:
 *     un mostrador junto a una ventana al mediodía pide claro, y la misma
 *     tienda a las ocho de la noche pide oscuro. Que lo decida la máquina es
 *     una decisión menos para el tendero.
 *   · ACENTO — el color de lo accionable. Por omisión el azul del logotipo.
 *
 * Ya NO existe el interruptor de vidrio: el material es obligatorio y forma
 * parte de la identidad del producto. Lo único que lo atenúa es
 * `prefers-reduced-transparency`, que se resuelve en CSS.
 *
 * Las superficies viven en el CSS (`:root` y `:root[data-mode='claro']`): el
 * modo es una decisión de material, no de datos. Lo único que esta capa
 * inyecta es el acento, que sí es elección de quien usa el sistema.
 *
 * Cada acento trae su pareja por modo, porque un color que contrasta sobre
 * vidrio oscuro se pierde sobre papel. `--accent-ink` es el texto SOBRE el
 * acento; `--accent-strong` es la variante de más contraste para texto.
 */

export type Mode = 'claro' | 'oscuro' | 'sistema';
export type ResolvedMode = 'claro' | 'oscuro';

export interface Accent {
  id: string;
  name: string;
  /** Muestra del selector. */
  swatch: string;
  oscuro: Record<string, string>;
  claro: Record<string, string>;
}

/**
 * Cuatro acentos, todos de croma contenido y emparentados con el azul del
 * logotipo. No hay un rojo ni un verde manzana a propósito: esos colores ya
 * significan algo en este producto (peligro, correcto) y usarlos como acento
 * rompería la lectura de los estados.
 */
export const ACCENTS: Accent[] = [
  {
    id: 'marino',
    name: 'Azul Minimarket',
    swatch: '#3d7fe0',
    oscuro: {
      '--accent': '216 68% 60%',
      '--accent-strong': '214 78% 72%',
      '--accent-ink': '217 60% 9%',
    },
    claro: {
      '--accent': '217 68% 47%',
      '--accent-strong': '218 72% 38%',
      '--accent-ink': '210 45% 99%',
    },
  },
  {
    id: 'turquesa',
    name: 'Turquesa',
    swatch: '#3fa8a8',
    oscuro: {
      '--accent': '184 44% 52%',
      '--accent-strong': '184 52% 64%',
      '--accent-ink': '188 55% 8%',
    },
    claro: {
      '--accent': '188 56% 33%',
      '--accent-strong': '190 62% 26%',
      '--accent-ink': '185 40% 99%',
    },
  },
  {
    id: 'indigo',
    name: 'Índigo',
    swatch: '#7b7ee0',
    oscuro: {
      '--accent': '239 52% 68%',
      '--accent-strong': '239 62% 78%',
      '--accent-ink': '240 50% 9%',
    },
    claro: {
      '--accent': '240 48% 53%',
      '--accent-strong': '241 54% 44%',
      '--accent-ink': '235 40% 99%',
    },
  },
  {
    id: 'grafito',
    name: 'Grafito',
    swatch: '#8a94a6',
    oscuro: {
      '--accent': '215 16% 62%',
      '--accent-strong': '214 22% 76%',
      '--accent-ink': '217 30% 10%',
    },
    claro: {
      '--accent': '216 18% 38%',
      '--accent-strong': '217 24% 28%',
      '--accent-ink': '210 25% 99%',
    },
  },
];

export const DEFAULT_MODE: Mode = 'sistema';
export const DEFAULT_ACCENT = 'marino';

const STORAGE_KEY = 'mm.tema';

export interface ThemeChoice {
  mode: Mode;
  accent: string;
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
      };
    }
  } catch {
    /* almacenamiento bloqueado: se usa el tema por omisión */
  }
  return { mode: DEFAULT_MODE, accent: DEFAULT_ACCENT };
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
  if (typeof window === 'undefined' || !window.matchMedia) return 'claro';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
}

/** Color de la barra del navegador móvil, para que acompañe al tema. */
export function browserBarColor(mode: ResolvedMode): string {
  return mode === 'claro' ? '#eef2f8' : '#171d28';
}

/** Escribe en :root. Es lo único que toca el DOM de forma global. */
export function applyTheme(choice: ThemeChoice): ResolvedMode {
  const resolved = resolveMode(choice.mode);
  const accent = ACCENTS.find((a) => a.id === choice.accent) ?? ACCENTS[0]!;
  const root = document.documentElement;

  root.dataset.mode = resolved;
  for (const [key, value] of Object.entries(accent[resolved])) {
    root.style.setProperty(key, value);
  }
  return resolved;
}
