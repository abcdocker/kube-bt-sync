import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Hexagon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/auth/auth-context";
import { apiPostJson } from "@/lib/api";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

const Login: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, loading, refetch } = useAuth();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (status?.dashboardUsernameHint) {
      setUsername(status.dashboardUsernameHint);
    }
  }, [status?.dashboardUsernameHint]);

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const q = p.get("error");
    if (!q) return;
    setErr(q);
    p.delete("error");
    const qs = p.toString();
    navigate(
      { pathname: location.pathname, search: qs ? `?${qs}` : "" },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!loading && status && (!status.authRequired || status.loggedIn)) {
      navigate("/", { replace: true });
    }
  }, [loading, status, navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      await apiPostJson("/api/auth/login", { username, password });
      await refetch();
      navigate("/", { replace: true });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !status) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F1F5F9] font-sans text-gray-600">
        加载中…
      </div>
    );
  }

  const showPassword = status.passwordLogin !== false;
  const showOidc = status.oidcLogin === true;
  const oidcHref = `${API_BASE}/api/auth/oidc/login`;

  if (!status.authRequired || status.loggedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F1F5F9] font-sans text-gray-600">
        正在跳转…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F1F5F9] px-4 font-sans">
      <div className="w-full max-w-[400px] rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 shadow-md">
            <Hexagon className="text-white" size={28} strokeWidth={2.5} />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Kube-BT-Sync</h1>
          <p className="text-center text-sm text-gray-500">登录以继续管理 Ingress 与宝塔同步</p>
        </div>
        {showOidc && (
          <div className="mb-4">
            <Button type="button" variant="secondary" className="w-full" asChild>
              <a href={oidcHref}>使用 OIDC 登录（Authentik 等）</a>
            </Button>
            {showPassword && (
              <p className="mt-3 text-center text-xs text-gray-400">或使用本地账号</p>
            )}
          </div>
        )}
        {showPassword && (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="bg-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-white"
              />
            </div>
            {err && (
              <p className="text-sm text-red-600" role="alert">
                {err}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "登录中…" : "登录"}
            </Button>
          </form>
        )}
        {!showPassword && showOidc && err && (
          <p className="text-sm text-red-600" role="alert">
            {err}
          </p>
        )}
      </div>
    </div>
  );
};

export default Login;
