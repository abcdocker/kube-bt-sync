import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  ChevronDown,
  Hexagon,
  LogOut,
  Monitor,
  Settings,
  User,
} from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { apiGetJson, type AppConfig, type AuditLogsResponse } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { workspaceFromPathname } from "@/lib/workspace";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import GlobalSearchBar from "@/components/GlobalSearchBar";

const Header: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, logout } = useAuth();
  const workspace = workspaceFromPathname(location.pathname);
  const isK8s = workspace === "kubernetes";
  const [auditOpen, setAuditOpen] = useState(false);

  const cfgQ = useQuery({
    queryKey: ["app-config"],
    queryFn: () => apiGetJson<AppConfig>("/api/config"),
  });
  const auditQ = useQuery({
    queryKey: ["audit-logs"],
    queryFn: () => apiGetJson<AuditLogsResponse>("/api/audit/logs?limit=200"),
    enabled: auditOpen,
    staleTime: 15_000,
  });

  const cfg = cfgQ.data;
  const showLogout = Boolean(status?.authRequired && status.loggedIn);
  const displayName =
    status?.loggedIn && status.username
      ? status.username
      : (cfg?.dashboardUser?.trim() || "Admin");

  return (
    <header
      data-cmp="Header"
      className="sticky top-0 z-10 flex h-20 w-full min-w-0 flex-shrink-0 items-center gap-6 border-b border-[#E2E8F0] bg-white px-8"
    >
      <GlobalSearchBar />

      <div className="ml-auto flex shrink-0 items-center space-x-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium outline-none transition-colors",
                "border-slate-200 bg-slate-50/90 text-slate-800 hover:bg-slate-100",
                "focus-visible:ring-2 focus-visible:ring-blue-500/30"
              )}
              aria-label="切换工作区 Kubernetes 或 vCenter"
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white",
                  isK8s
                    ? "from-blue-600 to-blue-700"
                    : "from-violet-600 to-violet-700"
                )}
              >
                {isK8s ? (
                  <Hexagon size={18} strokeWidth={2.5} />
                ) : (
                  <Monitor size={18} strokeWidth={2.25} />
                )}
              </span>
              <span className="hidden text-left sm:inline">
                {isK8s ? "Kubernetes" : "vCenter"}
              </span>
              <ChevronDown size={16} className="text-slate-500" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[228px]">
            <DropdownMenuItem
              className="cursor-pointer gap-2 py-2.5"
              onSelect={() => navigate("/cluster")}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
                <Hexagon className="text-white" size={18} strokeWidth={2.5} />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">Kubernetes</span>
                <span className="text-xs text-muted-foreground">集群资源</span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer gap-2 py-2.5"
              onSelect={() => navigate("/cluster/vcenter")}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600">
                <Monitor className="text-white" size={17} strokeWidth={2.25} />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">vCenter</span>
                <span className="text-xs text-muted-foreground">虚拟机与控制台</span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Sheet open={auditOpen} onOpenChange={setAuditOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className="relative rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
              aria-label="操作记录"
            >
              <Bell size={22} />
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
            <SheetHeader>
              <SheetTitle>操作记录</SheetTitle>
              <p className="text-left text-xs text-muted-foreground">
                含登录与 API 访问；持久化于服务端{" "}
                <code className="rounded bg-muted px-1 text-[10px]">audit.jsonl</code>
              </p>
            </SheetHeader>
            <ScrollArea className="mt-4 flex-1 pr-3">
              {auditQ.isLoading && (
                <p className="text-sm text-muted-foreground">加载中…</p>
              )}
              {auditQ.isError && (
                <p className="text-sm text-red-600">{(auditQ.error as Error).message}</p>
              )}
              {auditQ.data && auditQ.data.logs.length === 0 && (
                <p className="text-sm text-muted-foreground">暂无记录</p>
              )}
              {auditQ.data && auditQ.data.logs.length > 0 && (
                <ul className="space-y-3 text-xs">
                  {[...auditQ.data.logs].reverse().map((row, i) => (
                    <li
                      key={`${row.ts}-${i}`}
                      className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2 font-mono leading-relaxed text-gray-800"
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
                        <span>{row.ts}</span>
                        {row.ip ? <span>· {row.ip}</span> : null}
                        {row.user ? <span>· {row.user}</span> : null}
                      </div>
                      <div className="text-[12px] text-gray-900">
                        <span className="font-semibold">{row.action}</span>
                        {row.method && row.path ? (
                          <span className="text-gray-600">
                            {" "}
                            {row.method} {row.path}
                          </span>
                        ) : null}
                        {row.status != null ? (
                          <span className="text-gray-600"> → {row.status}</span>
                        ) : null}
                        {row.durationMs != null ? (
                          <span className="text-gray-500"> {row.durationMs}ms</span>
                        ) : null}
                        {row.detail ? (
                          <span className="text-gray-500"> · {row.detail}</span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </SheetContent>
        </Sheet>

        <div className="h-8 w-px bg-gray-200" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center space-x-3 rounded-xl px-2 py-1.5 outline-none transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-500/30"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-blue-200 bg-gradient-to-tr from-blue-100 to-indigo-100 text-blue-600">
                <User size={18} />
              </div>
              <div className="hidden text-left sm:flex sm:flex-col">
                <span className="leading-none text-sm font-semibold text-gray-900">
                  {displayName}
                </span>
                <span className="mt-0.5 text-xs text-gray-500">
                  {status?.authRequired ? "已登录" : "控制台"}
                </span>
              </div>
              <ChevronDown size={16} className="text-gray-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuItem
              className="cursor-pointer gap-2"
              onSelect={() => navigate("/account/settings")}
            >
              <Settings size={16} />
              账户与平台设置
            </DropdownMenuItem>
            {showLogout && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer gap-2 text-red-600 focus:text-red-600"
                  onSelect={() => void logout().then(() => navigate("/login", { replace: true }))}
                >
                  <LogOut size={16} />
                  退出登录
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

export default Header;
