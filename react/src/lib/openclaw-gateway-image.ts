/** 未配置本地预设时的占位默认值（可改为你的 Harbor 后保存预设） */
export const OPENCLAW_IMAGE_DEFAULT_FULL = "ghcr.io/openclaw/openclaw:main";
export const OPENCLAW_IMAGE_DEFAULT_SLIM = "ghcr.io/openclaw/openclaw:slim";

/** 兼容旧引用：等同默认 Full */
export const OPENCLAW_IMAGE_FULL = OPENCLAW_IMAGE_DEFAULT_FULL;
/** 兼容旧引用：等同默认 Slim */
export const OPENCLAW_IMAGE_SLIM = OPENCLAW_IMAGE_DEFAULT_SLIM;

const STORAGE_KEY = "kubebt-openclaw-image-presets:v1";

export type OpenClawImagePresets = { full: string; slim: string };

export type OpenClawImageProfile = "full" | "slim" | "custom";

export function loadOpenClawImagePresets(): OpenClawImagePresets {
  if (typeof window === "undefined") {
    return { full: OPENCLAW_IMAGE_DEFAULT_FULL, slim: OPENCLAW_IMAGE_DEFAULT_SLIM };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const j = JSON.parse(raw) as { full?: string; slim?: string };
      const full = (j.full ?? "").trim() || OPENCLAW_IMAGE_DEFAULT_FULL;
      const slim = (j.slim ?? "").trim() || OPENCLAW_IMAGE_DEFAULT_SLIM;
      return { full, slim };
    }
  } catch {
    /* ignore */
  }
  return { full: OPENCLAW_IMAGE_DEFAULT_FULL, slim: OPENCLAW_IMAGE_DEFAULT_SLIM };
}

export function saveOpenClawImagePresets(p: OpenClawImagePresets): void {
  if (typeof window === "undefined") return;
  const full = (p.full ?? "").trim() || OPENCLAW_IMAGE_DEFAULT_FULL;
  const slim = (p.slim ?? "").trim() || OPENCLAW_IMAGE_DEFAULT_SLIM;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ full, slim }));
}

/** 详情页说明列表：使用当前预设中的镜像地址展示 */
export function openClawGatewayImageHelpRows(presets: OpenClawImagePresets) {
  return [
    {
      id: "full",
      title: "Full 规格",
      image: presets.full,
      body:
        "对应下方「Full 预设」地址：通常为完整能力镜像（工具链等），适合非仅问答场景。请填 Harbor 或内网仓库的完整引用（含 tag/digest）。",
    },
    {
      id: "slim",
      title: "Slim 规格",
      image: presets.slim,
      body: "对应「Slim 预设」：体积更小、能力相对精简，更偏轻量对话；同样支持任意私有仓库地址。",
    },
  ] as const;
}

export function openClawImageProfileFromRef(ref: string, presets: OpenClawImagePresets): OpenClawImageProfile {
  const t = (ref ?? "").trim();
  if (t === (presets.full ?? "").trim()) return "full";
  if (t === (presets.slim ?? "").trim()) return "slim";
  return "custom";
}

/** K8s 状态中与对话门禁相关的字段（见 /instances/k8s-status） */
export type OpenClawK8sRolloutFields = {
  phase?: string;
  imageRolloutSynced?: boolean;
  imageRolloutMessage?: string;
  runningGatewayImage?: string;
  templateGatewayImage?: string;
};

export function openClawChatAllowed(st: OpenClawK8sRolloutFields | undefined): { ok: boolean; reason?: string } {
  if (!st || st.phase !== "ready") {
    return { ok: false, reason: "网关尚未就绪（请待 K8s 状态为运行中）。" };
  }
  if (st.imageRolloutSynced === false) {
    return {
      ok: false,
      reason: st.imageRolloutMessage ?? "镜像切换中或运行 Pod 与平台登记不一致，请待重启完成后再对话。",
    };
  }
  return { ok: true };
}
