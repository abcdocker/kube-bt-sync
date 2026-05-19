import React, { useState } from "react";
import { Outlet, useLocation, Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Hexagon,
  Monitor,
  AppWindow,
  Settings,
  LayoutDashboard,
  LogOut,
  User,
  Users,
  ChevronDown,
  Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/auth/auth-context";
import { apiPostJson } from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import PlatformVersionBanner from "./PlatformVersionBanner";
import RedisStatusBanner from "./RedisStatusBanner";

// ── Bottom Navigation Bar ──────────────────────────────────────────────────

const BOTTOM_TABS = [
  { icon: LayoutDashboard, label: "工作台", to: "/", exact: true },
  { icon: Hexagon, label: "K8s", to: "/cluster", exact: false },
  { icon: Monitor, label: "vCenter", to: "/cluster/vcenter", exact: false },
  { icon: AppWindow, label: "应用", to: "/cluster/apps", exact: false },
  { icon: Settings, label: "设置", to: "/settings", exact: false },
] as const;

function MobileBottomNav() {
  const { pathname } = useLocation();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5">
        {BOTTOM_TABS.map(({ icon: Icon, label, to, exact }) => {
          const active = exact ? pathname === to : pathname === to || pathname.startsWith(to + "/") || pathname.startsWith(to + "?");
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors active:opacity-70",
                active ? "text-blue-600" : "text-slate-400"
              )}
            >
              <Icon
                size={20}
                strokeWidth={active ? 2.5 : 1.8}
                className={active ? "text-blue-600" : "text-slate-400"}
              />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

// ── Mobile Header ──────────────────────────────────────────────────────────

function MobileHeader() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const logoutMut = useMutation({
    mutationFn: () => apiPostJson("/api/auth/logout", {}),
    onSuccess: () => {
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-100 bg-white px-4">
      {/* Brand */}
      <Link to="/" className="flex items-center gap-2">
        <img
          src="/brand-logo.svg"
          alt="Kube-BT-Sync"
          className="h-6 w-auto object-contain"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        <span className="text-sm font-semibold text-slate-800">Kube-BT-Sync</span>
      </Link>

      {/* Right actions */}
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1 rounded-full px-2 py-1 text-sm text-slate-600 transition active:bg-slate-100">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                {(status?.username ?? "?").slice(0, 1).toUpperCase()}
              </div>
              <ChevronDown size={13} className="text-slate-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <div className="px-3 py-2">
              <p className="text-xs font-medium text-slate-700">{status?.username ?? "—"}</p>
              <p className="text-[11px] text-slate-400">{status?.role === "admin" ? "管理员" : "只读"}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/account/personal" className="flex items-center gap-2">
                <User size={14} />
                我的资料
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/account/settings" className="flex items-center gap-2">
                <Settings size={14} />
                账户设置
              </Link>
            </DropdownMenuItem>
            {status?.role === "admin" && (
              <DropdownMenuItem asChild>
                <Link to="/account/users" className="flex items-center gap-2">
                  <Users size={14} />
                  用户管理
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-red-600 focus:text-red-600"
              onClick={() => logoutMut.mutate()}
            >
              <LogOut size={14} className="mr-2" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

// ── Mobile App Layout ──────────────────────────────────────────────────────

const AppLayoutMobile: React.FC = () => {
  const { pathname } = useLocation();

  // Full-bleed pages: bastion console, pod terminal — no chrome
  const isBastionFullBleed =
    pathname === "/cluster/bastion" ||
    pathname.startsWith("/cluster/bastion/") ||
    pathname === "/cluster/vcenter/bastion" ||
    pathname.startsWith("/cluster/vcenter/bastion/");

  const isPodTerminalShell =
    /\/cluster\/ns\/[^/]+\/pods\/[^/]+\/terminal\/?$/.test(pathname);

  const hideAppChrome = isPodTerminalShell || isBastionFullBleed;

  if (hideAppChrome) {
    return (
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#0c0f14]">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-white">
      <MobileHeader />
      <PlatformVersionBanner />
      <RedisStatusBanner />

      {/* Scrollable content, padded for bottom nav */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 pb-20">
        <div className="mx-auto w-full max-w-full">
          <Outlet />
        </div>
      </main>

      <MobileBottomNav />
    </div>
  );
};

export default AppLayoutMobile;
