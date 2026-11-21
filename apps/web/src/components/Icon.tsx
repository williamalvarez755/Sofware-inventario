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
  | 'codigo'
  | 'menu'
  | 'colapsar'
  | 'sol'
  | 'luna'
  | 'monitor'
  | 'paleta'
  | 'rayo'
  | 'reloj'
  | 'tendencia'
  | 'etiqueta'
  | 'cuadricula'
  | 'flecha-izquierda';

interface Glifo {
  /** Silueta de fondo, rellena y suave. */
  fondo?: React.ReactNode;
  /** Trazo principal. */
  trazo: React.ReactNode;
}

const GLIFOS: Record<IconName, Glifo> = {
  inicio: {
    fondo: <path d="M12 2.9 20.9 9.7v9.4a2.1 2.1 0 0 1-2.1 2.1H5.2a2.1 2.1 0 0 1-2.1-2.1V9.7L12 2.9Z" />,
    trazo: (
      <>
        <path d="M3.1 9.9 12 2.9l8.9 7" />
        <path d="M5.3 9v10.1a2.1 2.1 0 0 0 2.1 2.1h9.2a2.1 2.1 0 0 0 2.1-2.1V9" />
        <path d="M9.7 21.2v-4.8a2.3 2.3 0 0 1 4.6 0v4.8" />
      </>
    ),
  },
  'punto-venta': {
    fondo: (
      <path d="M5.5 4.6a1.3 1.3 0 0 1 1.3-1.3h10.4a1.3 1.3 0 0 1 1.3 1.3v16.1l-2.2-1.5-2.1 1.5-2.2-1.5-2.1 1.5-2.2-1.5-2.2 1.5V4.6Z" />
    ),
    trazo: (
      <>
        <path d="M5.5 20.7V4.6a1.3 1.3 0 0 1 1.3-1.3h10.4a1.3 1.3 0 0 1 1.3 1.3v16.1l-2.2-1.5-2.1 1.5-2.2-1.5-2.1 1.5-2.2-1.5-2.2 1.5Z" />
        <path d="M8.7 7.9h6.6" />
        <path d="M8.7 11.4h4.3" />
      </>
    ),
  },
  caja: {
    fondo: <rect x="2.7" y="6.9" width="18.6" height="12.4" rx="2.5" />,
    trazo: (
      <>
        <rect x="2.7" y="6.9" width="18.6" height="12.4" rx="2.5" />
        <path d="M2.7 11.9h18.6" />
        <path d="M8.3 6.9v5M15.7 6.9v5" />
        <path d="M9.9 15.8h4.2" />
      </>
    ),
  },
  productos: {
    fondo: <path d="M12 2.8 20.9 7.5v9L12 21.2 3.1 16.5v-9L12 2.8Z" />,
    trazo: (
      <>
        <path d="M20.9 16.5v-9L12 2.8 3.1 7.5v9L12 21.2l8.9-4.7Z" />
        <path d="M3.3 7.6 12 12.2l8.7-4.6" />
        <path d="M12 12.2v9" />
        <path d="m7.4 5.1 8.8 4.7" />
      </>
    ),
  },
  compras: {
    fondo: <path d="M3.2 12.9h17.6v5.6a2.3 2.3 0 0 1-2.3 2.3H5.5a2.3 2.3 0 0 1-2.3-2.3v-5.6Z" />,
    trazo: (
      <>
        <path d="M3.2 12.9v5.6a2.3 2.3 0 0 0 2.3 2.3h13a2.3 2.3 0 0 0 2.3-2.3v-5.6" />
        <path d="M3.2 12.9h4.9l1.1 2.1h5.6l1.1-2.1h4.9" />
        <path d="M12 2.7v6.8" />
        <path d="m8.8 6.4 3.2 3.3 3.2-3.3" />
      </>
    ),
  },
  gastos: {
    fondo: <rect x="2.6" y="5.7" width="14.6" height="9.8" rx="2.1" />,
    trazo: (
      <>
        <path d="M17.2 10.4V7.8a2.1 2.1 0 0 0-2.1-2.1H4.7a2.1 2.1 0 0 0-2.1 2.1v5.6a2.1 2.1 0 0 0 2.1 2.1h5.6" />
        <circle cx="9.9" cy="10.6" r="2.3" />
        <path d="m14.3 21 6.1-6.1" />
        <path d="M15.6 14.9h4.8v4.8" />
      </>
    ),
  },
  proveedores: {
    fondo: <path d="M2.6 8.6a1.6 1.6 0 0 1 1.6-1.6h7a1.6 1.6 0 0 1 1.6 1.6v7.6H2.6V8.6Z" />,
    trazo: (
      <>
        <path d="M2.6 16.2V8.6A1.6 1.6 0 0 1 4.2 7h7a1.6 1.6 0 0 1 1.6 1.6v7.6" />
        <path d="M12.8 10.5h3a1.7 1.7 0 0 1 1.3.6l2.2 2.7a1.7 1.7 0 0 1 .4 1.1v1.3h-6.9" />
        <path d="M2.6 16.2h2.3M9.3 16.2h3.5" />
        <circle cx="7.1" cy="17.9" r="1.8" />
        <circle cx="17" cy="17.9" r="1.8" />
      </>
    ),
  },
  reportes: {
    fondo: (
      <>
        <rect x="7" y="12.4" width="3.2" height="5" rx="1.6" />
        <rect x="11.4" y="9.4" width="3.2" height="8" rx="1.6" />
        <rect x="15.8" y="6.4" width="3.2" height="11" rx="1.6" />
      </>
    ),
    trazo: (
      <>
        <path d="M3.6 3.3v15.3a2.4 2.4 0 0 0 2.4 2.4h15" />
        <g strokeWidth="3.1">
          <path d="M8.6 17.3v-3.3" />
          <path d="M13 17.3v-6.3" />
          <path d="M17.4 17.3v-9.3" />
        </g>
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
  menu: {
    trazo: (
      <>
        <path d="M4 7h16" />
        <path d="M4 12h16" />
        <path d="M4 17h10" />
      </>
    ),
  },
  colapsar: {
    fondo: <rect x="3" y="4" width="18" height="16" rx="2.6" />,
    trazo: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2.6" />
        <path d="M10 4v16" />
      </>
    ),
  },
  sol: {
    fondo: <circle cx="12" cy="12" r="4.2" />,
    trazo: (
      <>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.6v2.2M12 19.2v2.2M4.2 12H2M22 12h-2.2M6.4 6.4 4.9 4.9M19.1 19.1l-1.5-1.5M17.6 6.4l1.5-1.5M4.9 19.1l1.5-1.5" />
      </>
    ),
  },
  luna: {
    fondo: <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z" />,
    trazo: <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z" />,
  },
  monitor: {
    fondo: <rect x="2.6" y="4.2" width="18.8" height="12.4" rx="2.2" />,
    trazo: (
      <>
        <rect x="2.6" y="4.2" width="18.8" height="12.4" rx="2.2" />
        <path d="M8.4 20.4h7.2M12 16.6v3.8" />
      </>
    ),
  },
  paleta: {
    fondo: <path d="M12 3.2a8.8 8.8 0 0 0 0 17.6c1.2 0 1.8-.8 1.8-1.7 0-.9-.7-1.4-.7-2.2 0-.8.6-1.4 1.5-1.4h1.6a4.6 4.6 0 0 0 4.6-4.6c0-4.3-3.9-7.7-8.8-7.7Z" />,
    trazo: (
      <>
        <path d="M12 3.2a8.8 8.8 0 0 0 0 17.6c1.2 0 1.8-.8 1.8-1.7 0-.9-.7-1.4-.7-2.2 0-.8.6-1.4 1.5-1.4h1.6a4.6 4.6 0 0 0 4.6-4.6c0-4.3-3.9-7.7-8.8-7.7Z" />
        <circle cx="7.6" cy="11.4" r="1" />
        <circle cx="10.4" cy="7.4" r="1" />
        <circle cx="15.2" cy="8.2" r="1" />
      </>
    ),
  },
  rayo: {
    fondo: <path d="M13.2 2.6 5 13.4h5.2l-.6 8 8.4-11.2h-5.4l.6-7.6Z" />,
    trazo: <path d="M13.2 2.6 5 13.4h5.2l-.6 8 8.4-11.2h-5.4l.6-7.6Z" />,
  },
  reloj: {
    fondo: <circle cx="12" cy="12" r="8.8" />,
    trazo: (
      <>
        <circle cx="12" cy="12" r="8.8" />
        <path d="M12 7.2V12l3.2 1.9" />
      </>
    ),
  },
  tendencia: {
    trazo: (
      <>
        <path d="M3.4 16.6 9 11l3.6 3.4 7-7.4" />
        <path d="M15.4 7h4.2v4.2" />
      </>
    ),
  },
  etiqueta: {
    fondo: <path d="M3.6 10.6V4.8a1.2 1.2 0 0 1 1.2-1.2h5.8a1.6 1.6 0 0 1 1.1.5l8 8a1.6 1.6 0 0 1 0 2.3l-5.9 5.9a1.6 1.6 0 0 1-2.3 0l-8-8a1.6 1.6 0 0 1-.5-1.1Z" />,
    trazo: (
      <>
        <path d="M3.6 10.6V4.8a1.2 1.2 0 0 1 1.2-1.2h5.8a1.6 1.6 0 0 1 1.1.5l8 8a1.6 1.6 0 0 1 0 2.3l-5.9 5.9a1.6 1.6 0 0 1-2.3 0l-8-8a1.6 1.6 0 0 1-.5-1.1Z" />
        <circle cx="7.9" cy="7.9" r="1.3" />
      </>
    ),
  },
  cuadricula: {
    fondo: (
      <>
        <rect x="3.4" y="3.4" width="7.4" height="7.4" rx="2" />
        <rect x="13.2" y="13.2" width="7.4" height="7.4" rx="2" />
      </>
    ),
    trazo: (
      <>
        <rect x="3.4" y="3.4" width="7.4" height="7.4" rx="2" />
        <rect x="13.2" y="3.4" width="7.4" height="7.4" rx="2" />
        <rect x="3.4" y="13.2" width="7.4" height="7.4" rx="2" />
        <rect x="13.2" y="13.2" width="7.4" height="7.4" rx="2" />
      </>
    ),
  },
  'flecha-izquierda': {
    trazo: (
      <>
        <path d="M19 12H5.4" />
        <path d="m11 5.6-5.6 6.4 5.6 6.4" />
      </>
    ),
  },
};

export function Icon({
  name,
  size = 20,
  className = '',
  strokeWidth = 1.7,
  color,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
  /** Color propio del glifo (los módulos traen el suyo). Todo el dibujo usa
   *  `currentColor`, así que basta con fijarlo aquí. Sin él, hereda. */
  color?: string;
}) {
  const glifo = GLIFOS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={color ? { color } : undefined}
      aria-hidden="true"
      focusable="false"
    >
      {glifo.fondo && (
        <g fill="currentColor" opacity="0.2" stroke="none">
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
