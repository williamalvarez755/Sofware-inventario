/**
 * Primitivas de interfaz. Todo lo visual del sistema pasa por aquí: si un
 * botón o un campo se dibuja a mano en una página, tarde o temprano se sale
 * del tema. Los colores se escriben contra las variables, nunca fijos.
 */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ');

// ─────────────────────────────── Botón ───────────────────────────────

type Variant = 'primary' | 'ghost' | 'outline' | 'danger';

/**
 * El primario lleva un reflejo interior en el canto superior y un halo del
 * propio acento debajo: es el mismo truco del vidrio aplicado a una pieza
 * sólida, y es lo que hace que el botón parezca tener volumen en vez de ser
 * un rectángulo de color.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[hsl(var(--accent))] text-[hsl(var(--accent-ink))] ' +
    'shadow-[inset_0_1px_0_hsl(0_0%_100%/0.28),0_6px_18px_-8px_hsl(var(--accent)/0.75)] ' +
    'hover:bg-[hsl(var(--accent-strong))] hover:shadow-[inset_0_1px_0_hsl(0_0%_100%/0.34),0_10px_26px_-10px_hsl(var(--accent)/0.9)]',
  ghost:
    'text-[hsl(var(--text-2))] hover:text-[hsl(var(--text-1))] hover:bg-[hsl(var(--text-1)/0.07)]',
  outline:
    'border border-[hsl(var(--border))] bg-[hsl(var(--text-1)/0.035)] text-[hsl(var(--text-1))] ' +
    'shadow-[inset_0_1px_0_hsl(var(--glass-tint)/calc(var(--glass-spec)*0.8))] ' +
    'hover:bg-[hsl(var(--text-1)/0.08)] hover:border-[hsl(var(--text-1)/0.28)]',
  danger:
    'border border-[hsl(var(--danger)/0.32)] bg-[hsl(var(--danger)/0.11)] text-[hsl(var(--danger))] hover:bg-[hsl(var(--danger)/0.2)] hover:border-[hsl(var(--danger)/0.5)]',
};

const SIZES = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-base gap-2.5 rounded-xl',
};

export function Button({
  variant = 'outline',
  size = 'md',
  icon,
  iconRight,
  loading,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: keyof typeof SIZES;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center font-semibold transition-all duration-200',
        'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Spinner /> : icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={size === 'sm' ? 15 : 17} />}
    </button>
  );
}

function Spinner() {
  return (
    <span
      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden
    />
  );
}

/** Botón cuadrado de solo icono; exige etiqueta accesible. */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  variant?: Variant;
}) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-all duration-150',
        'active:scale-95 disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        className,
      )}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

// ─────────────────────────────── Superficies ───────────────────────────────

/**
 * Superficie de vidrio. Reenvía el resto de props al elemento (`onSubmit`
 * cuando se usa como formulario, por ejemplo): sin esto, un formulario se
 * enviaría de forma nativa y recargaría la página.
 */
export function Panel({
  children,
  className,
  as: Tag = 'div',
  ...rest
}: HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  as?: 'div' | 'section' | 'aside' | 'form';
}) {
  return (
    <Tag {...rest} className={cx('glass rounded-2xl', className)}>
      {children}
    </Tag>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-display text-[15px] font-semibold text-[hsl(var(--text-1))]">
        {children}
      </h2>
      {action}
    </div>
  );
}

// ─────────────────────────────── Campos ───────────────────────────────

/** El campo hundido: sombra interior arriba, como si el vidrio se rebajara.
 *  Al enfocar aparece un halo del acento — se ve dónde está el cursor desde
 *  el otro lado del mostrador. */
const FIELD_BASE =
  'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--text-1)/0.045)] px-3.5 text-sm text-[hsl(var(--text-1))] ' +
  'placeholder:text-[hsl(var(--text-3))] transition-all duration-200 ' +
  'shadow-[inset_0_1px_2px_hsl(var(--shadow-color)/calc(var(--shadow-strength)*0.5))] ' +
  'hover:border-[hsl(var(--text-1)/0.22)] ' +
  'focus:border-[hsl(var(--accent))] focus:bg-[hsl(var(--text-1)/0.07)] focus:outline-none ' +
  'focus:shadow-[0_0_0_3px_hsl(var(--accent)/0.16)]';

