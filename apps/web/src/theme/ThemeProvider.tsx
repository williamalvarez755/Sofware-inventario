import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { SURFACES, applyTheme, readStoredTheme, storeTheme, type ThemeChoice } from './themes';

interface ThemeState extends ThemeChoice {
  setSurface(id: string): void;
  setAccent(id: string): void;
  setGlass(on: boolean): void;
}

const ThemeCtx = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(choice);
    storeTheme(choice);
    // La barra del navegador móvil acompaña el tema elegido.
    const meta = document.querySelector('meta[name="theme-color"]');
    const surface = SURFACES.find((s) => s.id === choice.surface);
    if (meta && surface) meta.setAttribute('content', surface.swatch);
  }, [choice]);

  const value = useMemo<ThemeState>(
    () => ({
      ...choice,
      setSurface: (surface) => setChoice((c) => ({ ...c, surface })),
      setAccent: (accent) => setChoice((c) => ({ ...c, accent })),
      setGlass: (glass) => setChoice((c) => ({ ...c, glass })),
    }),
    [choice],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme debe usarse dentro de ThemeProvider');
  return ctx;
}
