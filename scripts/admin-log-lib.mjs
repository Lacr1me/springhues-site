import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OPERATION_FILE_PATTERN = /(health|run-state|readiness|recover|recovery|maintenance|cleanup|correction|publish)/iu;
const METADATA_KEYS = new Set([
  "date", "healthy", "degraded", "status", "stage", "published", "channel", "channels",
  "issue", "issues", "reasonCode", "reasonCodes", "warnings", "transport", "runKind",
  "runs", "id", "kind", "files", "directories", "width", "count", "commit", "areas"
]);
const WEBSITE_AREAS = [
  {
    name: "管理员与留言",
    title: "管理员",
    description: "完善管理员后台、留言审核与权限相关功能。",
    pattern: /^(?:admin\/messages\/|messages\/|message-|portal-messages\.js$|supabase\/)/u
  },
  {
    name: "网站首页与品牌",
    title: "首页品牌",
    description: "优化网站首页、频道入口与品牌内容。",
    pattern: /^(?:index\.html$|portal(?:\.|\/)|brand-assets\/|brand\.css$)/u
  },
  {
    name: "民生日报",
    title: "民生日报",
    description: "更新民生日报页面、内容与下载产物。",
    pattern: /^(?:minsheng\/|data\/minsheng\/|downloads\/minsheng\/)/u
  },
  {
    name: "游戏日报",
    title: "游戏日报",
    description: "更新游戏日报页面、内容与下载产物。",
    pattern: /^(?:game\/|game-brief-assets\/|data\/\d{4}-\d{2}-\d{2}\.json$|downloads\/game\/|app\.js$|styles\.css$)/u
  },
  {
    name: "日报数据与下载",
    title: "数据下载",
    description: "更新日报数据、归档索引与下载内容。",
    pattern: /^(?:data\/|downloads\/)/u
  },
  {
    name: "发布与维护流程",
    title: "发布流程",
    description: "优化网站发布、自动化与维护流程。",
    pattern: /^(?:scripts\/|\.github\/|config\/|README\.md$)/u
  },
  {
    name: "项目文档",
    title: "项目文档",
    description: "更新网站修改记录与项目文档。",
    pattern: /^docs\//u
  }
];

export function sanitizeText(value, maximum = 2000) {
  let text = String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [已清理]")
    .replace(/\b(token|secret|password|service[_-]?role[_-]?key|api[_-]?key)\s*[:=]\s*[^\s,;]+/giu, "$1=[已清理]")
    .replace(/\b[A-Z]:\\[^\r\n,;]+/giu, "[本地路径已清理]")
    .replace(/\/(?:Users|home|var|tmp)\/[^\r\n,;]+/gu, "[本地路径已清理]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[邮箱已清理]")
    .replace(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/gu, "[IP已清理]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .trim();
  if (Array.from(text).length > maximum) text = `${Array.from(text).slice(0, maximum - 1).join("")}…`;
  return text;
}

export function sanitizeMetadata(value, depth = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 2) return {};
  const output = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!METADATA_KEYS.has(key)) continue;
    if (raw === null || typeof raw === "boolean" || typeof raw === "number") output[key] = raw;
    else if (typeof raw === "string") output[key] = sanitizeText(raw, 240);
    else if (Array.isArray(raw)) {
      output[key] = raw.slice(0, 20).map((item) => {
        if (item === null || typeof item === "boolean" || typeof item === "number") return item;
        if (typeof item === "string") return sanitizeText(item, 240);
        return sanitizeMetadata(item, depth + 1);
      });
    } else if (key === "channels") output[key] = sanitizeChannels(raw, depth + 1);
    else output[key] = sanitizeMetadata(raw, depth + 1);
  }
  return output;
}

function sanitizeChannels(value, depth) {
  const output = {};
  for (const channel of ["game", "minsheng"]) {
    if (value?.[channel] && typeof value[channel] === "object") output[channel] = sanitizeMetadata(value[channel], depth);
  }
  return output;
}

export function normalizeLogItem(item) {
  const occurredAt = new Date(item.occurredAt);
  if (!Number.isFinite(occurredAt.getTime())) throw new Error(`日志时间无效：${item.occurredAt}`);
  const output = {
    kind: item.kind,
    occurredAt: occurredAt.toISOString(),
    title: sanitizeText(item.title, 160),
    summary: sanitizeText(item.summary, 2000),
    status: item.status,
    source: sanitizeText(item.source, 80),
    sourceKey: sanitizeText(item.sourceKey, 300),
    metadata: sanitizeMetadata(item.metadata)
  };
  if (!new Set(["website_change", "maintenance"]).has(output.kind)) throw new Error("日志类型无效");
  if (!new Set(["info", "success", "warning", "failure"]).has(output.status)) throw new Error("日志状态无效");
  for (const key of ["title", "summary", "source", "sourceKey"]) if (!output[key]) throw new Error(`日志字段不能为空：${key}`);
  return output;
}

