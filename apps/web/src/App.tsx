import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { restorePlatformSession } from './api/platformClient';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ThemeProvider } from './theme/ThemeProvider';
import { Icon } from './components/Icon';
import { CashPage } from './pages/CashPage';
import { DashboardPage } from './pages/DashboardPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { LoginPage } from './pages/LoginPage';
import { PosPage } from './pages/PosPage';
import { ProductsPage } from './pages/ProductsPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { ReportsPage } from './pages/ReportsPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { PlatformDashboardPage } from './pages/platform/PlatformDashboardPage';
import { PlatformLoginPage } from './pages/platform/PlatformLoginPage';

function Cargando() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <span className="glass flex size-12 animate-pulse items-center justify-center rounded-2xl text-[hsl(var(--accent))]">
        <Icon name="caja" size={22} />
      </span>
      <p className="text-sm text-[hsl(var(--text-3))]">Cargando…</p>
    </div>
  );
}

function Protected({ children }: { children: React.ReactElement }) {
  const { me, loading } = useAuth();
  if (loading) return <Cargando />;
  return me ? children : <Navigate to="/login" replace />;
}

/** El panel de plataforma tiene su propia sesión, aislada de la del tendero. */
function PlatformProtected({ children }: { children: React.ReactElement }) {
  const [state, setState] = useState<'loading' | 'ok' | 'anon'>('loading');
  useEffect(() => {
    restorePlatformSession().then((ok) => setState(ok ? 'ok' : 'anon'));
  }, []);
  if (state === 'loading') return <Cargando />;
  return state === 'ok' ? children : <Navigate to="/plataforma/login" replace />;
}

const PROTEGIDAS: [string, React.ReactElement][] = [
  ['/', <DashboardPage key="d" />],
  ['/pos', <PosPage key="p" />],
  ['/caja', <CashPage key="c" />],
  ['/productos', <ProductsPage key="pr" />],
  ['/compras', <PurchasesPage key="co" />],
  ['/gastos', <ExpensesPage key="g" />],
  ['/proveedores', <SuppliersPage key="s" />],
  ['/reportes', <ReportsPage key="r" />],
];

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/plataforma/login" element={<PlatformLoginPage />} />
            <Route
              path="/plataforma"
              element={
                <PlatformProtected>
                  <PlatformDashboardPage />
                </PlatformProtected>
              }
            />
            {PROTEGIDAS.map(([path, element]) => (
              <Route key={path} path={path} element={<Protected>{element}</Protected>} />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
