import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { platformApi, setPlatformSession } from '../../api/platformClient';

export function PlatformLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await platformApi<{ accessToken: string; refreshToken: string }>(
        '/api/platform/auth/login',
        { method: 'POST', body: JSON.stringify({ email, password }) },
      );
      setPlatformSession(data);
      navigate('/plataforma', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar con el servidor');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <h1 className="text-2xl font-bold text-slate-800">Panel de plataforma</h1>
        <p className="mt-1 text-sm text-slate-500">Administración del SaaS</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Correo</span>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-800"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Contraseña</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-800"
            />
          </label>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
