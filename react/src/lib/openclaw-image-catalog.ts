/** 下拉中「手动输入」项的 value，勿与目录 id 冲突 */
export const OPENCLAW_CATALOG_CUSTOM = "__custom__";

export type OpenClawImageCatalogOption = { id: string; label: string; image: string };

export type OpenClawImageCatalogDoc = {
  entries?: { id?: string; label?: string; image: string }[];
  registryBase?: string;
  repository?: string;
  presets?: { id?: string; label?: string; tag: string }[];
};

export type OpenClawImageCatalogResponse = {
  mode: "entries" | "template" | "none";
  options: OpenClawImageCatalogOption[];
  catalog: OpenClawImageCatalogDoc;
};

export function openClawCatalogOptionIdForImage(
  image: string,
  options: OpenClawImageCatalogOption[]
): string {
  const t = (image ?? "").trim();
  const hit = options.find((o) => (o.image ?? "").trim() === t);
  return hit?.id ?? OPENCLAW_CATALOG_CUSTOM;
}

/** 保存到平台时的 JSON 初始示例（显式列表；也可改用下方注释中的模板示例） */
export const OPENCLAW_IMAGE_CATALOG_JSON_EXAMPLE = `{
  "entries": [
    { "id": "full", "label": "Full · main", "image": "harbor.example.com/library/openclaw:main" },
    { "id": "slim", "label": "Slim", "image": "harbor.example.com/library/openclaw:slim" }
  ],
  "registryBase": "",
  "repository": "openclaw",
  "presets": []
}`;

/*
模板模式示例（entries 置空）：
{
  "entries": [],
  "registryBase": "harbor.example.com/myproject",
  "repository": "openclaw",
  "presets": [
    { "id": "full", "label": "Full · main", "tag": "main" },
    { "id": "slim", "label": "Slim", "tag": "slim" }
  ]
}
最终镜像 = registryBase + "/" + repository + ":" + tag
*/
