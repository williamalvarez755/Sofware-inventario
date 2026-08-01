import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, logoutRequest, restoreSession, setSession } from '../api/client';

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

/** El login puede terminar en sesión o en un desafío de segundo factor. */
export type LoginOutcome = { kind: 'sesion' } | { kind: 'segundo-factor'; challengeToken: string };

interface AuthState {
  me: Me | null;
  loading: boolean;
  login(username: string, password: string): Promise<LoginOutcome>;
  completeTwoFactor(challengeToken: string, code: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

type LoginResponse =
  | { requiresTwoFactor: true; challengeToken: string }
  | { accessToken: string; refreshToken: string };

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

  const login = useCallback<AuthState['login']>(async (username, password) => {
    const data = await api<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    // Con verificación en dos pasos, la contraseña sola no abre sesión:
    // devuelve un desafío que solo sirve para completar este ingreso.
    if ('requiresTwoFactor' in data) {
      return { kind: 'segundo-factor', challengeToken: data.challengeToken };
    }
    setSession(data);
    setMe(await api<Me>('/api/auth/me'));
    return { kind: 'sesion' };
  }, []);

  const completeTwoFactor = useCallback<AuthState['completeTwoFactor']>(
    async (challengeToken, code) => {
      const data = await api<{ accessToken: string; refreshToken: string }>('/api/auth/2fa/login', {
        method: 'POST',
        body: JSON.stringify({ challengeToken, code }),
      });
      setSession(data);
      setMe(await api<Me>('/api/auth/me'));
    },
    [],
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
