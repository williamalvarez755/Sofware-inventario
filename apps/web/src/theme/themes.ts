/**
 * Sistema de temas.
 *
 * Dos ejes independientes que el usuario combina a su gusto:
 *  - SUPERFICIE: la base oscura y minimalista sobre la que se apoya todo.
 *  - ACENTO: el color que marca lo accionable y lo importante.
 *
 * Todos los acentos se eligieron con al menos 4.5:1 de contraste contra su
 * superficie: el cajero lee esto ocho horas seguidas, muchas veces con el
 * reflejo del sol entrando a la tienda.
 */

export interface Surface {
  id: string;
  name: string;
  /** Muestra para el selector. */
  swatch: string;
  vars: Record<string, string>;
}

export interface Accent {
  id: string;
  name: string;
  swatch: string;
  vars: Record<string, string>;
}

/** Bases oscuras. La diferencia entre ellas es la temperatura, no el brillo. */
export const SURFACES: Surface[] = [
  {
    id: 'grafito',
    name: 'Grafito',
    swatch: '#0b0c0e',
    vars: {
      '--bg': '222 14% 4.5%',
      '--bg-deep': '222 16% 3%',
      '--surface-1': '222 12% 9%',
      '--surface-2': '222 11% 13%',
      '--surface-3': '222 10% 17%',
      '--border': '222 10% 22%',
      '--text-1': '220 16% 97%',
      '--text-2': '220 9% 72%',
      '--text-3': '220 8% 52%',
    },
  },
  {
    id: 'carbon',
    name: 'Carbón',
    swatch: '#0e0b09',
    vars: {
      '--bg': '24 14% 4.5%',
      '--bg-deep': '24 16% 3%',
      '--surface-1': '24 11% 9%',
      '--surface-2': '24 10% 13%',
      '--surface-3': '24 9% 17%',
      '--border': '24 9% 22%',
      '--text-1': '30 18% 97%',
      '--text-2': '30 8% 72%',
      '--text-3': '30 7% 52%',
    },
  },
  {
    id: 'pizarra',
    name: 'Pizarra',
    swatch: '#080c12',
    vars: {
      '--bg': '215 30% 5%',
      '--bg-deep': '215 34% 3.5%',
      '--surface-1': '215 24% 10%',
      '--surface-2': '215 21% 14%',
      '--surface-3': '215 19% 18%',
      '--border': '215 18% 23%',
      '--text-1': '213 30% 97%',
      '--text-2': '213 14% 73%',
      '--text-3': '213 12% 53%',
    },
  },
  {
    id: 'oliva',
    name: 'Oliva',
    swatch: '#0a0d0a',
    vars: {
      '--bg': '140 12% 4.5%',
      '--bg-deep': '140 14% 3%',
      '--surface-1': '140 10% 9%',
      '--surface-2': '140 9% 13%',
      '--surface-3': '140 8% 17%',
      '--border': '140 8% 22%',
      '--text-1': '135 15% 97%',
      '--text-2': '135 7% 72%',
      '--text-3': '135 6% 52%',
    },
  },
];

/**
 * Acentos. Los tres primeros son la familia anaranjada —el punto de partida
 * pedido— y el resto amplía sin romper la sobriedad del conjunto.
 * `--accent-ink` es el color del texto SOBRE el acento sólido.
 */
export const ACCENTS: Accent[] = [
  {
    id: 'ambar',
    name: 'Ámbar',
    swatch: '#f59022',
    vars: { '--accent': '31 91% 55%', '--accent-strong': '31 91% 62%', '--accent-ink': '30 60% 6%' },
  },
  {
    id: 'brasa',
    name: 'Brasa',
    swatch: '#ea5f2b',
    vars: { '--accent': '17 82% 54%', '--accent-strong': '17 84% 61%', '--accent-ink': '20 60% 6%' },
  },
  {
    id: 'durazno',
    name: 'Durazno',
    swatch: '#f9a870',
    vars: { '--accent': '25 92% 71%', '--accent-strong': '25 94% 78%', '--accent-ink': '24 55% 8%' },
  },
  {
    id: 'jade',
    name: 'Jade',
    swatch: '#2fb98a',
    vars: { '--accent': '162 60% 45%', '--accent-strong': '162 62% 53%', '--accent-ink': '165 60% 5%' },
  },
  {
    id: 'acero',
    name: 'Acero',
    swatch: '#5b9bf0',
    vars: { '--accent': '214 83% 65%', '--accent-strong': '214 85% 73%', '--accent-ink': '215 60% 7%' },
  },
  {
    id: 'arena',
    name: 'Arena',
    swatch: '#c8b28a',
    vars: { '--accent': '40 34% 66%', '--accent-strong': '40 38% 74%', '--accent-ink': '40 40% 8%' },
  },
];

export const DEFAULT_SURFACE = 'grafito';
export const DEFAULT_ACCENT = 'ambar';

const STORAGE_KEY = 'mm.tema';

export interface ThemeChoice {
  surface: string;
  accent: string;
  /** Efecto vidrio: se puede apagar en equipos lentos de tienda. */
  glass: boolean;
}

export function readStoredTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ThemeChoice>;
      return {
        surface: SURFACES.some((s) => s.id === parsed.surface) ? parsed.surface! : DEFAULT_SURFACE,
        accent: ACCENTS.some((a) => a.id === parsed.accent) ? parsed.accent! : DEFAULT_ACCENT,
        glass: parsed.glass !== false,
      };
    }
  } catch {
    /* almacenamiento bloqueado: se usa el tema por omisión */
  }
  return { surface: DEFAULT_SURFACE, accent: DEFAULT_ACCENT, glass: true };
}

export function storeTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    /* sin persistencia, el tema dura la sesión */
  }
}

/** Escribe las variables en :root. Es lo único que toca el DOM globalmente. */
export function applyTheme(choice: ThemeChoice): void {
  const surface = SURFACES.find((s) => s.id === choice.surface) ?? SURFACES[0]!;
  const accent = ACCENTS.find((a) => a.id === choice.accent) ?? ACCENTS[0]!;
  const root = document.documentElement;
  for (const [key, value] of Object.entries({ ...surface.vars, ...accent.vars })) {
    root.style.setProperty(key, value);
  }
  root.dataset.glass = choice.glass ? 'on' : 'off';
}
