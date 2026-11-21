import { useTheme } from '../theme/ThemeProvider';
import { ACCENTS, type Mode } from '../theme/themes';
import { Icon, type IconName } from './Icon';
import { cx } from './ui';

/**
 * Apariencia. Vive dentro del menú de la cuenta, no como un botón suelto en
 * la barra: es algo que se toca una vez y no vuelve a tocarse, así que no
 * merece ocupar sitio permanente al lado de la campana.
 *
 * Dos controles y nada más. El interruptor de vidrio desapareció: el material
 * es parte de la identidad del producto y no se apaga. Quien necesite menos
 * transparencia lo dice en su sistema operativo
 * (`prefers-reduced-transparency`) y el CSS lo atiende.
 */

const MODOS: { id: Mode; label: string; icon: IconName }[] = [
  { id: 'claro', label: 'Claro', icon: 'sol' },
  { id: 'oscuro', label: 'Oscuro', icon: 'luna' },
  { id: 'sistema', label: 'Sistema', icon: 'monitor' },
];

export function ThemePicker() {
  const { mode, accent, setMode, setAccent } = useTheme();

  return (
    <div className="space-y-3.5">
      <div>
        <p className="rotulo mb-1.5">Apariencia</p>
        <div className="glass-soft grid grid-cols-3 gap-1 rounded-xl p-1">
          {MODOS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              aria-pressed={mode === m.id}
              className={cx(
                'flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition-colors',
                mode === m.id
                  ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-ink))]'
                  : 'text-[hsl(var(--text-2))] hover:bg-[hsl(var(--text-1)/0.07)] hover:text-[hsl(var(--text-1))]',
              )}
            >
              <Icon name={m.icon} size={16} />
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="rotulo mb-1.5">Color</p>
        <div className="flex gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAccent(a.id)}
              aria-pressed={accent === a.id}
              title={a.name}
              aria-label={`Color ${a.name}`}
              className={cx(
                'size-7 rounded-full transition-transform duration-200 hover:scale-110',
                accent === a.id
                  ? 'ring-2 ring-[hsl(var(--text-1)/0.65)] ring-offset-2 ring-offset-[hsl(var(--surface-1))]'
                  : 'ring-1 ring-[hsl(var(--text-1)/0.18)]',
              )}
              style={{ background: a.swatch }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
