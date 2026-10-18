import { verifySoftwareUpdates } from "./test-software-updates.mjs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { assertGameArchiveConsistency, assertManifestEdition, assertMinshengArchiveConsistency } from "./archive-consistency.mjs";
import { validateGame } from "./game-lib.mjs";
import { validateMinsheng } from "./minsheng-lib.mjs";
import { checkHeroAssets } from "./build-hero-assets.mjs";
import { parseWorks } from "../site/js/data/works.js";
import { SHARD_VERSION } from "./check-shard-style.mjs";
await import("../portal-data.js");

const root = process.cwd();
const output = path.join(root, "dist");
await verifySoftwareUpdates(output, { sourceRoot: root });
for (const file of ["brand.css", "portal.css", "site-shell.js"]) await access(path.join(output, file));
const adminIndex = path.join(output, "admin", "messages", "index.html");
const hasAdmin = await access(adminIndex).then(() => true, () => false);
const required = ["index.html", "home.css", "portal-data.js", "portal.js", "THIRD-PARTY-NOTICES.txt", "data/resources.json", "message-config.js", "message-client.js", "messages/index.html", "messages/app.js", "privacy/index.html", "app.js", "game/index.html", "minsheng/index.html", "minsheng/message-link.css", "minsheng/aligned-layout.css", "brand-assets/springhues-logo.png", "data/index.json", "data/minsheng/index.json", ".nojekyll"];
if (hasAdmin) required.push("admin/messages/index.html", "admin/messages/admin.css", "admin/messages/client.js", "admin/messages/app.js");
for (const file of required) {
  await access(path.join(output, file));
}
await access(path.join(output, "data", ".pending")).then(
  () => { throw new Error("构建产物不得包含 data/.pending 草稿"); },
  () => {}
);

const gameManifest = await readJson(path.join(output, "data", "index.json"));
const civicManifest = await readJson(path.join(output, "data", "minsheng", "index.json"));
const gameBriefs = [];
for (const edition of gameManifest.editions) {
  const brief = await readJson(path.join(output, edition.file));
  validateGame(brief, { expectedDate: edition.date });
  assertManifestEdition(edition, brief, "游戏日报");
  gameBriefs.push(brief);
}
for (const brief of gameBriefs) assertGameArchiveConsistency(brief, gameBriefs);
for (const edition of gameManifest.editions) {
  await assertPng(path.join(output, "downloads", "game", `${edition.date}.png`), `游戏日报 ${edition.date}`);
}

