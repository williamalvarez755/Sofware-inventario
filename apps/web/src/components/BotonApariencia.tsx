import { useState } from 'react';
import { Icon } from './Icon';
import { ThemePicker } from './ThemePicker';

/**
 * Acceso a la apariencia desde una barra, en un botón de un solo icono.
 *
 * Existe porque hay dos pantallas sin menú de cuenta donde guardarla —el
 * ingreso y el panel de plataforma— y en ambas el selector completo no cabe
 * en línea. Dentro de la aplicación de tienda, la apariencia vive en el menú
 * de la cuenta, que es donde la busca quien ya entró.
 */
export function BotonApariencia({ className = '' }: { className?: string }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setAbierto((a) => !a)}
        aria-label="Apariencia"
        aria-expanded={abierto}
        title="Apariencia"
        className="inline-flex size-9 items-center justify-center rounded-xl text-[hsl(var(--text-2))] transition-colors hover:bg-[hsl(var(--text-1)/0.07)] hover:text-[hsl(var(--text-1))]"
      >
        <Icon name="paleta" size={18} />
      </button>
      {abierto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAbierto(false)} aria-hidden />
          <div className="glass-raised surgir absolute right-0 z-50 mt-2 w-64 rounded-2xl p-4">
            <ThemePicker />
          </div>
        </>
      )}
    </div>
  );
}
