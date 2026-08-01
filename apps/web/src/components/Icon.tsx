/**
 * Juego de iconos propio: trazo de 1.6 px sobre rejilla de 24, sin relleno.
 * Se dibujan a mano —en vez de traer una librería— para que todos compartan
 * el mismo peso óptico y hereden `currentColor`; una mezcla de sets se nota
 * enseguida y es justo lo que hace que una interfaz parezca ensamblada.
 * Ningún emoji: en Windows se ven de un color que ningún tema puede corregir.
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
  | 'tienda';

const PATHS: Record<IconName, React.ReactNode> = {
  inicio: (
    <>
      <path d="M3 10.2 12 3l9 7.2" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M9.5 20v-6h5v6" />
    </>
  ),
  'punto-venta': (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M7 20h10" />
      <path d="M7 8h6M7 11.5h3" />
    </>
  ),
  caja: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v5M18 9.5v5" />
    </>
  ),
  productos: (
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </>
  ),
  compras: (
    <>
      <path d="M3 5h2.2l2.3 10.5h9.8L19 8H6.2" />
      <circle cx="9" cy="19" r="1.4" />
      <circle cx="17" cy="19" r="1.4" />
    </>
  ),
  gastos: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <path d="M2.5 10h19" />
      <path d="M6 14.5h4" />
    </>
  ),
  proveedores: (
    <>
      <path d="M2.5 16V8.5h10V16z" />
      <path d="M12.5 11h4l3 3v2h-7z" />
      <circle cx="6.5" cy="18" r="1.6" />
      <circle cx="16.5" cy="18" r="1.6" />
    </>
  ),
  reportes: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 16.5V12M12.5 16.5V7.5M17 16.5v-6" />
    </>
  ),
  campana: (
    <>
      <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5" />
      <path d="M10 18.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  salir: (
    <>
      <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
      <path d="M10 8 6 12l4 4" />
      <path d="M6 12h9" />
    </>
  ),
  ajustes: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" />
    </>
  ),
  usuario: (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  candado: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  camara: (
    <>
      <path d="M3 8.5h3.5L8 6h8l1.5 2.5H21v10H3z" />
      <circle cx="12" cy="13" r="3.2" />
    </>
  ),
  imprimir: (
    <>
      <path d="M7 9V3.5h10V9" />
      <rect x="3.5" y="9" width="17" height="7.5" rx="1.5" />
      <path d="M7 14h10v6.5H7z" />
    </>
  ),
  buscar: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </>
  ),
  mas: <path d="M12 5v14M5 12h14" />,
  menos: <path d="M5 12h14" />,
  cerrar: <path d="m6 6 12 12M18 6 6 18" />,
  cheque: <path d="m4.5 12.5 5 5 10-11" />,
  alerta: (
    <>
      <path d="M12 3.5 2.5 20h19z" />
      <path d="M12 10v4.5M12 17.4v.1" />
    </>
  ),
  'flecha-derecha': (
    <>
      <path d="M4 12h15" />
      <path d="m13.5 6.5 5.5 5.5-5.5 5.5" />
    </>
  ),
  descargar: (
    <>
      <path d="M12 3.5v11" />
      <path d="m7.5 10 4.5 4.5L16.5 10" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  escudo: (
    <>
      <path d="M12 3 5 5.8v5.4c0 4.4 2.9 8.1 7 9.3 4.1-1.2 7-4.9 7-9.3V5.8z" />
      <path d="m9 12 2.2 2.2L15.3 10" />
    </>
  ),
  'sin-conexion': (
    <>
      <path d="M3 4.5 21 20" />
      <path d="M2.5 9.2a15 15 0 0 1 5-3.1M16.4 6.4a15 15 0 0 1 5.1 2.8" />
      <path d="M6.2 13a10 10 0 0 1 2.6-1.6M15 11.2a10 10 0 0 1 2.8 1.8" />
      <path d="M9.6 16.6a5 5 0 0 1 4.8 0" />
      <path d="M12 20v.1" />
    </>
  ),
  ojo: (
    <>
      <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  basura: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7v12.5a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V7" />
      <path d="M10.5 11v6M13.5 11v6" />
    </>
  ),
  editar: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m14.5 5.5 4 4" />
    </>
  ),
  tienda: (
    <>
      <path d="M4 10v10h16V10" />
      <path d="M2.5 10 5 4h14l2.5 6a3 3 0 0 1-5.5 1.6A3 3 0 0 1 12 11.6a3 3 0 0 1-4 0A3 3 0 0 1 2.5 10Z" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  className = '',
  strokeWidth = 1.6,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
