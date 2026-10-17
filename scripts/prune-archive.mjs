// 归档保留窗口：每个频道只保留最近 N 期（默认 7）。
// 默认 dry-run，只打印将要移除的内容；加 --apply 才执行。
// 只处理受 git 跟踪的文件（git rm，可从历史恢复）；未跟踪文件一律不动。
// 索引只做“过滤条目”，字段结构、排序与发布脚本写入的格式一致（JSON 缩进 2 空格 + 换行）。
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_KEEP = 7;
export const CHANNELS = Object.freeze({
  game: { label: "游戏日报", manifest: "data/index.json", dataDir: "data", pngDir: "downloads/game" },
  minsheng: { label: "民生日报", manifest: "data/minsheng/index.json", dataDir: "data/minsheng", pngDir: "downloads/minsheng" }
});
const ASSET_DIR = "game-brief-assets";
const ASSET_REF = /game-brief-assets\/[A-Za-z0-9][A-Za-z0-9._-]*/g;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_PREFIXES = ["data/", "downloads/", `${ASSET_DIR}/`];

export function parseArgs(argv) {
  const options = { apply: false, keep: DEFAULT_KEEP, channel: "both" };
  for (const arg of argv) {
    if (arg === "--apply") options.apply = true;
    else if (arg.startsWith("--keep=")) {
      const keep = Number(arg.slice(7));
      if (!Number.isInteger(keep) || keep < 1) throw new Error("--keep 必须是不小于 1 的整数");
      options.keep = keep;
    } else if (arg.startsWith("--channel=")) {
      options.channel = arg.slice(10);
      if (!["game", "minsheng", "both"].includes(options.channel)) throw new Error("--channel 只能是 game、minsheng 或 both");
    } else throw new Error(`未知参数：${arg}\n用法：node scripts/prune-archive.mjs [--apply] [--keep=7] [--channel=game|minsheng|both]`);
  }
  return options;
}

const git = (root, args, input) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, input, stdio: ["pipe", "pipe", "pipe"] });
const abs = (root, rel) => path.join(root, ...rel.split("/"));
const dateOf = (name) => /^(\d{4}-\d{2}-\d{2})-/.exec(name)?.[1] ?? null;

async function sizeOf(root, rel) {
  try { return (await stat(abs(root, rel))).size; } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export function collectAssetRefs(value, into = new Set()) {
  if (typeof value === "string") for (const match of value.matchAll(ASSET_REF)) into.add(match[0]);
  else if (Array.isArray(value)) for (const item of value) collectAssetRefs(item, into);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectAssetRefs(item, into);
  return into;
}

async function readJsonIfPresent(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function pendingRefs(root) {
  const refs = new Set();
  const walk = async (dir) => {
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".json")) {
        try { collectAssetRefs(JSON.parse(await readFile(full, "utf8")), refs); } catch { /* 草稿损坏不影响清理判断 */ }
      }
    }
  };
  await walk(path.join(root, "data", ".pending"));
  return refs;
}

// 其它受跟踪文件（页面、脚本之外的站点文件）对配图的引用，也算保留集。
function otherTrackedRefs(root) {
  let out = "";
  try {
    out = git(root, ["grep", "-I", "-h", "-o", "-E", "game-brief-assets/[A-Za-z0-9][A-Za-z0-9._-]*", "--", ".",
      ":(exclude,glob)data/**/[0-9]*.json", ":(exclude)data/embedded.js", ":(exclude)downloads", `:(exclude)${ASSET_DIR}`,
      ":(exclude)dist", ":(exclude)scripts", ":(exclude)docs", ":(exclude)artifacts", ":(exclude).github", ":(exclude)AGENTS.md"]);
  } catch (error) {
    if (error.status !== 1) throw error; // 1 = 没有匹配
  }
  return new Set(out.split(/\r?\n/).filter(Boolean));
}

