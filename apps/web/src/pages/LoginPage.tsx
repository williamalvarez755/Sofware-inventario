import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth, type LoginOutcome } from '../auth/AuthContext';
import { Icon, type IconName } from '../components/Icon';
import { BotonApariencia } from '../components/BotonApariencia';
import { Logotipo } from '../components/Marca';
import { Button, Field, Notice, Panel } from '../components/ui';

/**
 * Acceso ÚNICO (D-041): el mismo formulario sirve al tendero y al super
 * admin. El servidor resuelve de qué tipo es la cuenta y la aplicación lleva
 * a cada quien a su lugar — nadie tiene que saber que existen dos puertas.
 *
 * Composición centrada y de una sola columna. Es la única pantalla que ve
 * alguien que todavía no es cliente, y lo que tiene que hacer es dos cosas:
 * mostrar la marca con claridad y pedir dos datos. La versión anterior metía
 * aquí una columna de argumentos de venta; a quien ya es cliente eso le
 * estorba todos los días, y es la mayoría de las veces que se abre esta
 * pantalla.
 */

const RASGOS: { icon: IconName; texto: string }[] = [
  { icon: 'codigo', texto: 'Cobre escaneando' },
  { icon: 'caja', texto: 'La caja cuadra al centavo' },
  { icon: 'tendencia', texto: 'Sepa cuánto ganó' },
];

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
    <div className="relative flex min-h-screen flex-col items-center justify-center px-5 py-10">
      {/* Apariencia, discreta: aquí todavía no hay cuenta donde guardarla en
          un menú, y quien atiende junto a una ventana necesita el modo claro
          antes de poder entrar. */}
      <BotonApariencia className="absolute right-4 top-4 z-10" />

      <div className="w-full max-w-[25rem]">
        <div
          className="surgir mb-7 flex justify-center"
          style={{ '--paso': 0 } as React.CSSProperties}
        >
          <Logotipo width={236} />
        </div>

        <Panel
          as="form"
          className="surgir p-7"
          style={{ '--paso': 1 } as React.CSSProperties}
          onSubmit={onSubmit}
        >
          {challenge ? (
            <>
              <div className="mb-5 flex items-center gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent-strong))]">
                  <Icon name="escudo" size={22} />
                </span>
                <div>
                  <h1 className="font-display text-[1.05rem] font-bold leading-tight text-[hsl(var(--text-1))]">
                    Verificación en dos pasos
                  </h1>
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
            <>
              <h1 className="font-display text-[1.35rem] font-bold leading-tight text-[hsl(var(--text-1))]">
                Entre a su tienda
              </h1>
              <p className="mb-5 mt-1 text-[13.5px] text-[hsl(var(--text-3))]">
                Punto de venta, inventario y caja
              </p>
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
            </>
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
            className="mt-6 w-full"
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

        <ul
          className="surgir mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2"
          style={{ '--paso': 2 } as React.CSSProperties}
        >
          {RASGOS.map((r) => (
            <li
              key={r.texto}
              className="flex items-center gap-1.5 text-[12.5px] text-[hsl(var(--text-3))]"
            >
              <Icon name={r.icon} size={14} className="text-[hsl(var(--accent-strong))]" />
              {r.texto}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
