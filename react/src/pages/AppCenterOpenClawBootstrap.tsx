import React, { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, Loader2, Save } from "lucide-react";
import { useAuth } from "@/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { JsonCodeEditor } from "@/components/JsonCodeEditor";
import { apiGetJson, apiPutJson, ApiHttpError } from "@/lib/api";
import { toast } from "sonner";
import {
  type OpenClawImageCatalogResponse,
  OPENCLAW_IMAGE_CATALOG_JSON_EXAMPLE,
} from "@/lib/openclaw-image-catalog";

const PAGE_PATH = "/cluster/apps/openclaw/bootstrap";

type ModeRow = {
  id: string;
  label: string;
  description?: string;
  image: string;
  initContainerImage?: string;
};

type Bootstrap = {
  bootstrapComplete: boolean;
  modes: ModeRow[];
  defaultNamespace: string;
  defaultRbacPreset?: string;
};

const DEFAULT_ROWS: ModeRow[] = [
  {
    id: "full",
    label: "Full（完整能力）",
    description: "官方完整镜像（如 :main）",
    image: "ghcr.io/openclaw/openclaw:main",
    initContainerImage: "busybox:1.36",
  },
  {
    id: "slim",
    label: "Slim（轻量）",
    description: "精简镜像",
    image: "ghcr.io/openclaw/openclaw:slim",
    initContainerImage: "busybox:1.36",
  },
  {
    id: "corp",
    label: "企业 / 自定义 Harbor",
    description: "改为内网 Harbor 地址与 tag",
    image: "harbor.example.com/library/openclaw:main",
    initContainerImage: "harbor.example.com/library/busybox:1.36",
  },
];

