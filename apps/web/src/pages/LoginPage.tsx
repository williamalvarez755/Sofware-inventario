import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth, type LoginOutcome } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { Marca } from '../components/Marca';
import { ThemePicker } from '../components/ThemePicker';
import { Button, Field, Notice, Panel } from '../components/ui';

/**
 * Acceso ÚNICO (D-041): el mismo formulario sirve al tendero y al super
 * admin. El servidor resuelve de qué tipo es la cuenta y la aplicación lleva
 * a cada quien a su lugar — nadie tiene que saber que existen dos puertas.
 */
export function LoginPage() {
  const { login, completeTwoFactor } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function encaminar(outcome: LoginOutcome) {
    if (outcome.kind === 'segundo-factor') {
      setChallenge(outcome.challengeToken);
      setCode('');
      return;
    }
    navigate(outcome.kind === 'plataforma' ? '/plataforma' : '/', { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      encaminar(
        challenge
          ? await completeTwoFactor(challenge, code)
          : await login(username.trim(), password),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemePicker />
      </div>

      <div className="surgir w-full max-w-[26rem]">
        <div className="mb-8 flex flex-col items-center text-center">
          <Marca size={60} className="mb-5" />
          <h1 className="font-display text-[30px] font-semibold tracking-tight text-[hsl(var(--text-1))]">
            MiniMarket
          </h1>
          <p className="mt-1.5 text-[15px] text-[hsl(var(--text-3))]">
            Punto de venta, inventario y caja
          </p>
        </div>

        <Panel as="form" className="p-6" onSubmit={onSubmit}>
          {challenge ? (
            <>
              <div className="mb-5 flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent))]">
                  <Icon name="escudo" size={22} />
                </span>
                <div>
                  <h2 className="font-display text-base font-semibold text-[hsl(var(--text-1))]">
                    Verificación en dos pasos
                  </h2>
                  <p className="text-[13px] text-[hsl(var(--text-3))]">
                    Escriba el código de su aplicación
                  </p>
                </div>
              </div>
              <Field
                label="Código de 6 dígitos"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                autoFocus
                required
                className="cifras"
                hint="También sirve uno de sus códigos de recuperación."
              />
            </>
          ) : (
            <div className="space-y-4">
              <Field
                label="Usuario"
                icon="usuario"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="su usuario"
                autoFocus
                required
              />
              <Field
                label="Contraseña"
                icon="candado"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />
            </div>
          )}

          {error && (
            <div className="mt-4">
              <Notice tone="danger" icon="alerta">
                {error}
              </Notice>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={busy}
            iconRight="flecha-derecha"
            className="mt-5 w-full"
          >
            {challenge ? 'Verificar' : 'Entrar'}
          </Button>

          {challenge && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              onClick={() => {
                setChallenge(null);
                setError(null);
              }}
            >
              Usar otra cuenta
            </Button>
          )}
        </Panel>
      </div>
    </div>
  );
}
