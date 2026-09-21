import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UserDto } from '@/api/types';
import { api, getToken, setToken } from '@/api/client';
import { warmupAfterLogin } from '@/lib/queryClient';
import { getApiBase, persistApiBase } from '@/lib/apiBase';
import { normalizeUser } from '@/lib/text';

interface AuthState {
  user: UserDto | null;
  token: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(() => {
    const raw = localStorage.getItem('fot_admin_user');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as UserDto;
      if (!parsed || typeof parsed !== 'object' || !parsed.username) return null;
      const normalized = normalizeUser(parsed);
      if (normalized.displayName !== parsed.displayName) {
        localStorage.setItem('fot_admin_user', JSON.stringify(normalized));
      }
      return normalized;
    } catch {
      return null;
    }
  });
  const [token, setTokenState] = useState<string | null>(() => getToken());

  useEffect(() => {
    if (getToken()) return;
    localStorage.removeItem('fot_admin_user');
    setUser(null);
    setTokenState(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      token,
      async login(username, password) {
        try {
          await window.fotDesktop?.ensureApi?.(getApiBase());
          persistApiBase(getApiBase());
          const res = await api.login(username, password);
          const normalized = normalizeUser(res.user);
          setToken(res.token);
          setTokenState(res.token);
          setUser(normalized);
          localStorage.setItem('fot_admin_user', JSON.stringify(normalized));
          warmupAfterLogin();
          return true;
        } catch {
          return false;
        }
      },
      logout() {
        setToken(null);
        setTokenState(null);
        setUser(null);
        localStorage.removeItem('fot_admin_user');
      },
    }),
    [user, token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