// 读取并校验一个频道的索引，把期次分成保留 / 移除两组（取索引里按日期倒序的前 N 个日期，不假设连续）。
async function planChannel(root, channel, keep, tracked) {
  const config = CHANNELS[channel];
  const manifest = JSON.parse(await readFile(abs(root, config.manifest), "utf8"));
  if (!Array.isArray(manifest.editions)) throw new Error(`${config.label}索引 editions 不是数组`);
  const dates = manifest.editions.map((edition) => edition.date);
  if (dates.some((date) => !DATE.test(date))) throw new Error(`${config.label}索引含无效日期`);
  if (new Set(dates).size !== dates.length) throw new Error(`${config.label}索引含重复日期，拒绝清理`);
  for (const edition of manifest.editions) {
    if (edition.file !== `${config.dataDir}/${edition.date}.json`) throw new Error(`${config.label} ${edition.date} 的 file 路径异常：${edition.file}`);
  }
  const keepDates = new Set([...dates].sort().reverse().slice(0, keep));
  const kept = manifest.editions.filter((edition) => keepDates.has(edition.date));
  const removed = manifest.editions.filter((edition) => !keepDates.has(edition.date));
  const windowStart = [...keepDates].sort()[0];
  const warnings = [];
  const files = [];
  const untracked = [];
  const removedBodies = [];

  for (const edition of kept) {
    for (const rel of [edition.file, `${config.pngDir}/${edition.date}.png`]) {
      if (!tracked.has(rel) && (await sizeOf(root, rel)) === null) warnings.push(`保留期次 ${edition.date} 的文件缺失：${rel}（索引与文件不一致）`);
    }
  }

  const targets = new Map(); // 日期 -> 来源说明
  for (const edition of removed) targets.set(edition.date, "索引条目");
  // 残留：已不在索引里、早于窗口、仍受跟踪的正文 / PNG（例如上次清理中断）。
  const patterns = [
    [new RegExp(`^${config.dataDir.replaceAll("/", "\\/")}\\/(\\d{4}-\\d{2}-\\d{2})\\.json$`), "正文"],
    [new RegExp(`^${config.pngDir.replaceAll("/", "\\/")}\\/(\\d{4}-\\d{2}-\\d{2})\\.png$`), "PNG"]
  ];
  for (const rel of tracked) {
    for (const [pattern, kind] of patterns) {
      const date = pattern.exec(rel)?.[1];
      if (!date || dates.includes(date)) continue;
      if (date < windowStart) targets.set(date, targets.get(date) ?? `索引外残留${kind}`);
      else warnings.push(`${rel} 不在索引里但日期不早于窗口，无法判断，已保留`);
    }
  }

  for (const [date, origin] of [...targets].sort((a, b) => b[0].localeCompare(a[0]))) {
    const body = `${config.dataDir}/${date}.json`;
    const png = `${config.pngDir}/${date}.png`;
    for (const [rel, kind] of [[body, "body"], [png, "png"]]) {
      if (tracked.has(rel)) files.push({ path: rel, kind, date, bytes: (await sizeOf(root, rel)) ?? 0 });
      else if ((await sizeOf(root, rel)) !== null) untracked.push({ path: rel, bytes: await sizeOf(root, rel) });
      else if (origin === "索引条目") warnings.push(`被移除期次 ${date} 的 ${kind === "body" ? "正文" : "PNG"} 本就缺失：${rel}（索引与文件不一致，仅清理索引条目）`);
    }
    if (tracked.has(body)) {
      const brief = await readJsonIfPresent(abs(root, body));
      if (brief) removedBodies.push({ date, brief });
    }
  }
  return { channel, label: config.label, manifest, manifestPath: config.manifest, kept, removed, windowStart,
    removedDates: [...targets.keys()].sort().reverse(), files, untracked, warnings, removedBodies, indexChanged: removed.length > 0 };
}

