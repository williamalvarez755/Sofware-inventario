import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  applyTheme,
  browserBarColor,
  readStoredTheme,
  resolveMode,
  storeTheme,
  type Mode,
  type ResolvedMode,
  type ThemeChoice,
} from './themes';

interface ThemeState extends ThemeChoice {
  /** El modo ya traducido: "sistema" nunca llega a los componentes. */
  resolved: ResolvedMode;
  setMode(mode: Mode): void;
  setAccent(id: string): void;
  setGlass(on: boolean): void;
}

const ThemeCtx = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>(() => readStoredTheme());
  const [resolved, setResolved] = useState<ResolvedMode>(() => resolveMode(readStoredTheme().mode));

  useEffect(() => {
    setResolved(applyTheme(choice));
    storeTheme(choice);
  }, [choice]);

  // Con "sistema", seguir al equipo en vivo: si anochece y el sistema cambia
  // a oscuro, la aplicación acompaña sin que haya que recargar.
  useEffect(() => {
    if (choice.mode !== 'sistema' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const alCambiar = () => setResolved(applyTheme(choice));
    mq.addEventListener('change', alCambiar);
    return () => mq.removeEventListener('change', alCambiar);
  }, [choice]);

  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', browserBarColor(resolved));
  }, [resolved]);

  const value = useMemo<ThemeState>(
    () => ({
      ...choice,
      resolved,
      setMode: (mode) => setChoice((c) => ({ ...c, mode })),
      setAccent: (accent) => setChoice((c) => ({ ...c, accent })),
      setGlass: (glass) => setChoice((c) => ({ ...c, glass })),
    }),
    [choice, resolved],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme debe usarse dentro de ThemeProvider');
  return ctx;
}
