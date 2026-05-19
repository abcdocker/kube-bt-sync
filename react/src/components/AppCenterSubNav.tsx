import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Bot, Database, Globe, HardDrive, LayoutDashboard, Layers, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { to: "/cluster/apps/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/cluster/apps/redis", label: "Redis 缓存", icon: Database },
  { to: "/cluster/apps/opensearch", label: "OpenSearch", icon: Search },
  { to: "/cluster/apps/kafka", label: "Kafka", icon: Layers },
  { to: "/cluster/apps/dns", label: "DNS 管理", icon: Globe },
  { to: "/cluster/apps/cloud-vm", label: "云主机", icon: HardDrive },
  { to: "/cluster/apps/openclaw", label: "OpenClaw", icon: Bot },
] as const;

const AppCenterSubNav: React.FC = () => {
  const loc = useLocation();
  return (
    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 p-1.5">
      {links.map(({ to, label, icon: Icon }) => {
        const active =
          to === "/cluster/apps/dashboard"
            ? loc.pathname === "/cluster/apps" ||
              loc.pathname === "/cluster/apps/" ||
              loc.pathname === "/cluster/apps/dashboard"
            : loc.pathname === to || loc.pathname.startsWith(to + "/");
        return (
          <Link
            key={to}
            to={to}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:bg-white/80 hover:text-slate-900"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </div>
  );
};

export default AppCenterSubNav;
