'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { LoginResponse, MeResponse } from '@delivery360/shared';
import { api, session } from './api';

interface SessionState {
  user: MeResponse | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<MeResponse>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session.getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await api<MeResponse>('/auth/me'));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } });
    session.setToken(res.accessToken);
    // Usuário de restaurante com um só restaurante já entra nele.
    if (!res.user.staffRole && res.user.tenants.length > 0) session.setTenantId(res.user.tenants[0].id);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    session.clear();
    setUser(null);
    window.location.href = '/login';
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, refresh }), [user, loading, login, logout, refresh]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession precisa estar dentro de SessionProvider');
  return ctx;
}
