import { useState } from 'react';
import { ACCENTS, type Mode } from '../theme/themes';
import { useTheme } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { IconButton, Modal, cx } from './ui';

/**
 * Selector de apariencia.
 *
 * Cada modo se elige viendo una miniatura de cómo queda, no leyendo su
 * nombre: "Claro" y "Oscuro" se entienden, pero ver el contraste real evita
 * la prueba y error de quien nunca cambió un tema en su vida.
 */

const MODOS: { id: Mode; nombre: string; pista: string }[] = [
  { id: 'claro', nombre: 'Claro', pista: 'Para mostrador con sol' },
  { id: 'oscuro', nombre: 'Oscuro', pista: 'Para turno de noche' },
  { id: 'sistema', nombre: 'Automático', pista: 'Sigue al equipo' },
];

/** Miniatura del tema: una barra, un panel y una cifra. */
function Miniatura({ modo }: { modo: Mode }) {
  const claro = modo === 'claro';
  const auto = modo === 'sistema';
  const papel = claro ? '#f7f3ec' : '#1f1d1b';
  const panel = claro ? '#ffffff' : '#2b2825';
  const trazo = claro ? '#2a241e' : '#f2ece2';

  return (
    <span
      className="relative block h-14 w-full overflow-hidden rounded-lg ring-1 ring-inset ring-[hsl(var(--border))]"
      style={{ background: papel }}
      aria-hidden
    >
      {auto && (
        // La mitad derecha en oscuro: se entiende que cambia solo.
        <span className="absolute inset-y-0 right-0 w-1/2" style={{ background: '#1f1d1b' }} />
      )}
      <span
        className="absolute left-2 right-2 top-2 h-2.5 rounded-sm"
        style={{ background: panel, opacity: 0.9 }}
      />
      <span
        className="absolute bottom-2 left-2 h-4 w-10 rounded-sm"
        style={{ background: 'hsl(var(--accent))' }}
      />
      <span
        className="absolute bottom-3 right-2 h-2 w-6 rounded-sm"
        style={{ background: auto ? '#f2ece2' : trazo, opacity: 0.45 }}
      />
    </span>
  );
}

export function ThemePicker() {
  const [open, setOpen] = useState(false);
  const theme = useTheme();

  return (
    <>
      <IconButton icon="ajustes" label="Apariencia" onClick={() => setOpen(true)} />
      {open && (
        <Modal
          title="Apariencia"
          description="Se guarda en este equipo, no en su cuenta."
          onClose={() => setOpen(false)}
        >
          <fieldset>
            <legend className="rotulo mb-2.5">Modo</legend>
            <div className="grid grid-cols-3 gap-2.5">
              {MODOS.map((m) => {
                const activo = theme.mode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => theme.setMode(m.id)}
                    aria-pressed={activo}
                    className={cx(
                      'group rounded-xl border p-2 text-left transition-all duration-200',
                      activo
                        ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.1)] shadow-[0_0_0_3px_hsl(var(--accent)/0.12)]'
                        : 'border-[hsl(var(--border))] hover:border-[hsl(var(--text-1)/0.28)] hover:bg-[hsl(var(--text-1)/0.035)]',
                    )}
                  >
                    <Miniatura modo={m.id} />
                    <span
                      className={cx(
                        'mt-2 block text-[13px] font-semibold',
                        activo ? 'text-[hsl(var(--accent-strong))]' : 'text-[hsl(var(--text-1))]',
                      )}
                    >
                      {m.nombre}
                    </span>
                    <span className="block text-[11px] leading-tight text-[hsl(var(--text-3))]">
                      {m.pista}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="rotulo mb-2.5">Acento</legend>
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((a) => {
                const activo = theme.accent === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => theme.setAccent(a.id)}
                    aria-pressed={activo}
                    title={a.name}
                    className={cx(
                      'flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3.5 transition-all duration-200',
                      activo
                        ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.12)]'
                        : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--text-1)/0.045)]',
                    )}
                  >
                    <span
                      className="flex size-6 items-center justify-center rounded-full shadow-inner"
                      style={{ background: activo ? 'hsl(var(--accent))' : a.swatch }}
                    >
                      {activo && (
                        <Icon
                          name="cheque"
                          size={13}
                          strokeWidth={3}
                          className="text-[hsl(var(--accent-ink))]"
                        />
                      )}
                    </span>
                    <span
                      className={cx(
                        'text-[13px] font-medium',
                        activo ? 'text-[hsl(var(--accent-strong))]' : 'text-[hsl(var(--text-2))]',
                      )}
                    >
                      {a.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--text-1)/0.035)] p-3.5 transition-colors hover:bg-[hsl(var(--text-1)/0.055)]">
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
                Apáguelo si la pantalla del punto de venta se siente lenta. Las superficies
                pasan a ser sólidas y todo lo demás queda igual.
              </span>
            </span>
          </label>
        </Modal>
      )}
    </>
  );
}