export function Field({
  label,
  hint,
  error,
  icon,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
  icon?: IconName;
}) {
  const id = useId();
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-[hsl(var(--text-2))]">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--text-3))]">
            <Icon name={icon} size={17} />
          </span>
        )}
        <input
          {...props}
          id={id}
          aria-invalid={Boolean(error) || undefined}
          className={cx(FIELD_BASE, 'h-11', icon && 'pl-10', error && 'border-[hsl(var(--danger)/0.6)]')}
        />
      </div>
      {error ? (
        <p className="mt-1.5 text-xs text-[hsl(var(--danger))]">{error}</p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-[hsl(var(--text-3))]">{hint}</p>
      )}
    </div>
  );
}

export function Select({
  label,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  const id = useId();
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-[hsl(var(--text-2))]">
          {label}
        </label>
      )}
      <select
        {...props}
        id={id}
        className={cx(
          FIELD_BASE,
          'h-11 cursor-pointer appearance-none bg-[hsl(var(--surface-2))] pr-9',
          // Flecha dibujada como fondo: evita el control nativo del sistema.
          "bg-[image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")] bg-[length:16px] bg-[position:right_0.75rem_center] bg-no-repeat",
        )}
      >
        {children}
      </select>
    </div>
  );
}

// ─────────────────────────────── Distintivos ───────────────────────────────

const TONES = {
  neutral: 'bg-[hsl(var(--text-1)/0.08)] text-[hsl(var(--text-2))] border-[hsl(var(--border))]',
  accent: 'bg-[hsl(var(--accent)/0.16)] text-[hsl(var(--accent-strong))] border-[hsl(var(--accent)/0.3)]',
  ok: 'bg-[hsl(var(--ok)/0.13)] text-[hsl(var(--ok))] border-[hsl(var(--ok)/0.28)]',
  warn: 'bg-[hsl(var(--warn)/0.13)] text-[hsl(var(--warn))] border-[hsl(var(--warn)/0.28)]',
  danger: 'bg-[hsl(var(--danger)/0.13)] text-[hsl(var(--danger))] border-[hsl(var(--danger)/0.28)]',
} as const;

export function Badge({
  children,
  tone = 'neutral',
  icon,
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
  icon?: IconName;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        TONES[tone],
      )}
    >
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

