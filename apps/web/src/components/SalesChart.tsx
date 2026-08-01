import { useState } from 'react';
import { formatQ } from '@minimarket/shared';

export interface DayPoint {
  day: string; // YYYY-MM-DD
  salesCount: number;
  salesTotal: string; // centavos
  profitTotal?: string;
}

/**
 * Ventas por día — barras (magnitud sobre días discretos), una sola serie:
 * el título la nombra, así que no lleva leyenda. Extremos redondeados de 4px
 * anclados a la línea base, separación de 2px entre barras, ejes recesivos y
 * tooltip por barra. Etiquetas directas solo en el máximo, no en cada barra.
 * El color (emerald-600) está validado: ≥3:1 sobre la superficie blanca.
 */
export function SalesChart({ data }: { data: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-slate-400">
        Sin ventas en el periodo seleccionado
      </p>
    );
  }

  const values = data.map((d) => Number(d.salesTotal));
  const max = Math.max(...values, 1);
  const peak = values.indexOf(max);

  const W = 720;
  const H = 200;
  const padBottom = 26;
  const padTop = 18;
  const plotH = H - padBottom - padTop;
  const slot = W / data.length;
  const gap = Math.min(10, slot * 0.25); // deja al menos 2px de superficie
  // Tope de ancho: con uno o dos días de datos, sin él la barra se ve como una
  // losa que ocupa el gráfico entero (el caso del primer día de uso real).
  const barW = Math.min(72, Math.max(3, slot - gap));
  // Solo 5 rótulos de fecha como máximo: más se amontonan en pantallas de tienda.
  const labelEvery = Math.ceil(data.length / 5);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ventas por día">
        {/* Grid recesivo: 3 líneas guía */}
        {[0.5, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={padTop + plotH * (1 - f)}
            y2={padTop + plotH * (1 - f)}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
        ))}
        <line x1={0} x2={W} y1={padTop + plotH} y2={padTop + plotH} stroke="#cbd5e1" strokeWidth={1} />

        {data.map((d, i) => {
          const value = Number(d.salesTotal);
          const h = Math.max(2, (value / max) * plotH);
          const x = i * slot + (slot - barW) / 2; // centrada en su día
          const y = padTop + plotH - h;
          return (
            <g key={d.day}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={4}
                fill="#059669"
                opacity={hover === null || hover === i ? 1 : 0.45}
              />
              {/* Zona de interacción más grande que la barra */}
              <rect
                x={i * slot}
                y={padTop}
                width={slot}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
              {i === peak && (
                <text x={x + barW / 2} y={y - 5} textAnchor="middle" className="fill-slate-600 text-[11px] font-semibold">
                  {formatQ(BigInt(d.salesTotal))}
                </text>
              )}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={H - 8} textAnchor="middle" className="fill-slate-400 text-[10px]">
                  {d.day.slice(5).replace('-', '/')}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hover !== null && data[hover] && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-lg bg-slate-800 px-3 py-2 text-xs text-white shadow-lg">
          <div className="font-semibold">
            {new Date(`${data[hover]!.day}T12:00:00`).toLocaleDateString('es-GT', {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </div>
          <div>{formatQ(BigInt(data[hover]!.salesTotal))} · {data[hover]!.salesCount} venta(s)</div>
          {data[hover]!.profitTotal && (
            <div className="text-emerald-300">
              Utilidad {formatQ(BigInt(data[hover]!.profitTotal!))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
