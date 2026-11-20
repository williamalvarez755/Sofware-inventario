import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth, type LoginOutcome } from '../auth/AuthContext';
import { Icon, type IconName } from '../components/Icon';
import { Marca } from '../components/Marca';
import { ThemePicker } from '../components/ThemePicker';
import { Button, Field, Notice, Panel } from '../components/ui';

/**
 * Acceso ÚNICO (D-041): el mismo formulario sirve al tendero y al super
 * admin. El servidor resuelve de qué tipo es la cuenta y la aplicación lleva
 * a cada quien a su lugar — nadie tiene que saber que existen dos puertas.
 *
 * Composición en dos columnas en pantalla grande: a la izquierda qué es esto,
 * a la derecha el formulario. Es la única pantalla que ve alguien que todavía
 * no es cliente, así que vale la pena que diga algo además de pedir datos.
 * En teléfono la columna izquierda desaparece: ahí lo único que importa es
 * entrar rápido al mostrador.
 */

const RASGOS: { icon: IconName; texto: string }[] = [
  { icon: 'codigo', texto: 'Cobre escaneando, sin teclear precios' },
  { icon: 'caja', texto: 'La caja cuadra al centavo en cada turno' },
  { icon: 'reportes', texto: 'Sepa cuánto ganó, producto por producto' },
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
    <div className="relative min-h-screen">
      <div className="absolute right-4 top-4 z-10">
        <ThemePicker />
      </div>

      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-14 px-5 py-12 lg:grid-cols-[1.05fr_26rem] lg:gap-20">
        {/* --- Columna de presentación (solo en pantalla grande) --- */}
        <section className="hidden lg:block">
          <div className="surgir flex items-center gap-3" style={{ '--paso': 0 } as React.CSSProperties}>
            <Marca size={44} />
            <span className="font-display text-xl font-semibold text-[hsl(var(--text-1))]">
              MiniMarket
            </span>
          </div>

          <h1
            className="surgir font-display mt-9 max-w-xl text-[3.4rem] font-semibold leading-[1.02] tracking-tight text-[hsl(var(--text-1))]"
            style={{ '--paso': 1 } as React.CSSProperties}
          >
            Su tienda,
            <br />
            <span className="text-[hsl(var(--accent-strong))]">cuadrada</span> todos los días.
          </h1>

          <p
            className="surgir mt-5 max-w-md text-[17px] leading-relaxed text-[hsl(var(--text-2))]"
            style={{ '--paso': 2 } as React.CSSProperties}
          >
            Punto de venta, inventario y caja para tiendas de barrio y mini markets.
            Hecho para el mostrador, no para la oficina.
          </p>

          <ul className="mt-10 space-y-3.5">
            {RASGOS.map((r, i) => (
              <li
                key={r.texto}
                className="surgir flex items-center gap-3.5"
                style={{ '--paso': 3 + i } as React.CSSProperties}
              >
                <span className="glass-soft flex size-10 shrink-0 items-center justify-center rounded-xl text-[hsl(var(--accent-strong))]">
                  <Icon name={r.icon} size={19} />
                </span>
                <span className="text-[15px] text-[hsl(var(--text-2))]">{r.texto}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* --- Columna del formulario --- */}
        <section className="surgir mx-auto w-full max-w-[26rem]" style={{ '--paso': 1 } as React.CSSProperties}>
          <div className="mb-7 flex flex-col items-center text-center lg:hidden">
            <Marca size={56} className="mb-4" />
            <h1 className="font-display text-[28px] font-semibold text-[hsl(var(--text-1))]">
              MiniMarket
            </h1>
            <p className="mt-1 text-sm text-[hsl(var(--text-3))]">
              Punto de venta, inventario y caja
            </p>
          </div>

          <Panel as="form" className="p-7" onSubmit={onSubmit}>
            {challenge ? (
              <>
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-[hsl(var(--accent)/0.14)] text-[hsl(var(--accent-strong))]">
                    <Icon name="escudo" size={22} />
                  </span>
                  <div>
                    <h2 className="font-display text-lg font-semibold leading-tight text-[hsl(var(--text-1))]">
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
              <>
                <h2 className="font-display mb-5 hidden text-[1.4rem] font-semibold leading-tight text-[hsl(var(--text-1))] lg:block">
                  Entre a su tienda
                </h2>
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
        </section>
      </div>
    </div>
  );
}