export async function planPrune({ root = process.cwd(), keep = DEFAULT_KEEP, channel = "both" } = {}) {
  const channels = channel === "both" ? ["game", "minsheng"] : [channel];
  const tracked = new Set(git(root, ["ls-files", "-z", "--", "data", "downloads", ASSET_DIR]).split("\0").filter(Boolean));
  const plans = [];
  for (const name of channels) plans.push(await planChannel(root, name, keep, tracked));

  const assets = { delete: [], byName: [], shared: [], unknown: [], untrackedOld: [], missingRefs: [] };
  const game = plans.find((plan) => plan.channel === "game");
  if (game) {
    const retained = new Set();
    for (const edition of game.kept) {
      const brief = await readJsonIfPresent(abs(root, edition.file));
      if (brief) collectAssetRefs(brief, retained);
    }
    const protectedRefs = new Set([...retained, ...otherTrackedRefs(root), ...(await pendingRefs(root))]);
    const removedRefs = new Set();
    for (const { brief } of game.removedBodies) collectAssetRefs(brief, removedRefs);
    const trackedAssets = [...tracked].filter((rel) => rel.startsWith(`${ASSET_DIR}/`));
    const deleteSet = new Set();
    for (const rel of removedRefs) {
      if (!tracked.has(rel)) { assets.missingRefs.push(rel); continue; }
      if (protectedRefs.has(rel)) assets.shared.push(rel);
      else deleteSet.add(rel);
    }
    for (const rel of trackedAssets) {
      if (deleteSet.has(rel) || protectedRefs.has(rel)) continue;
      const date = dateOf(path.posix.basename(rel));
      if (date && date < game.windowStart) assets.byName.push(rel);
      else assets.unknown.push(rel);
    }
    const withSize = async (list) => Promise.all(list.map(async (rel) => ({ path: rel, bytes: (await sizeOf(root, rel)) ?? 0 })));
    assets.delete = await withSize([...deleteSet].sort());
    assets.byName = await withSize(assets.byName.sort());
    assets.unknownCount = assets.unknown.length;
    // 未跟踪的旧图只提示，绝不处理。
    let names = [];
    try { names = await readdir(abs(root, ASSET_DIR)); } catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const name of names) {
      const rel = `${ASSET_DIR}/${name}`;
      const date = dateOf(name);
      if (!tracked.has(rel) && date && date < game.windowStart) assets.untrackedOld.push({ path: rel, bytes: (await sizeOf(root, rel)) ?? 0 });
    }
  }

  const deletions = [...plans.flatMap((plan) => plan.files), ...(assets.delete.map((item) => ({ ...item, kind: "asset" }))), ...(assets.byName.map((item) => ({ ...item, kind: "asset-by-name" })))];
  for (const item of deletions) {
    if (!tracked.has(item.path) || !ALLOWED_PREFIXES.some((prefix) => item.path.startsWith(prefix))) throw new Error(`内部错误：拒绝删除未跟踪或范围外文件 ${item.path}`);
  }
  const nothing = deletions.length === 0 && plans.every((plan) => !plan.indexChanged);
  return { root, keep, plans, assets, deletions, nothing };
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const sum = (items) => items.reduce((total, item) => total + item.bytes, 0);