/** Aviso de una línea. `tone` decide el color; el icono nunca va solo. */
export function Notice({
  tone = 'neutral',
  icon,
  children,
  onClose,
}: {
  tone?: keyof typeof TONES;
  icon?: IconName;
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div
      role="status"
      className={cx(
        'flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm',
        TONES[tone],
      )}
    >
      {icon && <Icon name={icon} size={17} className="mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1 whitespace-pre-line">{children}</div>
      {onClose && (
        <button onClick={onClose} aria-label="Cerrar aviso" className="shrink-0 opacity-60 hover:opacity-100">
          <Icon name="cerrar" size={15} />
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────── Modal ───────────────────────────────

const ModalCtx = createContext<() => void>(() => {});
export const useModalClose = () => useContext(ModalCtx);

export function Modal({
  title,
  description,
  onClose,
  children,
  wide,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape cierra y el foco entra al panel: se puede operar sin mouse, que es
  // como se trabaja en un mostrador con las manos ocupadas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Portal al body: si el modal se quedara dentro de un ancestro con
  // `position: sticky` y z-index —como la barra de navegación— quedaría
  // atrapado en ese contexto de apilamiento y saldría recortado.
  return createPortal(
    <ModalCtx.Provider value={onClose}>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[hsl(var(--bg-deep)/0.6)] p-4 backdrop-blur-md"
        onClick={onClose}
      >
        <div
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
          className={cx(
            'surgir glass-raised my-auto w-full rounded-[1.25rem] p-6 outline-none',
            wide ? 'max-w-2xl' : 'max-w-md',
          )}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-[1.35rem] font-semibold leading-tight text-[hsl(var(--text-1))]">
                {title}
              </h2>
              {description && (
                <p className="mt-1 text-sm text-[hsl(var(--text-2))]">{description}</p>
              )}
            </div>
            <IconButton icon="cerrar" label="Cerrar" onClick={onClose} />
          </div>
          {children}
        </div>
      </div>
    </ModalCtx.Provider>,
    document.body,
  );
}

// ─────────────────────────────── Tabla ───────────────────────────────

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[hsl(var(--border)/0.85)] bg-[hsl(var(--text-1)/0.025)]">
              {head.map((h, i) => (
                <th key={i} className="rotulo px-4 py-3 text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export function Row({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      className={cx(
        'border-b border-[hsl(var(--border)/0.55)] last:border-0 transition-colors',
        onClick ? 'cursor-pointer hover:bg-[hsl(var(--text-1)/0.045)]' : 'hover:bg-[hsl(var(--text-1)/0.03)]',
      )}
    >
      {children}
    </tr>
  );
}

export function Cell({
  children,
  align = 'left',
  mono,
  className,
  colSpan,
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  mono?: boolean;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cx(
        'px-4 py-3 text-[hsl(var(--text-2))]',
        align === 'right' && 'text-right',
        mono && 'money text-[hsl(var(--text-1))]',
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: IconName }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
      {icon && <Icon name={icon} size={28} className="text-[hsl(var(--text-3))]" />}
      <p className="text-sm text-[hsl(var(--text-3))]">{children}</p>
    </div>
  );
}

// ─────────────────────────────── Indicadores ───────────────────────────────

/**
 * Tarjeta de indicador. El icono va en una pastilla del color del dato —no
 * suelto en una esquina— para que la tarjeta se lea como una unidad y no como
 * texto con un adorno. `spark` dibuja la tendencia detrás del número: da
 * contexto sin ocupar espacio ni pedir otro gráfico.
 */
export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  spark,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'accent' | 'danger';
  icon?: IconName;
  spark?: number[];
}) {
  const color =
    tone === 'accent'
      ? 'text-[hsl(var(--accent-strong))]'
      : tone === 'danger'
        ? 'text-[hsl(var(--danger))]'
        : 'text-[hsl(var(--text-1))]';
  const pastilla =
    tone === 'accent'
      ? 'bg-[hsl(var(--accent)/0.16)] text-[hsl(var(--accent-strong))]'
      : tone === 'danger'
        ? 'bg-[hsl(var(--danger)/0.13)] text-[hsl(var(--danger))]'
        : 'bg-[hsl(var(--text-1)/0.07)] text-[hsl(var(--text-2))]';

  return (
    <Panel className="group relative overflow-hidden p-4 transition-transform duration-300 hover:-translate-y-0.5">
      {spark && spark.length > 1 && <Sparkline points={spark} tone={tone} />}
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="rotulo">{label}</p>
          <p className={cx('money mt-2 text-[27px] font-extrabold leading-none', color)}>{value}</p>
          {hint && <p className="mt-2 text-xs text-[hsl(var(--text-3))]">{hint}</p>}
        </div>
        {icon && (
          <span
            className={cx(
              'flex size-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3',
              pastilla,
            )}
          >
            <Icon name={icon} size={18} />
          </span>
        )}
      </div>
    </Panel>
  );
}

/** Tendencia de fondo: área suave, sin ejes ni etiquetas — es contexto, no dato. */
function Sparkline({ points, tone }: { points: number[]; tone: 'neutral' | 'accent' | 'danger' }) {
  const max = Math.max(...points, 1);
  const W = 100;
  const H = 30;
  const step = points.length > 1 ? W / (points.length - 1) : W;
  const coords = points.map((p, i) => `${i * step},${H - (p / max) * H}`);
  const stroke = tone === 'danger' ? 'hsl(var(--danger))' : 'hsl(var(--accent))';

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-14 w-full opacity-[0.22]"
      aria-hidden
    >
      <polygon points={`0,${H} ${coords.join(' ')} ${W},${H}`} fill={stroke} opacity="0.35" />
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export { cx };
