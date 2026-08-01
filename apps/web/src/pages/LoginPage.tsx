import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { ThemePicker } from '../components/ThemePicker';
import { Button, Field, Notice, Panel } from '../components/ui';

export function LoginPage() {
  const { login, completeTwoFactor } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  /** Presente cuando el usuario tiene verificación en dos pasos activa. */
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (challenge) {
        await completeTwoFactor(challenge, code);
        navigate('/', { replace: true });
        return;
      }
      const outcome = await login(username.trim(), password);
      if (outcome.kind === 'segundo-factor') {
        setChallenge(outcome.challengeToken);
        setCode('');
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor',
      );
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
        {/* Marca: la caja registradora dentro de un cuadro de vidrio. */}
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="glass mb-4 flex size-14 items-center justify-center rounded-2xl text-[hsl(var(--accent))]">
            <Icon name="caja" size={26} />
          </span>
          <h1 className="font-display text-[26px] font-semibold tracking-tight text-[hsl(var(--text-1))]">
            MiniMarket
          </h1>
          <p className="mt-1 text-sm text-[hsl(var(--text-3))]">
            Punto de venta, inventario y caja
          </p>
        </div>

        <Panel as="form" className="p-6" onSubmit={onSubmit}>
          {challenge ? (
            <>
              <div className="mb-4 flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent-strong))]">
                  <Icon name="escudo" size={20} />
                </span>
                <div>
                  <h2 className="font-display text-base font-semibold text-[hsl(var(--text-1))]">
                    Verificación en dos pasos
                  </h2>
                  <p className="text-xs text-[hsl(var(--text-3))]">
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
                className="money"
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

        <p className="mt-6 text-center text-xs text-[hsl(var(--text-3))]">
          ¿Administra la plataforma?{' '}
          <a
            href="/plataforma/login"
            className="font-medium text-[hsl(var(--accent-strong))] hover:underline"
          >
            Entrar como super admin
          </a>
        </p>
      </div>
    </div>
  );
}