export default function AppCenterOpenClawBootstrap() {
  const { status } = useAuth();
  const isAdmin = status?.role === "admin";
  const navigate = useNavigate();
  const qc = useQueryClient();

  const bootQ = useQuery({
    queryKey: ["app-openclaw-bootstrap"],
    queryFn: ({ signal }) => apiGetJson<Bootstrap>("/api/app-center/openclaw/bootstrap", { signal }),
  });

  const [ns, setNs] = useState("");
  const [defaultRbacPreset, setDefaultRbacPreset] = useState<"readonly" | "edit" | "admin">("readonly");
  const [rows, setRows] = useState<ModeRow[]>([]);
  const [catalogEditorOpen, setCatalogEditorOpen] = useState(false);
  const [catalogJsonDraft, setCatalogJsonDraft] = useState(() => OPENCLAW_IMAGE_CATALOG_JSON_EXAMPLE.trim());

  const catalogQ = useQuery({
    queryKey: ["app-openclaw-image-catalog"],
    queryFn: ({ signal }) => apiGetJson<OpenClawImageCatalogResponse>("/api/app-center/openclaw/image-catalog", { signal }),
    staleTime: 30_000,
  });

  const rbacPresetsQ = useQuery({
    queryKey: ["app-openclaw-rbac-presets"],
    queryFn: ({ signal }) =>
      apiGetJson<{
        presets: { id: string; label: string; description: string; clusterRoleName: string }[];
      }>("/api/app-center/openclaw/rbac-presets", { signal }),
    staleTime: 300_000,
  });

  useEffect(() => {
    if (!bootQ.data) return;
    setNs(bootQ.data.defaultNamespace?.trim() ?? "");
    const dr = (bootQ.data.defaultRbacPreset ?? "").trim().toLowerCase();
    if (dr === "readonly" || dr === "edit" || dr === "admin") {
      setDefaultRbacPreset(dr);
    } else {
      setDefaultRbacPreset("readonly");
    }
    setRows(
      bootQ.data.modes?.length
        ? bootQ.data.modes.map((r) => ({ ...r }))
        : DEFAULT_ROWS.map((r) => ({ ...r }))
    );
  }, [bootQ.data]);

  useEffect(() => {
    if (!catalogEditorOpen) return;
    const c = catalogQ.data?.catalog;
    setCatalogJsonDraft(JSON.stringify(c ?? JSON.parse(OPENCLAW_IMAGE_CATALOG_JSON_EXAMPLE), null, 2));
  }, [catalogEditorOpen, catalogQ.data?.catalog]);

  const catalogPutMut = useMutation({
    mutationFn: async (raw: string) => {
      let catalog: OpenClawImageCatalogResponse["catalog"];
      try {
        catalog = JSON.parse(raw) as OpenClawImageCatalogResponse["catalog"];
      } catch {
        throw new SyntaxError("JSON 格式无效");
      }
      return apiPutJson<OpenClawImageCatalogResponse>("/api/app-center/openclaw/image-catalog", { catalog });
    },
    onSuccess: async () => {
      toast.success("已保存平台镜像目录");
      await qc.invalidateQueries({ queryKey: ["app-openclaw-image-catalog"] });
      setCatalogEditorOpen(false);
    },
    onError: (e) =>
      toast.error(
        e instanceof ApiHttpError
          ? e.serverMessage
          : e instanceof SyntaxError
            ? "JSON 格式错误"
            : String(e)
      ),
  });

  const saveMut = useMutation({
    mutationFn: () =>
      apiPutJson("/api/app-center/openclaw/bootstrap", {
        bootstrapComplete: true,
        defaultNamespace: ns.trim(),
        defaultRbacPreset,
        modes: rows.map((r) => ({
          id: r.id.trim(),
          label: (r.label || r.id).trim(),
          description: r.description?.trim() || undefined,
          image: r.image.trim(),
          initContainerImage: r.initContainerImage?.trim() || undefined,
        })),
      }),
    onSuccess: () => {
      toast.success("已保存 OpenClaw 部署模式模板");
      void qc.invalidateQueries({ queryKey: ["app-openclaw-bootstrap"] });
      navigate("/cluster/apps/openclaw", { replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) {
    return <Navigate to="/cluster/apps/openclaw" replace />;
  }

  if (bootQ.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载…
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link to="/cluster/apps/openclaw">
            <ArrowLeft className="h-4 w-4" />
            返回 OpenClaw
          </Link>
        </Button>
      </div>

      <div className="rounded-2xl border border-violet-200/80 bg-gradient-to-br from-violet-50 via-white to-slate-50 px-6 py-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-violet-800/90">首次引导 · 管理员</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">OpenClaw 网关镜像与命名空间</h1>
        <p className="mt-2 text-sm text-slate-600">
          在此统一维护<strong>部署模式</strong>（网关 / Init 镜像地址）与可选的<strong>平台镜像目录 JSON</strong>。前台创建实例与实例详情<strong>不再</strong>提供镜像地址编辑，仅按此处模板选择模式。
          保存后可在 <code className="rounded bg-slate-100 px-1">platform_kv</code> 调整{" "}
          <code className="rounded bg-slate-100 px-1">appcenter_openclaw_bootstrap_v1</code> 等键。
        </p>
        <div className="mt-4 flex flex-col gap-2 rounded-lg border border-violet-200/80 bg-white/90 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500">本页地址（可收藏或发给运维）</p>
            <p className="mt-1 break-all font-mono text-sm text-violet-900">
              {typeof window !== "undefined" ? window.location.origin : ""}
              {PAGE_PATH}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={async () => {
              const full =
                typeof window !== "undefined" ? `${window.location.origin}${PAGE_PATH}` : PAGE_PATH;
              try {
                await navigator.clipboard.writeText(full);
                toast.success("已复制完整 URL");
              } catch {
                toast.error("复制失败");
              }
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            复制完整地址
          </Button>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="space-y-2 rounded-lg border border-dashed border-violet-200 bg-violet-50/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <Label className="text-base">平台镜像目录（可选 · platform_kv）</Label>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                与「部署模式」独立：若各模式已写全镜像引用，可不配置目录。目录用于与其它工具或文档对齐同一套 Harbor 元数据。
              </p>
            </div>
            <Button
              type="button"
              variant={catalogEditorOpen ? "secondary" : "outline"}
              size="sm"
              onClick={() => setCatalogEditorOpen((o) => !o)}
            >
              {catalogEditorOpen ? "收起 JSON" : "编辑目录 JSON"}
            </Button>
          </div>
          {catalogQ.data?.mode && catalogQ.data.mode !== "none" ? (
            <p className="text-[11px] text-emerald-800">
              当前目录：<span className="font-mono">{catalogQ.data.mode}</span>
            </p>
          ) : (
            <p className="text-[11px] text-slate-500">当前未配置或为空。</p>
          )}
          {catalogEditorOpen ? (
            <div className="space-y-2">
              <JsonCodeEditor
                value={catalogJsonDraft}
                onChange={setCatalogJsonDraft}
                height="min(280px, 42vh)"
                readOnly={catalogPutMut.isPending}
              />
              <Button
                type="button"
                size="sm"
                className="gap-1.5 bg-violet-600 hover:bg-violet-700"
                disabled={catalogPutMut.isPending}
                onClick={() => catalogPutMut.mutate(catalogJsonDraft)}
              >
                {catalogPutMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                仅保存镜像目录
              </Button>
            </div>
          ) : null}
        </div>

        <div>
          <Label>创建向导默认命名空间（可空）</Label>
          <p className="mt-1 text-[11px] text-slate-500">仅当用户未填写时预填，不强制创建。</p>
          <Input value={ns} onChange={(e) => setNs(e.target.value)} className="mt-2 font-mono text-sm" placeholder="例如 openclaw" />
        </div>

        <div className="space-y-2">
          <Label>新建实例默认集群权限（ServiceAccount → ClusterRole）</Label>
          <p className="text-[11px] text-slate-500">
            创建向导首次加载时预填；单次部署仍可在向导中改为其它档。变更不影响已存在实例。
          </p>
          <Select
            value={defaultRbacPreset}
            onValueChange={(v) => setDefaultRbacPreset(v as "readonly" | "edit" | "admin")}
          >
            <SelectTrigger className="mt-1 w-full max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(rbacPresetsQ.data?.presets ?? [
                { id: "readonly", label: "只读", description: "" },
                { id: "edit", label: "编辑", description: "" },
                { id: "admin", label: "管理员", description: "" },
              ]).map((p) => (
                <SelectItem key={p.id} value={p.id} className="items-start py-2">
                  <span className="block text-sm font-medium">{p.label}</span>
                  {"description" in p && p.description ? (
                    <span className="mt-0.5 block text-[11px] text-slate-600">{p.description}</span>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>部署模式列表</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((r) => [
                  ...r,
                  {
                    id: `mode-${Date.now()}`,
                    label: "新模式",
                    description: "",
                    image: "harbor.example.com/library/openclaw:tag",
                    initContainerImage: "busybox:1.36",
                  },
                ])
              }
            >
              添加一行
            </Button>
          </div>
          {rows.map((row, i) => (
            <div
              key={`${row.id}-${i}`}
              className="grid gap-2 rounded-lg border border-slate-100 bg-slate-50/80 p-3 sm:grid-cols-2"
            >
              <div>
                <Label className="text-xs">ID（英文标识）</Label>
                <Input
                  value={row.id}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, id: v } : x)));
                  }}
                  className="font-mono text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">显示名称</Label>
                <Input
                  value={row.label}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, label: v } : x)));
                  }}
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">说明（可选）</Label>
                <Input
                  value={row.description ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, description: v } : x)));
                  }}
                  placeholder="简短描述，显示在创建向导下拉里"
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">网关镜像引用</Label>
                <Input
                  value={row.image}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, image: v } : x)));
                  }}
                  className="font-mono text-xs"
                  spellCheck={false}
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Init 容器镜像（可选，空则向导默认 busybox:1.36）</Label>
                <Input
                  value={row.initContainerImage ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, initContainerImage: v } : x)));
                  }}
                  className="font-mono text-xs"
                  placeholder="busybox:1.36"
                  spellCheck={false}
                />
              </div>
              <div className="sm:col-span-2 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-red-600"
                  disabled={rows.length <= 1}
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                >
                  删除
                </Button>
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          className="gap-2 bg-violet-600 hover:bg-violet-700"
          disabled={saveMut.isPending || rows.some((r) => !r.id.trim() || !r.image.trim())}
          onClick={() => saveMut.mutate()}
        >
          {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存并完成引导
        </Button>
      </div>
    </div>
  );
}
