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
  user: { id: string; name: string; email: string; mustChangePassword: boolean };
  tenant: { id: string; name: string };
  memberships: { role: string; store: { id: string; name: string } }[];
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

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

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ accessToken: string; refreshToken: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setSession(data);
    setMe(await api<Me>('/api/auth/me'));
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    setMe(null);
  }, []);

  return (
    <AuthContext.Provider value={{ me, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
