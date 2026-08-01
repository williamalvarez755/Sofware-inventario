import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { restorePlatformSession } from './api/platformClient';
import { PlatformDashboardPage } from './pages/platform/PlatformDashboardPage';
import { PlatformLoginPage } from './pages/platform/PlatformLoginPage';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { ProductsPage } from './pages/ProductsPage';
import { PosPage } from './pages/PosPage';
import { CashPage } from './pages/CashPage';
import { PurchasesPage } from './pages/PurchasesPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { ReportsPage } from './pages/ReportsPage';

function Protected({ children }: { children: React.ReactElement }) {
  const { me, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Cargando…
      </div>
    );
  }
  return me ? children : <Navigate to="/login" replace />;
}

/** El panel de plataforma tiene su propia sesión, aislada de la del tendero. */
function PlatformProtected({ children }: { children: React.ReactElement }) {
  const [state, setState] = useState<'loading' | 'ok' | 'anon'>('loading');
  useEffect(() => {
    restorePlatformSession().then((ok) => setState(ok ? 'ok' : 'anon'));
  }, []);
  if (state === 'loading') {
    return <div className="flex min-h-screen items-center justify-center text-slate-400">Cargando…</div>;
  }
  return state === 'ok' ? children : <Navigate to="/plataforma/login" replace />;
}

export function App() {
  return (
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
          <Route
            path="/"
            element={
              <Protected>
                <DashboardPage />
              </Protected>
            }
          />
          <Route
            path="/productos"
            element={
              <Protected>
                <ProductsPage />
              </Protected>
            }
          />
          <Route
            path="/pos"
            element={
              <Protected>
                <PosPage />
              </Protected>
            }
          />
          <Route
            path="/caja"
            element={
              <Protected>
                <CashPage />
              </Protected>
            }
          />
          <Route
            path="/compras"
            element={
              <Protected>
                <PurchasesPage />
              </Protected>
            }
          />
          <Route
            path="/gastos"
            element={
              <Protected>
                <ExpensesPage />
              </Protected>
            }
          />
          <Route
            path="/proveedores"
            element={
              <Protected>
                <SuppliersPage />
              </Protected>
            }
          />
          <Route
            path="/reportes"
            element={
              <Protected>
                <ReportsPage />
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
