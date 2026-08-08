import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Marca } from './Marca';
import { Button, Field, Notice, Panel } from './ui';

/**
 * Cambio de contraseña. Se usa de dos formas:
 *
 *  - `obligatorio`: pantalla completa que tapa la aplicación. Es el primer
 *    ingreso de un tendero al que el super admin le dictó una contraseña por
 *    teléfono; esa clave la conocen dos personas, así que no puede quedar
 *    puesta indefinidamente.
 *  - dentro de un modal, cuando alguien la cambia por su cuenta.
 */
export function CambiarContrasena({
  obligatorio,
  onListo,
}: {
  obligatorio?: boolean;
  onListo?: () => void;
}) {
  const { cambiarContrasena, logout } = useAuth();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const noCoincide = repetir.length > 0 && nueva !== repetir;
  const corta = nueva.length > 0 && nueva.length < 8;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (noCoincide || corta) return;
    setError(null);
    setBusy(true);
    try {
      await cambiarContrasena(actual, nueva);
      onListo?.();
    } catch (e2) {
      setError(e2 instanceof ApiError ? e2.message : 'No se pudo cambiar la contraseña');
      setBusy(false);
    }
  }

  const formulario = (
    <form onSubmit={submit}>
      <Field
        label="Contraseña actual"
        type="password"
        icon="candado"
        required
        autoFocus
        autoComplete="current-password"
        value={actual}
        onChange={(e) => setActual(e.target.value)}
      />
      <Field
        label="Contraseña nueva"
        type="password"
        icon="candado"
        required
        autoComplete="new-password"
        value={nueva}
        onChange={(e) => setNueva(e.target.value)}
        className="mt-3"
        error={corta ? 'Debe tener al menos 8 caracteres' : undefined}
        hint={corta ? undefined : 'Mínimo 8 caracteres'}
      />
      <Field
        label="Repita la contraseña nueva"
        type="password"
        icon="candado"
        required
        autoComplete="new-password"
        value={repetir}
        onChange={(e) => setRepetir(e.target.value)}
        className="mt-3"
        error={noCoincide ? 'No coincide con la anterior' : undefined}
      />

      {error && (
        <div className="mt-4">
          <Notice tone="danger" icon="alerta">{error}</Notice>
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={busy}
        disabled={noCoincide || corta}
        className="mt-5 w-full"
      >
        Guardar contraseña
      </Button>

      <p className="mt-3 text-center text-xs text-[hsl(var(--text-3))]">
        Al guardarla se cerrarán las demás sesiones abiertas.
      </p>
    </form>
  );

  if (!obligatorio) return formulario;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="surgir w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <Marca size={48} />
          <h1 className="font-display mt-4 text-2xl font-semibold text-[hsl(var(--text-1))]">
            Cambie su contraseña
          </h1>
          <p className="mt-1.5 max-w-sm text-sm text-[hsl(var(--text-2))]">
            La que está usando se la entregaron para el primer ingreso. Elija una que solo
            usted conozca antes de continuar.
          </p>
        </div>
        <Panel className="p-6">{formulario}</Panel>
        <button
          onClick={logout}
          className="mx-auto mt-4 block text-xs text-[hsl(var(--text-3))] transition-colors hover:text-[hsl(var(--text-1))]"
        >
          Salir
        </button>
      </div>
    </div>
  );
}
