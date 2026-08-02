import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, logoutRequest, restoreSession, setSession } from '../api/client';
import { setPlatformSession } from '../api/platformClient';

export interface Me {
  user: {
    id: string;
    name: string;
    username: string;
    email: string;
    mustChangePassword: boolean;
  };
  tenant: { id: string; name: string };
  memberships: { role: string; store: { id: string; name: string } }[];
}

/**
 * El ingreso es único para tendero y super admin (D-041), así que puede
 * terminar de tres formas: sesión de tienda, sesión de plataforma, o un
 * desafío de segundo factor que habrá que completar.
 */
export type LoginOutcome =
  | { kind: 'tienda' }
  | { kind: 'plataforma' }
  | { kind: 'segundo-factor'; challengeToken: string };

interface AuthState {
  me: Me | null;
  loading: boolean;
  login(username: string, password: string): Promise<LoginOutcome>;
  completeTwoFactor(challengeToken: string, code: string): Promise<LoginOutcome>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

type Sesion = { accessToken: string; refreshToken: string };
type LoginResponse =
  | ({ scope: 'tienda' | 'plataforma'; requiresTwoFactor: true; challengeToken: string })
  | ({ scope: 'tienda' | 'plataforma' } & Sesion);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (await restoreSession()) {
        setMe(await api<Me>('/api/auth/me').catch(() => null));
      }
      setLoading(false);
    })();
  }, []);

  /** Guarda la sesión en el almacén que corresponde y dice a dónde ir. */
  const aplicarSesion = useCallback(
    async (data: { scope: 'tienda' | 'plataforma' } & Sesion): Promise<LoginOutcome> => {
      if (data.scope === 'plataforma') {
        setPlatformSession(data);
        return { kind: 'plataforma' };
      }
      setSession(data);
      setMe(await api<Me>('/api/auth/me'));
      return { kind: 'tienda' };
    },
    [],
  );

  const login = useCallback<AuthState['login']>(
    async (username, password) => {
      const data = await api<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      // Con verificación en dos pasos, la contraseña sola no abre sesión.
      if ('requiresTwoFactor' in data) {
        return { kind: 'segundo-factor', challengeToken: data.challengeToken };
      }
      return aplicarSesion(data);
    },
    [aplicarSesion],
  );

  const completeTwoFactor = useCallback<AuthState['completeTwoFactor']>(
    async (challengeToken, code) => {
      const data = await api<{ scope: 'tienda' | 'plataforma' } & Sesion>('/api/auth/2fa/login', {
        method: 'POST',
        body: JSON.stringify({ challengeToken, code }),
      });
      return aplicarSesion(data);
    },
    [aplicarSesion],
  );

  const logout = useCallback(async () => {
    await logoutRequest();
    setMe(null);
  }, []);

  return (
    <AuthContext.Provider value={{ me, loading, login, completeTwoFactor, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
