import process from "node:process";
import { MESSAGE_CONFIG } from "../message-config.js";
import {
  collectDailyWebsiteChange,
  collectGitWebsiteChange,
  collectImportedWebsiteChanges,
  collectMaintenanceLogs,
  deduplicateItems,
  recordCleanupOperation
} from "./admin-log-lib.mjs";

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const kind = args.kind || "all";
if (!new Set(["all", "website_change", "maintenance"]).has(kind)) throw new Error(`未知日志类型：${kind}`);

if (args["record-cleanup"]) {
  await recordCleanupOperation(root, {
    directories: numberArg(args.directories),
    files: numberArg(args.files)
  });
}

const items = [];
if (kind === "all" || kind === "website_change") {
  if (args["initial-import"]) items.push(...await collectImportedWebsiteChanges(root));
  if (args["daily-summary"]) {
    items.push(await collectDailyWebsiteChange(root, {
      date: args.date || undefined,
      revision: args.commit || "HEAD",
      source: "nightly_summary"
    }));
  } else if (!args["initial-import"] || args.commit) {
    items.push(await collectGitWebsiteChange(root, args.commit || "HEAD"));
  }
}
if (kind === "all" || kind === "maintenance") items.push(...await collectMaintenanceLogs(root, { date: args.date || "" }));

const normalized = deduplicateItems(items);
if (!args.push) {
  console.log(JSON.stringify({ mode: "dry-run", count: normalized.length, items: normalized }, null, 2));
  process.exit(0);
}
if (!normalized.length) {
  console.log("没有需要同步的管理员日志。");
  process.exit(0);
}

const secret = process.env.ADMIN_LOG_SYNC_SECRET;
if (!secret) throw new Error("缺少 ADMIN_LOG_SYNC_SECRET，日志未上传；本地 operation 文件已保留。");
const endpoint = `${MESSAGE_CONFIG.apiBaseUrl}/manage-admin-logs`;
let total = 0;
for (let index = 0; index < normalized.length; index += 100) {
  const batch = normalized.slice(index, index + 100);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ items: batch })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `管理员日志同步失败（HTTP ${response.status}）`);
  total += Number(data?.upserted || 0);
}
console.log(`管理员日志同步完成：提交 ${normalized.length} 条，服务端 upsert ${total} 条。`);

function parseArgs(values) {
  return Object.fromEntries(values.filter((value) => value.startsWith("--")).map((value) => {
    const index = value.indexOf("=");
    return index === -1 ? [value.slice(2), true] : [value.slice(2, index), value.slice(index + 1)];
  }));
}

function numberArg(value) {
  const number = Number(value || 0);
  if (!Number.isInteger(number) || number < 0) throw new Error("清理数量必须是非负整数");
  return number;
}
