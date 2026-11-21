/**
 * Marca del producto: el logotipo real de Minimarket GT.
 *
 * El archivo original es de dos tintas (azul marino #002055 y azul #0061F3)
 * sobre fondo transparente. La tinta marino desaparece sobre una superficie
 * oscura, así que se sirven DOS versiones del mismo trazo y el modo elige con
 * CSS (`.solo-claro` / `.solo-oscuro`). Se hace en CSS y no en JavaScript a
 * propósito: así el logo correcto ya está pintado en el primer fotograma, sin
 * el parpadeo de esperar a que el contexto de tema resuelva.
 *
 *  · <Marca>     — solo el símbolo (carretilla con toldo). Cuadrado.
 *  · <Logotipo>  — el conjunto con la palabra. Para la pantalla de ingreso.
 */

const RATIO_LOGOTIPO = 1200 / 719;

export function Marca({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src="/marca/simbolo.png"
        alt="Minimarket GT"
        width={size}
        height={size}
        className="solo-claro block size-full object-contain"
        draggable={false}
      />
      <img
        src="/marca/simbolo-oscuro.png"
        alt="Minimarket GT"
        width={size}
        height={size}
        className="solo-oscuro block size-full object-contain"
        draggable={false}
      />
    </span>
  );
}

export function Logotipo({ width = 220, className = '' }: { width?: number; className?: string }) {
  const height = Math.round(width / RATIO_LOGOTIPO);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width, height }}
    >
      <img
        src="/marca/logo.png"
        alt="Minimarket GT"
        width={width}
        height={height}
        className="solo-claro block size-full object-contain"
        draggable={false}
      />
      <img
        src="/marca/logo-oscuro.png"
        alt="Minimarket GT"
        width={width}
        height={height}
        className="solo-oscuro block size-full object-contain"
        draggable={false}
      />
    </span>
  );
}
