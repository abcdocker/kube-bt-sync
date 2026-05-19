#!/usr/bin/env node
/**
 * Rewrites app-config useQuery → useAppConfig() and invalidateQueries keys → APP_CONFIG_QUERY_KEY.
 * Run from repo root: node react/scripts/patch-app-config-imports.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "react", "src");

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const useQueryBlock = /const\s+(\w+)\s*=\s*useQuery\(\{\s*queryKey:\s*\["app-config"\],\s*queryFn:\s*\(\)\s*=>\s*apiGetJson<AppConfig>\("\/api\/config"\),?\s*([^}]*)\}\);/gs;

function ensureImport(t, spec) {
  if (t.includes(spec)) return t;
  const m = t.match(/^import .+ from ["']react["'];?/m);
  if (m) {
    const idx = m.index + m[0].length;
    return t.slice(0, idx) + "\n" + spec + t.slice(idx);
  }
  return spec + "\n" + t;
}

function patchFile(fp) {
  let t = fs.readFileSync(fp, "utf8");
  const orig = t;
  if (!t.includes('["app-config"]')) return false;

  t = t.replaceAll('queryKey: ["app-config"]', "queryKey: APP_CONFIG_QUERY_KEY");

  // useQuery({ queryKey: APP_CONFIG_QUERY_KEY, queryFn: () => apiGetJson<AppConfig>("/api/config") }) → useAppConfig()
  t = t.replace(
    /const\s+(\w+)\s*=\s*useQuery\(\{\s*queryKey:\s*APP_CONFIG_QUERY_KEY,\s*queryFn:\s*\(\)\s*=>\s*apiGetJson<AppConfig>\("\/api\/config"\),?\s*\}\);/g,
    "const $1 = useAppConfig();"
  );
  // with trailing options before }
  t = t.replace(
    /const\s+(\w+)\s*=\s*useQuery\(\{\s*queryKey:\s*APP_CONFIG_QUERY_KEY,\s*queryFn:\s*\(\)\s*=>\s*apiGetJson<AppConfig>\("\/api\/config"\),\s*([^}]+)\}\);/g,
    (_, name, rest) => {
      const inner = rest.trim().replace(/,\s*$/, "");
      return `const ${name} = useAppConfig({ ${inner} });`;
    }
  );

  if (t === orig) return false;

  if (t.includes("APP_CONFIG_QUERY_KEY") || t.includes("useAppConfig")) {
    if (!t.includes('from "@/hooks/use-app-config"') && !t.includes("from '@/hooks/use-app-config'")) {
      const imp = 'import { useAppConfig, APP_CONFIG_QUERY_KEY } from "@/hooks/use-app-config";';
      if (t.includes("useAppConfig") && !t.includes("APP_CONFIG_QUERY_KEY")) {
        t = ensureImport(t, 'import { useAppConfig } from "@/hooks/use-app-config";');
      } else if (!t.includes("useAppConfig")) {
        t = ensureImport(t, 'import { APP_CONFIG_QUERY_KEY } from "@/hooks/use-app-config";');
      } else {
        t = ensureImport(t, imp);
      }
    }
  }

  // Remove stale AppConfig-only import line if now unused (best-effort)
  if (!t.includes("AppConfig") && t.includes('import { apiGetJson, type AppConfig')) {
    t = t.replace(/,\s*type AppConfig/g, "");
  }
  if (!t.includes("AppConfig") && t.includes('import { type AppConfig')) {
    t = t.replace(/import\s*{\s*type AppConfig\s*}\s*from\s*["']@\/lib\/api["'];?\n?/g, "");
  }

  fs.writeFileSync(fp, t);
  return true;
}

let n = 0;
for (const fp of walk(root)) {
  if (patchFile(fp)) {
    console.log(path.relative(root, fp));
    n++;
  }
}
console.log("patched", n);
