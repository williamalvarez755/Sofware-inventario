import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { restorePlatformSession } from './api/platformClient';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ThemeProvider } from './theme/ThemeProvider';
import { Marca } from './components/Marca';
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

function Cargando() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <Marca size={48} className="animate-pulse" />
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
            {/* El acceso es único (D-041): la antigua puerta de plataforma
                sigue existiendo como redirección para enlaces guardados. */}
            <Route path="/plataforma/login" element={<Navigate to="/login" replace />} />
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
