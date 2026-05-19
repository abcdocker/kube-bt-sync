/**
 * 1) queryFn: () => / async () => 改为带 { signal }
 * 2) 仅在「紧跟 queryFn 箭头」的 apiGetJson / apiPostJson / apiGetText 调用括号内追加 , { signal }（幂等）
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..", "src");

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === "node_modules" || name.name === "dist") continue;
      walk(p, acc);
    } else if (/\.(tsx|ts)$/.test(name.name)) acc.push(p);
  }
  return acc;
}

function findMatchingParen(s, openParen) {
  let depth = 0;
  let i = openParen;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === "/" && s[i + 1] === "/") {
      i += 2;
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < s.length - 1 && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      i++;
      while (i < s.length) {
        if (s[i] === "\\") {
          i += 2;
          continue;
        }
        if (s[i] === q) break;
        i++;
      }
      continue;
    }
    if (c === "`") {
      i++;
      while (i < s.length) {
        if (s[i] === "\\") {
          i += 2;
          continue;
        }
        if (s[i] === "`") break;
        if (s[i] === "$" && s[i + 1] === "{") {
          let bd = 1;
          i += 2;
          while (i < s.length && bd > 0) {
            if (s[i] === "{") bd++;
            else if (s[i] === "}") bd--;
            i++;
          }
          continue;
        }
        i++;
      }
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function hasTrailingSignalArg(inner) {
  const t = inner.trimEnd();
  if (/,\s*\{\s*signal\s*\}\s*$/.test(t)) return true;
  // 多行 `{ signal }` 或 `{ signal, }` 已作为 fetch opt 传入
  if (/,\s*\{[\s\S]*\bsignal\b[\s\S]*\}\s*$/.test(t)) return true;
  return false;
}

/** 在 queryFn 箭头体为「直接调用」时，给首个 API 调用追加 opt */
function patchImmediateApiAfterQueryFn(t, apiName) {
  const re = new RegExp(
    `queryFn:\\s*(?:async\\s*)?\\(\\{\\s*signal\\s*\\}\\)\\s*=>\\s*${apiName}`,
    "g"
  );
  const inserts = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    const after = m.index + m[0].length;
    const openParen = t.indexOf("(", after);
    if (openParen === -1) continue;
    const close = findMatchingParen(t, openParen);
    if (close === -1) continue;
    const inner = t.slice(openParen + 1, close);
    if (hasTrailingSignalArg(inner)) continue;
    inserts.push(close);
  }
  inserts.sort((a, b) => b - a);
  let s = t;
  for (const close of inserts) {
    s = s.slice(0, close) + ", { signal }" + s.slice(close);
  }
  return s;
}

function processFile(fp) {
  let t = fs.readFileSync(fp, "utf8");
  const orig = t;
  t = t.replace(/queryFn:\s*async\s*\(\s*\)\s*=>/g, "queryFn: async ({ signal }) =>");
  t = t.replace(/queryFn:\s*\(\s*\)\s*=>/g, "queryFn: ({ signal }) =>");
  t = t.replace(/queryFn:\s*\(\s*\{\s*\{\s*signal\s*\}\s*\}\s*\)\s*=>/g, "queryFn: ({ signal }) =>");
  t = t.replace(/queryFn:\s*async\s*\(\s*\{\s*\{\s*signal\s*\}\s*\}\s*\)\s*=>/g, "queryFn: async ({ signal }) =>");

  for (const name of ["apiGetJson", "apiPostJson", "apiGetText"]) {
    t = patchImmediateApiAfterQueryFn(t, name);
  }

  if (t !== orig) fs.writeFileSync(fp, t, "utf8");
}

for (const fp of walk(ROOT)) {
  if (fp.includes(`${path.sep}lib${path.sep}api.ts`)) continue;
  processFile(fp);
}

console.log("patch-query-signal: done");
