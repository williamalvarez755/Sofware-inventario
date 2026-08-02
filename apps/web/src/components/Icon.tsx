/**
 * Juego de iconos propio, en estilo DÚOTONO: cada icono lleva una silueta
 * rellena al 18 % y encima el trazo. Esa segunda capa es lo que los separa de
 * un pictograma de línea genérico — da volumen, los hace verse más cálidos y
 * mantiene la legibilidad a 16 px, que es el tamaño de la barra.
 *
 * Todo hereda `currentColor`, así que siguen al tema. Ningún emoji: en Windows
 * se pintan con su propia paleta y ningún tema puede corregirlos.
 */

export type IconName =
  | 'inicio'
  | 'punto-venta'
  | 'caja'
  | 'productos'
  | 'compras'
  | 'gastos'
  | 'proveedores'
  | 'reportes'
  | 'campana'
  | 'salir'
  | 'ajustes'
  | 'usuario'
  | 'candado'
  | 'camara'
  | 'imprimir'
  | 'buscar'
  | 'mas'
  | 'menos'
  | 'cerrar'
  | 'cheque'
  | 'alerta'
  | 'flecha-derecha'
  | 'descargar'
  | 'escudo'
  | 'sin-conexion'
  | 'ojo'
  | 'basura'
  | 'editar'
  | 'tienda'
  | 'codigo';

interface Glifo {
  /** Silueta de fondo, rellena y suave. */
  fondo?: React.ReactNode;
  /** Trazo principal. */
  trazo: React.ReactNode;
}