export async function collectGitWebsiteChange(root, revision = "HEAD") {
  const { stdout } = await execFileAsync("git", ["show", "-s", "--format=%cI", revision], { cwd: root, encoding: "utf8" });
  return collectDailyWebsiteChange(root, {
    date: beijingDate(stdout.trim()),
    revision,
    source: "github_pages"
  });
}

export async function collectDailyWebsiteChange(root, {
  date = beijingDate(new Date()),
  revision = "HEAD",
  source = "nightly_summary"
} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00+08:00`))) {
    throw new Error(`日志日期无效：${date}`);
  }
  const range = [
    revision,
    `--since=${date}T00:00:00+08:00`,
    `--until=${date}T23:59:59+08:00`
  ];
  const [{ stdout: commitOutput }, { stdout: fileOutput }] = await Promise.all([
    execFileAsync("git", ["log", ...range, "--format=%H%x00%cI"], { cwd: root, encoding: "utf8" }),
    execFileAsync("git", ["log", ...range, "--name-only", "--pretty=format:"], { cwd: root, encoding: "utf8" })
  ]);
  const commits = commitOutput.split(/\r?\n/u).map((line) => {
    const [commit, occurredAt] = line.split("\0");
    return commit && occurredAt ? { commit, occurredAt } : null;
  }).filter(Boolean);
  const files = [...new Set(fileOutput.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean))];
  const areas = classifyAreas(files);
  const latest = commits[0] || null;
  const occurredAt = latest?.occurredAt || `${date}T23:50:00+08:00`;
  const hasChanges = commits.length > 0;
  return normalizeLogItem({
    kind: "website_change",
    occurredAt,
    title: hasChanges ? websiteLogTitle(date, areas) : `${date}｜网站日志`,
    summary: hasChanges
      ? (areas.length ? areas.map((area) => `• ${area.description}`).join("\n") : "• 网站代码或配置已更新。")
      : "• 当天无修改",
    status: hasChanges ? "success" : "info",
    source,
    sourceKey: `website_change:${date}`,
    metadata: {
      date,
      count: commits.length,
      commit: latest?.commit?.slice(0, 12) || "",
      areas: areas.map((area) => area.name)
    }
  });
}

function classifyAreas(files) {
  return WEBSITE_AREAS.filter((area) => files.some((file) => area.pattern.test(file)));
}

function websiteLogTitle(date, areas) {
  if (!areas.length) return `${date}｜网站更新`;
  const titles = areas.slice(0, 3).map((area) => area.title);
  const subject = titles.length === 1
    ? titles[0]
    : `${titles.slice(0, -1).join("、")}与${titles.at(-1)}`;
  return `${date}｜${subject}${areas.length > 3 ? "等" : ""}更新`;
}

export async function collectImportedWebsiteChanges(root) {
  const candidates = [
    path.join(root, "docs", "2026-08-25-website-change-log.md"),
    path.join(root, "docs", "website-change-history.md")
  ];
  const byDate = new Map();
  for (const file of candidates) {
    let markdown;
    try { markdown = await readFile(file, "utf8"); } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    let sections = parseDatedMarkdown(markdown);
    if (!sections.length) {
      const date = path.basename(file).match(/^(\d{4}-\d{2}-\d{2})/u)?.[1];
      if (date) sections = parseDailyMarkdown(markdown, date);
    }
    for (const section of sections) byDate.set(section.date, section);
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)).map((section) => normalizeLogItem({
    kind: "website_change",
    occurredAt: `${section.date}T12:00:00+08:00`,
    title: section.title,
    summary: section.summary,
    status: "success",
    source: "initial_import",
    sourceKey: `website_change:${section.date}`,
    metadata: { date: section.date }
  }));
}

export function parseDatedMarkdown(markdown) {
  const lines = String(markdown).split(/\r?\n/u);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^##\s+(\d{4}-\d{2}-\d{2})(?:｜(.*))?\s*$/u);
    if (heading) {
      if (current) sections.push(finalizeSection(current));
      current = { date: heading[1], title: heading[2]?.trim() || "网站修改", bullets: [] };
    } else if (/^##\s+/u.test(line)) {
      if (current) sections.push(finalizeSection(current));
      current = null;
    } else if (current && /^\s*-\s+/u.test(line)) current.bullets.push(line.replace(/^\s*-\s+/u, "").replace(/\*\*/gu, "").trim());
  }
  if (current) sections.push(finalizeSection(current));
  return sections.filter((item) => item.summary);
}

function parseDailyMarkdown(markdown, date) {
  const bullets = [];
  let include = false;
  for (const line of String(markdown).split(/\r?\n/u)) {
    if (/^##\s+(今日更新|验证与发布)\s*$/u.test(line)) include = true;
    else if (/^##\s+/u.test(line)) include = false;
    else if (include && /^\s*-\s+/u.test(line)) bullets.push(line.replace(/^\s*-\s+/u, "").replace(/\*\*/gu, "").trim());
  }
  return bullets.length ? [{
    date,
    title: `${date}｜网站修改`,
    summary: bullets.map((item) => `• ${item}`).join("\n")
  }] : [];
}

function finalizeSection(section) {
  return {
    date: section.date,
    title: `${section.date}｜${section.title}`,
    summary: section.bullets.map((item) => `• ${item}`).join("\n")
  };
}

export async function collectMaintenanceLogs(root, { date = "" } = {}) {
  const directory = path.join(root, "artifacts", "operations");
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && OPERATION_FILE_PATTERN.test(entry.name) && (!date || entry.name.startsWith(date)))
    .map((entry) => entry.name)
    .sort();
  const items = [];
  for (const name of files) {
    const file = path.join(directory, name);
    let data;
    try { data = JSON.parse(await readFile(file, "utf8")); } catch { continue; }
    const info = await stat(file);
    items.push(operationToLog(name, data, info.mtime.toISOString()));
  }
  return items;
}

export function operationToLog(name, data, fallbackTime = new Date().toISOString()) {
  const fileDate = name.match(/^(\d{4}-\d{2}-\d{2})/u)?.[1] || "";
  const occurredAt = data.checkedAt || data.lastCheckpointAt || data.finishedAt || data.occurredAt || (fileDate ? `${fileDate}T12:00:00+08:00` : fallbackTime);
  let title = "维护操作记录";
  let summary = "维护流程已记录。";
  let status = "info";
  let source = "daily_operations";

  if (/health/iu.test(name)) {
    title = "双频道健康检查";
    status = data.healthy ? (data.degraded ? "warning" : "success") : "failure";
    summary = data.healthy
      ? `本地与线上检查通过${data.degraded ? "，存在降级警告" : ""}。`
      : `健康检查未通过${Array.isArray(data.reasonCodes) && data.reasonCodes.length ? `：${data.reasonCodes.join("、")}` : "。"}`;
    source = "health_check";
  } else if (/run-state/iu.test(name)) {
    const channels = Object.entries(data.channels || {});
    const published = channels.length > 0 && channels.every(([, channel]) => channel?.published === true);
    const failed = channels.some(([, channel]) => /fail|error/iu.test(String(channel?.status || "")));
    const corrections = Array.isArray(data.runs) ? data.runs.filter((run) => run.kind === "correction").length : 0;
    title = corrections ? "日报发布与数据修正" : "双频道日报运行状态";
    status = failed ? "failure" : published ? "success" : "warning";
    summary = published ? `双频道均已发布${corrections ? `，完成 ${corrections} 次数据修正` : ""}。` : `当前阶段：${data.stage || "未标记"}，仍有频道未完成发布。`;
    source = corrections ? "data_correction" : "daily_publish";
  } else if (/recover|recovery/iu.test(name)) {
    title = "日报失败补跑";
    status = /fail|error/iu.test(JSON.stringify({ status: data.status, reasonCodes: data.reasonCodes })) ? "failure" : "success";
    summary = status === "success" ? "补跑流程已完成。" : "补跑后仍存在失败项。";
    source = "rerun";
  } else if (/readiness/iu.test(name)) {
    title = "日报发布准备检查";
    const channelValues = Object.values(data.channels || {});
    const ready = data.ready === true || data.valid === true || data.status === "ready"
      || (channelValues.length > 0 && channelValues.every((channel) => channel?.verifiedAt));
    status = ready ? "success" : "warning";
    summary = ready ? "发布所需候选、页面和下载产物已就绪。" : "发布准备检查仍有待完成项目。";
    source = "publish_readiness";
  } else if (/cleanup|maintenance/iu.test(name)) {
    title = "本地历史产物清理";
    status = data.status === "failure" ? "failure" : "success";
    summary = `已归档 ${Number(data.directories || 0)} 个目录、${Number(data.files || 0)} 个文件。`;
    source = "local_cleanup";
  } else if (/correction/iu.test(name)) {
    title = "日报数据修正";
    status = data.status === "failure" ? "failure" : "success";
    summary = data.summary || "数据修正流程已记录。";
    source = "data_correction";
  }

  return normalizeLogItem({
    kind: "maintenance",
    occurredAt,
    title,
    summary,
    status,
    source,
    sourceKey: `operation:${name}`,
    metadata: { ...data, date: data.date || fileDate }
  });
}

export async function recordCleanupOperation(root, { directories = 0, files = 0, occurredAt = new Date().toISOString() } = {}) {
  const date = beijingDate(occurredAt);
  const timestamp = occurredAt.replace(/[-:.TZ]/gu, "").slice(0, 14);
  const directory = path.join(root, "artifacts", "operations");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${date}-local-cleanup-${timestamp}.json`);
  const event = { date, occurredAt, status: "success", directories: Number(directories), files: Number(files) };
  await writeFile(file, `${JSON.stringify(event, null, 2)}\n`, "utf8");
  return file;
}

function beijingDate(value) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export function deduplicateItems(items) {
  return [...new Map(items.map((item) => [item.sourceKey, item])).values()]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

export function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
