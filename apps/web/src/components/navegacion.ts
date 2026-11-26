import type { IconName } from './Icon';

/**
 * EL MAPA DEL PRODUCTO.
 *
 * Antes los ocho módulos vivían en una sola fila horizontal, todos al mismo
 * nivel y en el mismo tamaño. Eso obliga a quien abre el sistema por primera
 * vez a leer las ocho etiquetas y deducir solo cuál necesita.
 *
 * Ahora están agrupados por LO QUE LA PERSONA ESTÁ HACIENDO, no por el
 * modelo de datos:
 *
 *   · Mostrador      — lo de todos los días, con un cliente enfrente.
 *   · Inventario     — lo que entra y de dónde viene.
 *   · Administración — el dinero que sale y cómo va el negocio.
 *
 * Tres grupos de dos o tres elementos se recorren de un vistazo; ocho
 * elementos sueltos, no. El orden además es el del día de un tendero: abre,
 * vende, cuadra; repone cuando se le acaba algo; revisa al final.
 *
 * Esta tabla es la ÚNICA fuente: la usan la barra lateral, la barra inferior
 * del teléfono, el buscador de acciones y el tablero de inicio. Agregar un
 * módulo es agregar una fila aquí.
 */

export interface Modulo {
  to: string;
  label: string;
  icon: IconName;
  /** Una línea en el idioma del tendero: qué resuelve, no cómo se llama. */
  desc: string;
  /**
   * Color propio del módulo. Es el sufijo de la variable `--tono-*`, que el
   * CSS define con un valor por modo. Ocho iconos del mismo color se leen
   * como una lista y obligan a leer las etiquetas; con un tono cada uno, el
   * icono se vuelve la referencia y la mano aprende el camino.
   */
  tono: string;
  /** Palabras por las que alguien podría buscarlo. */
  alias?: string[];
}

/** El color del módulo, listo para `style`. Con `alfa` para fondos y aros. */
export function tono(m: Modulo, alfa?: number): string {
  return alfa === undefined
    ? `hsl(var(--tono-${m.tono}))`
    : `hsl(var(--tono-${m.tono}) / ${alfa})`;
}

export interface GrupoModulos {
  titulo: string;
  items: Modulo[];
}

export const INICIO: Modulo = {
  to: '/',
  label: 'Inicio',
  icon: 'inicio',
  tono: 'inicio',
  desc: 'Cómo va el día',
  alias: ['tablero', 'resumen', 'dashboard'],
};

export const GRUPOS: GrupoModulos[] = [
  {
    titulo: 'Mostrador',
    items: [
      {
        to: '/pos',
        label: 'Vender',
        icon: 'punto-venta',
        tono: 'vender',
        desc: 'Cobrar al cliente',
        alias: ['pos', 'punto de venta', 'cobrar', 'caja registradora', 'escanear'],
      },
      {
        to: '/caja',
        label: 'Caja',
        icon: 'caja',
        tono: 'caja',
        desc: 'Turno, retiros y cierre',
        alias: ['arqueo', 'cierre', 'turno', 'efectivo', 'retiro'],
      },
    ],
  },
  {
    titulo: 'Inventario',
    items: [
      {
        to: '/productos',
        label: 'Productos',
        icon: 'productos',
        tono: 'productos',
        desc: 'Catálogo y existencias',
        alias: ['catalogo', 'stock', 'precios', 'codigo de barras', 'kardex'],
      },
      {
        to: '/compras',
        label: 'Compras',
        icon: 'compras',
        tono: 'compras',
        desc: 'Mercadería que entra',
        alias: ['recepcion', 'ingreso', 'factura de proveedor'],
      },
      {
        to: '/proveedores',
        label: 'Proveedores',
        icon: 'proveedores',
        tono: 'proveedores',
        desc: 'A quién le compra',
        alias: ['distribuidor', 'nit'],
      },
    ],
  },
  {
    titulo: 'Administración',
    items: [
      {
        to: '/gastos',
        label: 'Gastos',
        icon: 'gastos',
        tono: 'gastos',
        desc: 'Salidas de dinero',
        alias: ['egresos', 'pagos', 'servicios'],
      },
      {
        to: '/usuarios',
        label: 'Usuarios',
        icon: 'usuario',
        tono: 'usuarios',
        desc: 'Quién entra y qué puede hacer',
        alias: ['cajeros', 'empleados', 'permisos', 'roles', 'personal'],
      },
      {
        to: '/reportes',
        label: 'Reportes',
        icon: 'reportes',
        tono: 'reportes',
        desc: 'Utilidades y auditoría',
        alias: ['informes', 'utilidad', 'margen', 'csv', 'exportar'],
      },
    ],
  },
];

/** Todos los módulos en una lista plana, Inicio primero. */
export const TODOS: Modulo[] = [INICIO, ...GRUPOS.flatMap((g) => g.items)];

/**
 * Los cuatro de la barra inferior del teléfono. Son los que se usan con un
 * cliente enfrente; el resto vive detrás de "Más", que no estorba.
 */
export const EN_TELEFONO: Modulo[] = [
  INICIO,
  GRUPOS[0]!.items[0]!,
  GRUPOS[0]!.items[1]!,
  GRUPOS[1]!.items[0]!,
];

/** El módulo que corresponde a una ruta, para titular la pantalla. */
export function moduloDe(pathname: string): Modulo | undefined {
  return TODOS.find((m) => m.to === pathname);
}
