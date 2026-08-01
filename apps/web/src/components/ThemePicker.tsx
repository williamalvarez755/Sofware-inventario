import { useState } from 'react';
import { ACCENTS, SURFACES } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { IconButton, Modal, cx } from './ui';

/**
 * Selector de apariencia. Dos ejes que se combinan libremente —superficie y
 * acento— más un interruptor para apagar el vidrio en equipos lentos, que en
 * tiendas reales son la norma y no la excepción.
 */
export function ThemePicker() {
  const [open, setOpen] = useState(false);
  const theme = useTheme();

  return (
    <>
      <IconButton icon="ajustes" label="Apariencia" onClick={() => setOpen(true)} />
      {open && (
        <Modal
          title="Apariencia"
          description="Elija el fondo y el color de acento. Se guarda en este equipo."
          onClose={() => setOpen(false)}
        >
          <fieldset>
            <legend className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--text-3))]">
              Fondo
            </legend>
            <div className="grid grid-cols-4 gap-2">
              {SURFACES.map((s) => {
                const active = theme.surface === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => theme.setSurface(s.id)}
                    aria-pressed={active}
                    className={cx(
                      'group flex flex-col items-center gap-2 rounded-xl border p-3 transition-all',
                      active
                        ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.08)]'
                        : 'border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04]',
                    )}
                  >
                    <span
                      className="size-9 rounded-lg border border-white/10 shadow-inner"
                      style={{ background: s.swatch }}
                    />
                    <span
                      className={cx(
                        'text-[11px] font-medium',
                        active ? 'text-[hsl(var(--accent-strong))]' : 'text-[hsl(var(--text-2))]',
                      )}
                    >
                      {s.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--text-3))]">
              Acento
            </legend>
            <div className="grid grid-cols-6 gap-2">
              {ACCENTS.map((a) => {
                const active = theme.accent === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => theme.setAccent(a.id)}
                    aria-pressed={active}
                    title={a.name}
                    className={cx(
                      'flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-all',
                      active
                        ? 'border-[hsl(var(--accent))] bg-white/[0.06]'
                        : 'border-transparent hover:bg-white/[0.04]',
                    )}
                  >
                    <span
                      className="relative flex size-8 items-center justify-center rounded-full"
                      style={{ background: a.swatch }}
                    >
                      {active && (
                        <Icon name="cheque" size={16} className="text-black/70" strokeWidth={2.6} />
                      )}
                    </span>
                    <span className="text-[10px] text-[hsl(var(--text-3))]">{a.name}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3.5">
            <input
              type="checkbox"
              checked={theme.glass}
              onChange={(e) => theme.setGlass(e.target.checked)}
              className="mt-0.5 size-4 accent-[hsl(var(--accent))]"
            />
            <span>
              <span className="block text-sm font-medium text-[hsl(var(--text-1))]">
                Efecto vidrio
              </span>
              <span className="block text-xs text-[hsl(var(--text-3))]">
                Desactívelo si la pantalla del punto de venta se siente lenta.
              </span>
            </span>
          </label>
        </Modal>
      )}
    </>
  );
}
