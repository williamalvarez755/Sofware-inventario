import { useState } from 'react';
import { formatQ } from '@minimarket/shared';

export interface DayPoint {
  day: string; // YYYY-MM-DD
  salesCount: number;
  salesTotal: string; // centavos
  profitTotal?: string;
}

/**
 * Ventas por día — barras (magnitud sobre días discretos), una sola serie: el
 * título la nombra, así que no lleva leyenda. Extremos redondeados anclados a
 * la línea base, separación entre barras, ejes recesivos y tooltip por barra.
 * El color es el acento del tema, así que sigue al usuario.
 */
export function SalesChart({ data }: { data: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <p className="py-14 text-center text-sm text-[hsl(var(--text-3))]">
        Sin ventas en el periodo seleccionado
      </p>
    );
  }

  const values = data.map((d) => Number(d.salesTotal));
  const max = Math.max(...values, 1);
  const peak = values.indexOf(max);

  const W = 720;
  const H = 210;
  const padBottom = 28;
  const padTop = 22;
  const plotH = H - padBottom - padTop;
  const slot = W / data.length;
  const gap = Math.min(12, slot * 0.28);
  // Tope de ancho: con uno o dos días la barra se vería como una losa.
  const barW = Math.min(64, Math.max(3, slot - gap));
  const labelEvery = Math.ceil(data.length / 6);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ventas por día">
        <defs>
          <linearGradient id="barra" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent-strong))" />
            <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0.55" />
          </linearGradient>
        </defs>

        {[0.5, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={padTop + plotH * (1 - f)}
            y2={padTop + plotH * (1 - f)}
            stroke="hsl(var(--border))"
            strokeWidth={1}
            strokeDasharray="3 5"
          />
        ))}
        <line
          x1={0}
          x2={W}
          y1={padTop + plotH}
          y2={padTop + plotH}
          stroke="hsl(var(--border))"
          strokeWidth={1}
        />

        {data.map((d, i) => {
          const value = Number(d.salesTotal);
          const h = Math.max(3, (value / max) * plotH);
          const x = i * slot + (slot - barW) / 2;
          const y = padTop + plotH - h;
          const dim = hover !== null && hover !== i;
          return (
            <g key={d.day}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={5}
                fill="url(#barra)"
                opacity={dim ? 0.35 : 1}
                style={{ transition: 'opacity .15s' }}
              />
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
                <text
                  x={x + barW / 2}
                  y={y - 7}
                  textAnchor="middle"
                  className="money"
                  fill="hsl(var(--text-2))"
                  fontSize="11"
                  fontWeight="600"
                >
                  {formatQ(BigInt(d.salesTotal))}
                </text>
              )}
              {i % labelEvery === 0 && (
                <text
                  x={x + barW / 2}
                  y={H - 9}
                  textAnchor="middle"
                  fill="hsl(var(--text-3))"
                  fontSize="10"
                >
                  {d.day.slice(5).replace('-', '/')}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hover !== null && data[hover] && (
        <div className="glass pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-xl px-3 py-2 text-xs">
          <div className="font-medium text-[hsl(var(--text-1))]">
            {new Date(`${data[hover]!.day}T12:00:00`).toLocaleDateString('es-GT', {
              weekday: 'long',
              day: 'numeric',
              month: 'short',
            })}
          </div>
          <div className="money text-[hsl(var(--text-2))]">
            {formatQ(BigInt(data[hover]!.salesTotal))} · {data[hover]!.salesCount} venta(s)
          </div>
          {data[hover]!.profitTotal && (
            <div className="money text-[hsl(var(--accent-strong))]">
              Utilidad {formatQ(BigInt(data[hover]!.profitTotal!))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
