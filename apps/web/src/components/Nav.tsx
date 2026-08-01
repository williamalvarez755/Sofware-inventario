import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const LINKS = [
  { to: '/', label: 'Inicio' },
  { to: '/pos', label: 'POS' },
  { to: '/caja', label: 'Caja' },
  { to: '/productos', label: 'Productos' },
];

export function Nav() {
  const { me, logout } = useAuth();
  const { pathname } = useLocation();
  if (!me) return null;

  return (
    <header className="flex items-center justify-between bg-white px-6 py-3 shadow-sm">
      <div className="flex items-center gap-6">
        <span className="text-base font-bold text-emerald-700">{me.tenant.name}</span>
        <nav className="flex gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                pathname === l.to
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-500">{me.user.name}</span>
        <button
          onClick={logout}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          Salir
        </button>
      </div>
    </header>
  );
}
