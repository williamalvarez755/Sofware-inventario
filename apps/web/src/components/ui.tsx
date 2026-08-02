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

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[hsl(var(--accent))] text-[hsl(var(--accent-ink))] hover:bg-[hsl(var(--accent-strong))] shadow-[0_6px_20px_-8px_hsl(var(--accent)/0.7)]',
  ghost: 'text-[hsl(var(--text-2))] hover:text-[hsl(var(--text-1))] hover:bg-white/[0.06]',
  outline:
    'border border-white/10 bg-white/[0.03] text-[hsl(var(--text-1))] hover:bg-white/[0.07] hover:border-white/20',
  danger:
    'border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/50',
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
        'inline-flex items-center justify-center font-medium transition-all duration-150',
        'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
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

const FIELD_BASE =
  'w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 text-sm text-[hsl(var(--text-1))] ' +
  'placeholder:text-[hsl(var(--text-3))] transition-colors duration-150 ' +
  'hover:border-white/[0.14] focus:border-[hsl(var(--accent))] focus:bg-white/[0.06] focus:outline-none';

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
          className={cx(FIELD_BASE, 'h-11', icon && 'pl-10', error && 'border-red-500/60')}
        />
      </div>
      {error ? (
        <p className="mt-1.5 text-xs text-red-400">{error}</p>
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
  neutral: 'bg-white/[0.07] text-[hsl(var(--text-2))] border-white/10',
  accent: 'bg-[hsl(var(--accent)/0.16)] text-[hsl(var(--accent-strong))] border-[hsl(var(--accent)/0.3)]',
  ok: 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25',
  warn: 'bg-amber-500/12 text-amber-300 border-amber-500/25',
  danger: 'bg-red-500/12 text-red-300 border-red-500/25',
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
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
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
            'surgir glass my-auto w-full rounded-2xl p-6 outline-none',
            wide ? 'max-w-2xl' : 'max-w-md',
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-[hsl(var(--text-1))]">
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
            <tr className="border-b border-white/[0.07]">
              {head.map((h, i) => (
                <th
                  key={i}
                  className={cx(
                    'px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-3))]',
                    i === 0 ? 'text-left' : typeof h === 'string' && /^[A-ZÁÉÍÓÚ]/.test(h) ? 'text-left' : 'text-left',
                  )}
                >
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
        'border-b border-white/[0.04] last:border-0 transition-colors',
        onClick ? 'cursor-pointer hover:bg-white/[0.04]' : 'hover:bg-white/[0.025]',
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
        ? 'text-red-400'
        : 'text-[hsl(var(--text-1))]';
  const pastilla =
    tone === 'accent'
      ? 'bg-[hsl(var(--accent)/0.16)] text-[hsl(var(--accent-strong))]'
      : tone === 'danger'
        ? 'bg-red-500/12 text-red-400'
        : 'bg-white/[0.06] text-[hsl(var(--text-2))]';

  return (
    <Panel className="group relative overflow-hidden p-4">
      {spark && spark.length > 1 && <Sparkline points={spark} tone={tone} />}
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--text-3))]">
            {label}
          </p>
          <p className={cx('money mt-2 text-[27px] font-bold leading-none', color)}>{value}</p>
          {hint && <p className="mt-2 text-xs text-[hsl(var(--text-3))]">{hint}</p>}
        </div>
        {icon && (
          <span
            className={cx(
              'flex size-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105',
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
  const stroke =
    tone === 'danger' ? 'rgb(248 113 113)' : 'hsl(var(--accent))';

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