const civicBriefs = [];
for (const edition of civicManifest.editions) {
  const brief = await readJson(path.join(output, edition.file));
  validateMinsheng(brief, { expectedDate: edition.date });
  assertManifestEdition(edition, brief, "民生日报");
  civicBriefs.push(brief);
}
for (const brief of civicBriefs) assertMinshengArchiveConsistency(brief, civicBriefs);
for (const edition of civicManifest.editions) {
  await assertPng(path.join(output, "downloads", "minsheng", `${edition.date}.png`), `民生日报 ${edition.date}`);
}
const portalHtml = await readFile(path.join(output, "index.html"), "utf8");
const messageHtml = await readFile(path.join(output, "messages", "index.html"), "utf8");
const adminHtml = hasAdmin ? await readFile(adminIndex, "utf8") : "";
const gameHtml = await readFile(path.join(output, "game", "index.html"), "utf8");
const minshengHtml = await readFile(path.join(output, "minsheng", "index.html"), "utf8");
const privacyHtml = await readFile(path.join(output, "privacy", "index.html"), "utf8");
// 日报页与后台仍用旧外壳（日报导出器消费它们）；留言 / 隐私页换成 SHARD 外壳。
for (const html of [gameHtml, minshengHtml, ...(hasAdmin ? [adminHtml] : [])]) {
  if (!html.includes("data-site-page=") || !html.includes("site-shell.js?v=20261017-unified") || !html.includes("brand.css?v=20261017-moon-v1")) throw new Error("构建页面缺少统一主题或导航");
}
for (const html of [gameHtml, minshengHtml, messageHtml, privacyHtml]) {
  for (const part of ["site/boot.js?v=" + SHARD_VERSION, "site/css/shard-theme.css?v=" + SHARD_VERSION, "site/js/shell/shell.js?v=" + SHARD_VERSION]) {
    if (!html.includes(part)) throw new Error("构建页面缺少 SHARD 外壳引用：" + part);
  }
}
for (const html of [messageHtml, privacyHtml]) {
  if (!html.includes("data-site-page=") || /site-shell\.js|brand\.css|portal\.css|site-rail/.test(html) || /href=["'](?:\.\.?\/)?admin\//.test(html)) throw new Error("留言 / 隐私页不得引用旧外壳，也不得公开后台入口");
}
if (hasAdmin && adminHtml.includes("shard")) throw new Error("后台页不得引入 SHARD 外壳");
if (!portalHtml.includes('class="quick-message-link"') || portalHtml.includes("data-message-form") || /href=["'](?:\.\/)?admin\//.test(portalHtml)) throw new Error("首页须保留独立留言入口，不得内嵌表单或公开后台导航");
for (const id of ["worksWall", "civicLink", "gameLink"]) {
  if (!portalHtml.includes(`id="${id}"`)) throw new Error(`首页缺少入口 ${id}`);
}
globalThis.SpringhuesPortalData.parseCatalog(await readJson(path.join(output, "data", "resources.json")), { includeUnpublished: true });
if (!messageHtml.includes('id="messageList"') || !messageHtml.includes("data-message-form")) throw new Error("构建产物缺少完整留言页");
if (hasAdmin && (!adminHtml.includes('name="robots" content="noindex,nofollow,noarchive"') || !adminHtml.includes('http-equiv="Cache-Control" content="no-store') || !adminHtml.includes('id="loginForm"'))) throw new Error("构建产物缺少受保护且禁缓存的留言后台登录页");
if (hasAdmin && (!adminHtml.includes('role="tablist"') || !adminHtml.includes('id="websiteChangesPanel"') || !adminHtml.includes('id="maintenancePanel"') || !adminHtml.includes('id="websiteChangesTab" class="active"'))) throw new Error("构建产物缺少默认日志页的管理员三标签页");
if (!gameHtml.includes('class="header-message-link" href="messages/"') || !minshengHtml.includes('class="header-message-link" href="../messages/"')) throw new Error("两个日报页头必须包含频道色留言按钮");
if (!privacyHtml.includes("Turnstile Privacy Addendum") || !privacyHtml.includes("来源哈希")) throw new Error("构建产物缺少留言隐私说明");
for (const file of ["site/works.json", "site/js/main.js", "site/js/core/tween.js", "site/js/core/flip.js", "site/js/core/page-transition.js", "site/js/wall/parallax.js", "site/boot.js", "site/css/shard-theme.css", "site/css/wipe.css", "site/css/pages-daily.css", "site/css/pages-messages.css", "site/css/pages-privacy.css", "site/js/shell/shell.js", "site/js/shell/links.js", "vendor/lenis/lenis.min.js", "assets/hero/web/hero-1600.webp", "assets/hero/web/hero-p-1080.webp", "assets/fonts/anton-latin.woff2"]) {
  await access(path.join(output, file));
}
// 首页动效全部是原生实现：dist 里不得再出现第三方动画库的目录或字样（正则用拼接构造，避免本文件自己命中）。
const bannedLib = ["gs" + "ap", "Scroll" + "Trigger", "\\bFl" + "ip\\b"].join("|");
await access(path.join(output, "vendor", "gs" + "ap")).then(
  () => { throw new Error("构建产物不得包含已移除的第三方动画库目录"); },
  () => {}
);
for (const rel of ["index.html", "site", "vendor"]) {
  for (const file of await listFiles(path.join(output, rel))) {
    if (!/\.(?:js|css|html|json|txt)$/.test(file)) continue;
    const m = new RegExp(bannedLib).exec(await readFile(file, "utf8"));
    if (m) throw new Error(`构建产物 ${path.relative(output, file)} 含已移除的动画库字样：${m[0]}`);
  }
}
await access(path.join(output, "assets", "hero", "风格化.jpeg")).then(
  () => { throw new Error("构建产物不得包含 5MB 主视觉原图"); },
  () => {}
);
const heroCheck = await checkHeroAssets(path.join(output, "assets", "hero", "web"));
if (!heroCheck.ok) throw new Error("主视觉衍生图校验失败：" + heroCheck.errors.join("; "));
if (!portalHtml.includes("site/js/main.js?v=")) throw new Error("首页入口模块必须带版本戳");
if (!portalHtml.includes("site/css/wipe.css?v=" + SHARD_VERSION)) throw new Error("首页须引用擦屏样式 wipe.css");
// 日报页隔离：被导出器消费的构建产物里不得出现 SHARD 外壳（导出视觉不变）
for (const rel of ["brand.css", "styles.css", "site-shell.js", "app.js", "minsheng/styles.css", "minsheng/mobile-fix.css", "minsheng/aligned-layout.css", "minsheng/message-link.css", "minsheng/app.js"]) {
  if (/\.sd-|shard-live/.test(await readFile(path.join(output, rel), "utf8"))) throw new Error(`${rel} 被日报导出器消费，构建产物里不得含 SHARD 外壳`);
}
const builtWorks = parseWorks(await readJson(path.join(output, "site", "works.json")));
if (!builtWorks.works.length) throw new Error("作品清单不能为空");
console.log("构建产物验证通过：公开文件完整，草稿已排除，双频道入口与留言回复有效" + (hasAdmin ? "，管理后台有效。" : "。"));

async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }
async function listFiles(target) {
  if (!(await stat(target)).isDirectory()) return [target];
  const out = [];
  for (const entry of await readdir(target, { withFileTypes: true })) out.push(...await listFiles(path.join(target, entry.name)));
  return out;
}
async function assertPng(file, label) {
  const buffer = await readFile(file);
  if (buffer.length <= 24) throw new Error(`${label} PNG 文件不能为空`);
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`${label} 必须是有效 PNG`);
  if (buffer.readUInt32BE(16) !== 3840) throw new Error(`${label} PNG 宽度必须为 3840px`);
}
