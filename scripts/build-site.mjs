import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "dist");
if (path.dirname(output) !== root || path.basename(output) !== "dist") {
  throw new Error("Refusing to clean an unexpected output directory.");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of ["index.html", "home.css", "portal-data.js", "portal.css", "portal.js", "THIRD-PARTY-NOTICES.txt", "message-config.js", "message-client.js", "styles.css", "brand.css", "site-shell.js", "app.js"]) {
  await cp(path.join(root, file), path.join(output, file));
}
await cp(path.join(root, "messages"), path.join(output, "messages"), { recursive: true });
// 公开前端仓库不含后台目录；私有仓库有则照常复制。
await cp(path.join(root, "admin"), path.join(output, "admin"), { recursive: true }).catch(() => {});
await cp(path.join(root, "privacy"), path.join(output, "privacy"), { recursive: true });
await cp(path.join(root, "game"), path.join(output, "game"), { recursive: true });
await cp(path.join(root, "minsheng"), path.join(output, "minsheng"), { recursive: true });
await cp(path.join(root, "game-brief-assets"), path.join(output, "game-brief-assets"), { recursive: true });
await cp(path.join(root, "brand-assets"), path.join(output, "brand-assets"), { recursive: true });
await cp(path.join(root, "data"), path.join(output, "data"), { recursive: true });
// 场景页的访问快照：构建时取一次最新数字；取不到就沿用仓库里的旧快照，不影响构建。
try {
  const response = await fetch("https://springhues.goatcounter.com/counter/TOTAL.json", {
    signal: AbortSignal.timeout(5000)
  });
  if (response.ok) {
    const raw = await response.json();
    const snapshot = {
      visits: Number(raw.count) || 0,
      visitors: Number(raw.count_unique) || 0,
      updated: new Date().toISOString().replace(/\.\d+Z$/, "Z")
    };
    await writeFile(path.join(output, "data", "scene-stats.json"), JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  }
} catch {
  // 网络不可用时保留已复制的旧快照。
}
await cp(path.join(root, "downloads"), path.join(output, "downloads"), { recursive: true });
for (const dir of ["site", "vendor", "works", "updates", "assets/hero/web", "assets/fonts"]) {
  await cp(path.join(root, dir), path.join(output, dir), { recursive: true });
}
// 模块地址带构建版本：每次部署都换 URL，避免浏览器沿用旧脚本。
const stamp = (process.env.GITHUB_SHA || "").slice(0, 8) || String(Date.now());
await versionImports(path.join(output, "site"));
// 防止把 5MB 原图或其他大文件带进 dist
const oversize = await findOver(path.join(output, "assets"), 1024 * 1024);
if (oversize.length) throw new Error("dist/assets 含过大文件：" + oversize.join(", "));
await rm(path.join(output, "data", ".pending"), { recursive: true, force: true });
await writeFile(path.join(output, ".nojekyll"), "", "utf8");
console.log(`Built static site at ${output}`);

// 给 JS 模块的相对 import 追加 ?v=<构建版本>；已带查询串的不重复追加。
async function versionImports(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { await versionImports(full); continue; }
    if (!entry.name.endsWith(".js")) continue;
    const src = await readFile(full, "utf8");
    const out = src
      .replace(/(\bfrom\s*["'])(\.{1,2}\/[^"']+\.js)(["'])/g, (m, a, spec, b) => a + withStamp(spec) + b)
      .replace(/(\bimport\s*\(\s*["'])(\.{1,2}\/[^"']+\.js)(["']\s*\))/g, (m, a, spec, b) => a + withStamp(spec) + b);
    if (out !== src) await writeFile(full, out, "utf8");
  }
}

function withStamp(spec) {
  return spec.includes("?") ? spec : spec + "?v=" + stamp;
}

async function findOver(dir, limit) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await findOver(full, limit));
    else if ((await stat(full)).size > limit) found.push(full);
  }
  return found;
}
