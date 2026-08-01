import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { platformApi, setPlatformSession } from '../../api/platformClient';
import { Icon } from '../../components/Icon';
import { ThemePicker } from '../../components/ThemePicker';
import { Button, Field, Notice, Panel } from '../../components/ui';

type LoginResponse =
  | { requiresTwoFactor: true; challengeToken: string }
  | { accessToken: string; refreshToken: string };

export function PlatformLoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = challenge
        ? await platformApi<{ accessToken: string; refreshToken: string }>(
            '/api/platform/auth/2fa/login',
            { method: 'POST', body: JSON.stringify({ challengeToken: challenge, code }) },
          )
        : await platformApi<LoginResponse>('/api/platform/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username: username.trim(), password }),
          });

      if ('requiresTwoFactor' in data) {
        setChallenge(data.challengeToken);
        setCode('');
        return;
      }
      setPlatformSession(data);
      navigate('/plataforma', { replace: true });
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
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="glass mb-4 flex size-14 items-center justify-center rounded-2xl text-[hsl(var(--accent))]">
            <Icon name="escudo" size={26} />
          </span>
          <h1 className="font-display text-[26px] font-semibold tracking-tight text-[hsl(var(--text-1))]">
            Plataforma
          </h1>
          <p className="mt-1 text-sm text-[hsl(var(--text-3))]">
            Administración del servicio
          </p>
        </div>

        <Panel as="form" className="p-6" onSubmit={onSubmit}>
          {challenge ? (
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
        </Panel>

        <p className="mt-6 text-center text-xs text-[hsl(var(--text-3))]">
          <a href="/login" className="font-medium text-[hsl(var(--accent-strong))] hover:underline">
            Volver al acceso de tienda
          </a>
        </p>
      </div>
    </div>
  );
}
