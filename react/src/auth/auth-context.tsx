import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export type AuthStatus = {
  authRequired: boolean;
  loggedIn: boolean;
  username: string;
  /** 登录页预填用户名（与 DASHBOARD_USER 一致） */
  dashboardUsernameHint?: string;
  /** 是否允许 POST /api/auth/login（本地密码） */
  passwordLogin?: boolean;
  /** 是否允许 GET /api/auth/oidc/login（OIDC / Authentik 等） */
  oidcLogin?: boolean;
};

type AuthContextValue = {
  status: AuthStatus | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch(`${API_BASE}/api/auth/status`, {
    credentials: "same-origin",
  });
  if (!res.ok) {
    throw new Error(`${res.status} /api/auth/status`);
  }
  return res.json() as Promise<AuthStatus>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await fetchAuthStatus();
      setStatus(s);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const logout = useCallback(async () => {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      credentials: "same-origin",
    });
    queryClient.clear();
    await refetch();
  }, [queryClient, refetch]);

  const value = useMemo(
    () => ({ status, loading, error, refetch, logout }),
    [status, loading, error, refetch, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
