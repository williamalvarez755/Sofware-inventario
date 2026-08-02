/**
 * Marca del producto: el toldo de una tienda de barrio.
 *
 * Sustituye al icono de caja registradora, que a tamaño pequeño se leía como
 * un rectángulo con ruido dentro. Un toldo es reconocible al instante, dice
 * "tienda" sin ambigüedad y aguanta bien desde 24 px.
 * Toma el acento del tema, así que cambia con la apariencia elegida.
 */
export function Marca({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 48 48" width={size} height={size}>
        <defs>
          <linearGradient id="marca-fondo" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent-strong))" />
            <stop offset="100%" stopColor="hsl(var(--accent))" />
          </linearGradient>
        </defs>

        {/* Cuerpo redondeado con el degradado del acento */}
        <rect x="0" y="0" width="48" height="48" rx="14" fill="url(#marca-fondo)" />
        {/* Brillo superior: da el canto biselado del resto del sistema */}
        <rect x="0" y="0" width="48" height="48" rx="14" fill="url(#marca-brillo)" />
        <defs>
          <linearGradient id="marca-brillo" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.28" />
            <stop offset="55%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g fill="hsl(var(--accent-ink))">
          {/* Toldo: tres ondas, como la lona de una tienda de esquina */}
          <path d="M10 16h28a0 0 0 0 1 0 0v5.5a3.2 3.2 0 0 1-4.7 2.8 3.2 3.2 0 0 1-4.6 0 3.2 3.2 0 0 1-4.7 0 3.2 3.2 0 0 1-4.7 0 3.2 3.2 0 0 1-4.6 0A3.2 3.2 0 0 1 10 21.5V16Z" />
          {/* Faja del toldo */}
          <rect x="9" y="13" width="30" height="3.6" rx="1.8" />
          {/* Mostrador: sugiere el local sin recargar */}
          <path
            d="M13.5 26.5h21V36a1.5 1.5 0 0 1-1.5 1.5H15a1.5 1.5 0 0 1-1.5-1.5v-9.5Z"
            opacity="0.28"
          />
          {/* Puerta */}
          <path d="M20.5 30.5h7a0 0 0 0 1 0 0v7h-7v-7Z" opacity="0.85" />
        </g>
      </svg>
    </span>
  );
}