export function renderReport(plan, { apply = false } = {}) {
  const lines = [`归档保留窗口：每个频道保留最近 ${plan.keep} 期（${apply ? "执行模式 --apply" : "dry-run，不会改动任何文件"}）`];
  for (const item of plan.plans) {
    const png = item.files.filter((file) => file.kind === "png");
    const body = item.files.filter((file) => file.kind === "body");
    lines.push("", `【${item.label}】索引 ${item.manifest.editions.length} 期，保留 ${item.kept.length} 期（${item.kept.at(-1)?.date} ~ ${item.kept[0]?.date}），移除 ${item.removed.length} 个索引条目`);
    if (item.removedDates.length) lines.push(`  移除期次：${item.removedDates.length} 个（${item.removedDates.at(-1)} ~ ${item.removedDates[0]}）`);
    lines.push(`  正文 JSON：${body.length} 个，${mb(sum(body))}`, `  公开 PNG：${png.length} 张，${mb(sum(png))}`);
    if (item.untracked.length) lines.push(`  未跟踪的旧期次文件 ${item.untracked.length} 个未处理（${mb(sum(item.untracked))}）：${item.untracked.map((file) => file.path).join("、")}`);
    for (const warning of item.warnings) lines.push(`  警告：${warning}`);
  }
  if (plan.plans.some((item) => item.channel === "game")) {
    const { assets } = plan;
    lines.push("", `【game-brief-assets】`,
      `  被移除期次引用且不被保留期次/其它页面/草稿引用的受跟踪配图：${assets.delete.length} 个，${mb(sum(assets.delete))}`,
      `  仅按文件名日期（早于窗口）判定的受跟踪配图：${assets.byName.length} 个，${mb(sum(assets.byName))}（单列，请核对）`);
    for (const item of assets.byName.slice(0, 20)) lines.push(`    · ${item.path}`);
    if (assets.byName.length > 20) lines.push(`    · …其余 ${assets.byName.length - 20} 个`);
    lines.push(`  与保留期次共用而保留的配图：${assets.shared.length} 个`,
      `  无法判断而保留的受跟踪配图：${assets.unknown.length} 个（无日期记号且无人引用，或日期不早于窗口但未被保留期次引用）`);
    for (const rel of assets.unknown.slice(0, 10)) lines.push(`    · ${rel}`);
    if (assets.unknown.length > 10) lines.push(`    · …其余 ${assets.unknown.length - 10} 个`);
    if (assets.missingRefs.length) lines.push(`  警告：被移除期次引用但不受跟踪/不存在的配图 ${assets.missingRefs.length} 个，未处理`);
    if (assets.untrackedOld.length) lines.push(`  有 ${assets.untrackedOld.length} 个未跟踪的旧图未处理（${mb(sum(assets.untrackedOld))}，不在 git 里，删除后无法恢复，已保持原样）`);
  }
  const total = plan.deletions;
  lines.push("", plan.nothing ? "无可移除内容（已是最近窗口，幂等）。" : `合计：git rm ${total.length} 个受跟踪文件（${mb(sum(total))}），并更新 ${plan.plans.filter((item) => item.indexChanged).map((item) => item.manifestPath).join("、") || "（无索引变更）"}。`);
  return lines.join("\n");
}

async function writeManifest(root, rel, manifest) {
  const target = abs(root, rel);
  const temporary = `${target}.${process.pid}.prune`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, target);
}

function defaultRebuildEmbedded(root) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "build-embedded.mjs")], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error("build-embedded.mjs 执行失败，请排查后手动重跑");
}

// 先改索引，再 git rm 文件：中途失败时只会留下“索引外残留”，下次运行会自动补清。
export async function applyPrune(plan, { rebuildEmbedded = defaultRebuildEmbedded } = {}) {
  const { root } = plan;
  for (const item of plan.plans) {
    if (!item.indexChanged) continue;
    const kept = new Set(item.kept.map((edition) => edition.date));
    await writeManifest(root, item.manifestPath, { ...item.manifest, editions: item.manifest.editions.filter((edition) => kept.has(edition.date)) });
  }
  for (let start = 0; start < plan.deletions.length; start += 500) {
    const batch = plan.deletions.slice(start, start + 500).map((item) => item.path);
    git(root, ["rm", "-q", "--pathspec-from-file=-", "--pathspec-file-nul"], `${batch.join("\0")}\0`);
  }
  if (plan.plans.some((item) => item.channel === "game" && (item.indexChanged || item.files.length))) await rebuildEmbedded(root);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const plan = await planPrune({ keep: options.keep, channel: options.channel });
    console.log(renderReport(plan, options));
    if (options.apply && !plan.nothing) {
      await applyPrune(plan);
      console.log("\n已完成清理：被删文件已进入 git 暂存区（git rm），索引已更新，data/embedded.js 已重新生成。请按路径精确提交。");
    } else if (!options.apply && !plan.nothing) console.log("\n以上为预览。确认后加 --apply 执行。");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