const GLIFOS: Record<IconName, Glifo> = {
  inicio: {
    fondo: <path d="M12 3.4 20 9.6V19a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19V9.6L12 3.4Z" />,
    trazo: (
      <>
        <path d="M3.2 10.4 12 3.4l8.8 7" />
        <path d="M5.4 9.2V19a1.6 1.6 0 0 0 1.6 1.6h10a1.6 1.6 0 0 0 1.6-1.6V9.2" />
        <path d="M9.6 20.6v-5.4a1.4 1.4 0 0 1 1.4-1.4h2a1.4 1.4 0 0 1 1.4 1.4v5.4" />
      </>
    ),
  },
  'punto-venta': {
    fondo: <rect x="3.2" y="4.2" width="17.6" height="12" rx="2.6" />,
    trazo: (
      <>
        <rect x="3.2" y="4.2" width="17.6" height="12" rx="2.6" />
        <path d="M7.4 20.4h9.2" />
        <path d="M12 16.2v4.2" />
        <path d="M7 8.6h6.4M7 11.8h3.6" />
      </>
    ),
  },
  caja: {
    fondo: <rect x="2.6" y="6.4" width="18.8" height="11.6" rx="2.8" />,
    trazo: (
      <>
        <rect x="2.6" y="6.4" width="18.8" height="11.6" rx="2.8" />
        <circle cx="12" cy="12.2" r="2.7" />
        <path d="M6.2 10v4.4M17.8 10v4.4" />
      </>
    ),
  },
  productos: {
    fondo: <path d="M12 3.2 20.4 7.6v8.8L12 20.8 3.6 16.4V7.6L12 3.2Z" />,
    trazo: (
      <>
        <path d="M3.6 7.6 12 3.2l8.4 4.4v8.8L12 20.8l-8.4-4.4V7.6Z" />
        <path d="m3.6 7.6 8.4 4.4 8.4-4.4M12 12v8.8" />
      </>
    ),
  },
  compras: {
    fondo: <path d="M7 8.4h12.4l-1.7 7.4a1.6 1.6 0 0 1-1.6 1.2H9.6a1.6 1.6 0 0 1-1.5-1.2L7 8.4Z" />,
    trazo: (
      <>
        <path d="M2.8 4.4h2.1a1 1 0 0 1 1 .8l2.2 10.4a1.6 1.6 0 0 0 1.5 1.2h6.8a1.6 1.6 0 0 0 1.6-1.2l1.4-6.2a.9.9 0 0 0-.9-1.1H6.4" />
        <circle cx="10" cy="20" r="1.5" />
        <circle cx="17" cy="20" r="1.5" />
      </>
    ),
  },
  gastos: {
    fondo: <rect x="2.6" y="5.6" width="18.8" height="12.8" rx="2.6" />,
    trazo: (
      <>
        <rect x="2.6" y="5.6" width="18.8" height="12.8" rx="2.6" />
        <path d="M2.6 10.2h18.8" />
        <path d="M6.2 14.6h4" />
      </>
    ),
  },
  proveedores: {
    fondo: <path d="M2.6 8.4h9.8v8H2.6z" />,
    trazo: (
      <>
        <path d="M2.6 16.4v-6.6a1.4 1.4 0 0 1 1.4-1.4h8.4v8" />
        <path d="M12.4 11.2h3.7a1.4 1.4 0 0 1 1.1.5l2.6 3a1.4 1.4 0 0 1 .3.9v.8h-7.7" />
        <circle cx="6.6" cy="18" r="1.6" />
        <circle cx="16.6" cy="18" r="1.6" />
      </>
    ),
  },
  reportes: {
    fondo: (
      <>
        <rect x="6.8" y="11.4" width="3" height="5.6" rx="1.2" />
        <rect x="14.2" y="8.6" width="3" height="8.4" rx="1.2" />
      </>
    ),
    trazo: (
      <>
        <path d="M4 3.6V19a1.4 1.4 0 0 0 1.4 1.4H20" />
        <path d="M8.3 17v-5.6M12 17V9.4M15.7 17V7" />
      </>
    ),
  },
  campana: {
    fondo: <path d="M6.6 10.4a5.4 5.4 0 0 1 10.8 0c0 3.4 1.2 5 1.2 5H5.4s1.2-1.6 1.2-5Z" />,
    trazo: (
      <>
        <path d="M6.6 10.4a5.4 5.4 0 0 1 10.8 0c0 3.4 1.2 5 1.2 5H5.4s1.2-1.6 1.2-5Z" />
        <path d="M9.9 18.4a2.2 2.2 0 0 0 4.2 0" />
      </>
    ),
  },
  salir: {
    fondo: <path d="M13.6 3.6h4.2A2.2 2.2 0 0 1 20 5.8v12.4a2.2 2.2 0 0 1-2.2 2.2h-4.2v-17Z" />,
    trazo: (
      <>
        <path d="M13.6 3.6h4.2A2.2 2.2 0 0 1 20 5.8v12.4a2.2 2.2 0 0 1-2.2 2.2h-4.2" />
        <path d="m9.4 8.2-3.8 3.8 3.8 3.8" />
        <path d="M5.6 12h8.4" />
      </>
    ),
  },
  ajustes: {
    fondo: <circle cx="12" cy="12" r="3.4" />,
    trazo: (
      <>
        <circle cx="12" cy="12" r="3.4" />
        <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
      </>
    ),
  },
  usuario: {
    fondo: (
      <>
        <circle cx="12" cy="8.4" r="3.8" />
        <path d="M4.6 20.4a7.4 7.4 0 0 1 14.8 0H4.6Z" />
      </>
    ),
    trazo: (
      <>
        <circle cx="12" cy="8.4" r="3.8" />
        <path d="M4.6 20.4a7.4 7.4 0 0 1 14.8 0" />
      </>
    ),
  },
  candado: {
    fondo: <rect x="4.4" y="10.4" width="15.2" height="10.2" rx="2.6" />,
    trazo: (
      <>
        <rect x="4.4" y="10.4" width="15.2" height="10.2" rx="2.6" />
        <path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8" />
        <path d="M12 14.6v2" />
      </>
    ),
  },
  camara: {
    fondo: <path d="M3 8.8h3.6L8.2 6h7.6l1.6 2.8H21v9.4H3V8.8Z" />,
    trazo: (
      <>
        <path d="M3 18.2V8.8h3.6L8.2 6h7.6l1.6 2.8H21v9.4a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 18.2Z" />
        <circle cx="12" cy="13.2" r="3.3" />
      </>
    ),
  },
  imprimir: {
    fondo: <rect x="3.4" y="9" width="17.2" height="7.6" rx="2" />,
    trazo: (
      <>
        <path d="M7 9V4.4a.8.8 0 0 1 .8-.8h8.4a.8.8 0 0 1 .8.8V9" />
        <rect x="3.4" y="9" width="17.2" height="7.6" rx="2" />
        <path d="M7 13.6h10v6.2a.8.8 0 0 1-.8.8H7.8a.8.8 0 0 1-.8-.8v-6.2Z" />
      </>
    ),
  },
  buscar: {
    fondo: <circle cx="10.6" cy="10.6" r="6.4" />,
    trazo: (
      <>
        <circle cx="10.6" cy="10.6" r="6.4" />
        <path d="m15.4 15.4 4.4 4.4" />
      </>
    ),
  },
  mas: { trazo: <path d="M12 5.4v13.2M5.4 12h13.2" /> },
  menos: { trazo: <path d="M5.4 12h13.2" /> },
  cerrar: { trazo: <path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6" /> },
  cheque: {
    fondo: <circle cx="12" cy="12" r="9" />,
    trazo: <path d="m7.6 12.3 3 3 5.8-6.6" />,
  },
  alerta: {
    fondo: <path d="M10.7 3.9 2.9 18.2a1.5 1.5 0 0 0 1.3 2.3h15.6a1.5 1.5 0 0 0 1.3-2.3L13.3 3.9a1.5 1.5 0 0 0-2.6 0Z" />,
    trazo: (
      <>
        <path d="M10.7 3.9 2.9 18.2a1.5 1.5 0 0 0 1.3 2.3h15.6a1.5 1.5 0 0 0 1.3-2.3L13.3 3.9a1.5 1.5 0 0 0-2.6 0Z" />
        <path d="M12 9.4v4.4M12 17.1v.1" />
      </>
    ),
  },
  'flecha-derecha': {
    trazo: (
      <>
        <path d="M4.4 12h14.4" />
        <path d="m13.4 6.6 5.4 5.4-5.4 5.4" />
      </>
    ),
  },
  descargar: {
    fondo: <path d="M3.8 15.4v3.4a1.6 1.6 0 0 0 1.6 1.6h13.2a1.6 1.6 0 0 0 1.6-1.6v-3.4H3.8Z" />,
    trazo: (
      <>
        <path d="M12 3.4v11" />
        <path d="m7.6 10.2 4.4 4.4 4.4-4.4" />
        <path d="M3.8 16.6v2.2a1.6 1.6 0 0 0 1.6 1.6h13.2a1.6 1.6 0 0 0 1.6-1.6v-2.2" />
      </>
    ),
  },
  escudo: {
    fondo: <path d="M12 2.8 4.8 5.6v5.6c0 4.6 3 8.5 7.2 9.9 4.2-1.4 7.2-5.3 7.2-9.9V5.6L12 2.8Z" />,
    trazo: (
      <>
        <path d="M12 2.8 4.8 5.6v5.6c0 4.6 3 8.5 7.2 9.9 4.2-1.4 7.2-5.3 7.2-9.9V5.6L12 2.8Z" />
        <path d="m9.1 11.9 2.2 2.2 3.9-4.4" />
      </>
    ),
  },
  'sin-conexion': {
    trazo: (
      <>
        <path d="M3.2 4.4 20.8 19.8" />
        <path d="M2.4 9a15.4 15.4 0 0 1 4.9-3M16.4 6.2a15.4 15.4 0 0 1 5.2 2.8" />
        <path d="M6.1 12.9a10 10 0 0 1 2.4-1.5M15.2 11.1a10 10 0 0 1 2.7 1.8" />
        <path d="M9.5 16.5a5 5 0 0 1 4.6-.1" />
        <path d="M12 19.9v.1" />
      </>
    ),
  },
  ojo: {
    fondo: <path d="M2.6 12S6.2 6.2 12 6.2 21.4 12 21.4 12 17.8 17.8 12 17.8 2.6 12 2.6 12Z" />,
    trazo: (
      <>
        <path d="M2.6 12S6.2 6.2 12 6.2 21.4 12 21.4 12 17.8 17.8 12 17.8 2.6 12 2.6 12Z" />
        <circle cx="12" cy="12" r="2.9" />
      </>
    ),
  },
  basura: {
    fondo: <path d="M6.4 7.4h11.2l-.9 12a1.6 1.6 0 0 1-1.6 1.5H8.9a1.6 1.6 0 0 1-1.6-1.5l-.9-12Z" />,
    trazo: (
      <>
        <path d="M4.4 7.4h15.2" />
        <path d="M9.6 7.4V5.2a1 1 0 0 1 1-1h2.8a1 1 0 0 1 1 1v2.2" />
        <path d="M6.4 7.4h11.2l-.9 12a1.6 1.6 0 0 1-1.6 1.5H8.9a1.6 1.6 0 0 1-1.6-1.5l-.9-12Z" />
        <path d="M10.6 11.4v5.6M13.4 11.4v5.6" />
      </>
    ),
  },
  editar: {
    fondo: <path d="M4 20.2 4.9 16 15.6 5.3l3.1 3.1L8 19.1l-4 1.1Z" />,
    trazo: (
      <>
        <path d="M4 20.2 4.9 16 15.6 5.3a1.5 1.5 0 0 1 2.1 0l1 1a1.5 1.5 0 0 1 0 2.1L8 19.1l-4 1.1Z" />
        <path d="m14.4 6.6 3.1 3.1" />
      </>
    ),
  },
  tienda: {
    fondo: <path d="M4.4 10.6h15.2V19a1.6 1.6 0 0 1-1.6 1.6H6a1.6 1.6 0 0 1-1.6-1.6v-8.4Z" />,
    trazo: (
      <>
        <path d="M4.4 10.6V19a1.6 1.6 0 0 0 1.6 1.6h12a1.6 1.6 0 0 0 1.6-1.6v-8.4" />
        <path d="M2.8 9.4 5 4.2a1 1 0 0 1 .9-.6h12.2a1 1 0 0 1 .9.6l2.2 5.2a2.6 2.6 0 0 1-4.8 1.4 2.6 2.6 0 0 1-4.4 0 2.6 2.6 0 0 1-4.4 0 2.6 2.6 0 0 1-4.8-1.4Z" />
        <path d="M10 20.6v-4.8h4v4.8" />
      </>
    ),
  },
  // Marco de escaneo con las barras dentro: dice "código de barras" y "leer
  // con el escáner" en la misma figura.
  codigo: {
    fondo: <rect x="6.2" y="8" width="11.6" height="8" rx="1.2" />,
    trazo: (
      <>
        <path d="M3.4 9.2V7.4a1.8 1.8 0 0 1 1.8-1.8H7" />
        <path d="M17 5.6h1.8a1.8 1.8 0 0 1 1.8 1.8v1.8" />
        <path d="M20.6 14.8v1.8a1.8 1.8 0 0 1-1.8 1.8H17" />
        <path d="M7 18.4H5.2a1.8 1.8 0 0 1-1.8-1.8v-1.8" />
        <path d="M7.6 8.8v6.4M10.6 8.8v6.4M13.4 8.8v6.4M16.4 8.8v6.4" />
      </>
    ),
  },
};

export function Icon({
  name,
  size = 20,
  className = '',
  strokeWidth = 1.7,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const glifo = GLIFOS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {glifo.fondo && (
        <g fill="currentColor" opacity="0.18" stroke="none">
          {glifo.fondo}
        </g>
      )}
      <g
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {glifo.trazo}
      </g>
    </svg>
  );
}
