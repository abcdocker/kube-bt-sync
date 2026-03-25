import React from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { RESOURCE_TAB_META } from "./clusterNamespaceRoutes";

const ClusterNamespaceResourcesLayout: React.FC = () => {
  const { namespace: nsEncoded } = useParams<{ namespace: string }>();
  const namespace = nsEncoded ? decodeURIComponent(nsEncoded) : "";
  const base = `/cluster/ns/${encodeURIComponent(namespace)}`;

  if (!namespace) {
    return <p className="text-sm text-red-600">无效的命名空间</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-2 text-sm text-slate-500">
        <Link
          to="/cluster/ns"
          className="font-medium text-blue-600 hover:underline"
        >
          命名空间
        </Link>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
        <span className="font-mono text-base font-semibold text-slate-900">{namespace}</span>
      </div>

      <div className="overflow-x-auto border-b border-slate-200 pb-px">
        <nav
          className="flex min-w-max gap-1"
          aria-label="命名空间内资源类型"
        >
          {RESOURCE_TAB_META.map(({ key, title, detail }) => (
            <NavLink
              key={key}
              to={`${base}/${key}`}
              end={key !== "pods"}
              className={({ isActive }) =>
                cn(
                  "flex max-w-[220px] shrink-0 flex-col rounded-t-lg border border-b-0 px-3 py-2.5 text-left transition-colors",
                  isActive
                    ? "border-slate-200 bg-white shadow-[0_-1px_0_0_white] ring-1 ring-slate-100"
                    : "border-transparent bg-slate-50/80 text-slate-600 hover:bg-slate-100/90"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      "text-[13px] font-semibold leading-tight",
                      isActive ? "text-blue-800" : "text-slate-800"
                    )}
                  >
                    {title}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 line-clamp-2 text-[11px] leading-snug",
                      isActive ? "text-slate-600" : "text-slate-500"
                    )}
                    title={detail}
                  >
                    {detail}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      <Outlet />
    </div>
  );
};

export default ClusterNamespaceResourcesLayout;
