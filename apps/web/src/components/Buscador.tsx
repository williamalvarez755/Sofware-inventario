import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { TODOS, tono, type Modulo } from './navegacion';
import { cx } from './ui';

/**
 * Ir a cualquier parte sin buscar el módulo con la vista.
 *
 * Se abre con Ctrl/⌘ + K o tocando el campo de la barra. Es la respuesta a
 * "reduce los pasos innecesarios": desde cualquier pantalla, tres teclas y el
 * nombre aproximado de lo que se quiere llevan directo ahí. Busca también por
 * sinónimos (`alias`) porque nadie escribe "punto de venta" cuando lo que
 * tiene en la cabeza es "cobrar".
 *
 * Sin dependencias: una lista filtrada y las flechas del teclado alcanzan.
 */

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function coincide(m: Modulo, q: string): boolean {
  if (!q) return true;
  const campos = [m.label, m.desc, ...(m.alias ?? [])].map(normalizar);
  return campos.some((c) => c.includes(q));
}

export function Buscador({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const resultados = useMemo(() => {
    const term = normalizar(q.trim());
    return TODOS.filter((m) => coincide(m, term));
  }, [q]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSel(0);
  }, [q]);

  function ir(m: Modulo | undefined) {
    if (!m) return;
    navigate(m.to);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') return onClose();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, resultados.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      ir(resultados[sel]);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-[hsl(var(--bg-deep)/0.6)] p-4 pt-[12vh] backdrop-blur-md"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar en el sistema"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="surgir glass-raised w-full max-w-lg overflow-hidden rounded-2xl"
      >
        <div className="flex items-center gap-3 border-b border-[hsl(var(--border)/0.7)] px-4">
          <Icon name="buscar" size={18} className="shrink-0 text-[hsl(var(--text-3))]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar: vender, caja, productos…"
            aria-label="Buscar"
            className="h-14 w-full border-0 bg-transparent text-[15px] text-[hsl(var(--text-1))] placeholder:text-[hsl(var(--text-3))] focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded-md border border-[hsl(var(--border))] px-1.5 py-0.5 text-[10px] font-semibold text-[hsl(var(--text-3))] sm:block">
            Esc
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-1.5">
          {resultados.length === 0 && (
            <p className="px-3 py-10 text-center text-sm text-[hsl(var(--text-3))]">
              Nada coincide con “{q}”
            </p>
          )}
          {resultados.map((m, i) => (
            <button
              key={m.to}
              onClick={() => ir(m)}
              onMouseEnter={() => setSel(i)}
              style={i === sel ? { background: tono(m, 0.12) } : undefined}
              className={cx(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                i !== sel && 'hover:bg-[hsl(var(--text-1)/0.05)]',
              )}
            >
              <span
                style={{ background: tono(m, i === sel ? 0.2 : 0.13) }}
                className="flex size-9 shrink-0 items-center justify-center rounded-xl"
              >
                <Icon name={m.icon} size={18} color={tono(m)} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[hsl(var(--text-1))]">
                  {m.label}
                </span>
                <span className="block truncate text-xs text-[hsl(var(--text-3))]">{m.desc}</span>
              </span>
              {i === sel && (
                <Icon name="flecha-derecha" size={15} color={tono(m)} className="shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Ctrl/⌘ + K en cualquier pantalla. Un solo listener para toda la app. */
export function useAtajoBuscador(abrir: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        abrir();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abrir]);
}
