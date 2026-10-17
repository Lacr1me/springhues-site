import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  collectDailyWebsiteChange,
  collectGitWebsiteChange,
  collectImportedWebsiteChanges,
  collectMaintenanceLogs,
  operationToLog,
  parseDatedMarkdown,
  sanitizeMetadata,
  sanitizeText
} from "./admin-log-lib.mjs";

const root = process.cwd();
const execFileAsync = promisify(execFile);

const sanitized = sanitizeText("C:\\Users\\Admin\\secret.txt token=abc admin@example.com 192.168.1.9 Bearer xyz");
assert(!sanitized.includes("Users\\Admin"));
assert(!sanitized.includes("abc"));
assert(!sanitized.includes("admin@example.com"));
assert(!sanitized.includes("192.168.1.9"));
assert(!sanitized.includes("Bearer xyz"));

const metadata = sanitizeMetadata({
  date: "2026-08-25",
  channels: { game: { issue: 4, published: true, file: "C:\\secret" }, minsheng: { status: "published" } },
  accessToken: "must-not-survive",
  stack: "must-not-survive"
});
assert.deepEqual(metadata.channels.game, { issue: 4, published: true });
assert(!JSON.stringify(metadata).includes("must-not-survive"));

const sections = parseDatedMarkdown("# 日志\n## 2026-08-25｜更新\n- 第一项\n## 当前状态\n- 不得并入\n");
assert.equal(sections.length, 1);
assert.equal(sections[0].title, "2026-08-25｜更新");
assert.equal(sections[0].summary, "• 第一项");

const importFixture = await mkdtemp(path.join(os.tmpdir(), "springhues-admin-log-test-"));
try {
  await mkdir(path.join(importFixture, "docs"));
  await writeFile(path.join(importFixture, "docs", "website-change-history.md"), [
    "# 网站修改总日志",
    "## 2026-08-23｜网站建立", "- 建立网站。",
    "## 2026-08-24｜互动功能", "- 上线留言。",
    "## 2026-08-25｜日报改版", "- 旧摘要。",
    "## 当前状态", "- 不得并入。"
  ].join("\n"), "utf8");
  await writeFile(path.join(importFixture, "docs", "2026-08-25-website-change-log.md"), [
    "# 2026-08-25 网站修改日志",
    "## 今日更新", "- **民生日报界面**：完成动态对齐。",
    "## 验证与发布", "- 构建通过。",
    "## 本地待处理", "- 不得导入。"
  ].join("\n"), "utf8");
  const imported = await collectImportedWebsiteChanges(importFixture);
  assert.equal(imported.length, 3);
  assert(imported.every((item) => item.kind === "website_change" && item.sourceKey === `website_change:${item.metadata.date}`));
  assert(imported.find((item) => item.metadata.date === "2026-08-25").summary.includes("旧摘要"));
  assert(!imported.some((item) => item.summary.includes("不得导入")));
} finally {
  await rm(importFixture, { recursive: true, force: true });
}

const health = operationToLog("2026-08-25-health.json", {
  date: "2026-08-25", checkedAt: "2026-08-25T03:30:00Z", healthy: true, degraded: false,
  channels: { game: { valid: true }, minsheng: { valid: true } }
});
assert.equal(health.status, "success");
assert.equal(health.source, "health_check");
assert.deepEqual(health.metadata.channels, { game: {}, minsheng: {} });

const failedHealth = operationToLog("2026-08-25-health.json", {
  date: "2026-08-25", checkedAt: "2026-08-25T03:30:00Z", healthy: false, reasonCodes: ["DEPLOYMENT_FAILED"]
});
assert.equal(failedHealth.status, "failure");
assert(failedHealth.summary.includes("DEPLOYMENT_FAILED"));

const cleanup = operationToLog("2026-08-25-local-cleanup.json", {
  date: "2026-08-25", occurredAt: "2026-08-25T03:30:00Z", directories: 2, files: 18, status: "success"
});
assert.equal(cleanup.source, "local_cleanup");
assert.equal(cleanup.summary, "已归档 2 个目录、18 个文件。");

const maintenanceFixture = await mkdtemp(path.join(os.tmpdir(), "springhues-maintenance-log-test-"));
try {
  const operationsDirectory = path.join(maintenanceFixture, "artifacts", "operations");
  await mkdir(operationsDirectory, { recursive: true });
  await writeFile(path.join(operationsDirectory, "2026-08-25-health.json"), JSON.stringify({
    date: "2026-08-25",
    checkedAt: "2026-08-25T03:30:00Z",
    healthy: true,
    channels: { game: { valid: true }, minsheng: { valid: true } },
    localPath: `${root}\\private`
  }), "utf8");
  await writeFile(path.join(operationsDirectory, "2026-08-25-run-state.json"), JSON.stringify({
    date: "2026-08-25",
    finishedAt: "2026-08-25T03:35:00Z",
    stage: "published",
    channels: { game: { published: true }, minsheng: { published: true } },
    runs: [{ kind: "correction" }]
  }), "utf8");
  const maintenance = await collectMaintenanceLogs(maintenanceFixture, { date: "2026-08-25" });
  assert(maintenance.some((item) => item.source === "health_check"));
  assert(maintenance.some((item) => item.source === "data_correction"));
  assert(maintenance.every((item) => !JSON.stringify(item.metadata).includes(`${root}\\`)));
} finally {
  await rm(maintenanceFixture, { recursive: true, force: true });
}

const gitItem = await collectGitWebsiteChange(root, "HEAD");
assert.equal(gitItem.kind, "website_change");
assert.equal(gitItem.status, "success");
assert.equal(gitItem.sourceKey, `website_change:${gitItem.metadata.date}`);
assert.match(gitItem.title, /^\d{4}-\d{2}-\d{2}｜/u);
assert(gitItem.summary.startsWith("• "));

const gitFixture = await mkdtemp(path.join(os.tmpdir(), "springhues-daily-git-test-"));
try {
  await git(["init", "--initial-branch=main"]);
  await git(["config", "user.name", "Springhues Test"]);
  await git(["config", "user.email", "test@example.invalid"]);
  await mkdir(path.join(gitFixture, "admin", "messages"), { recursive: true });
  await writeFile(path.join(gitFixture, "admin", "messages", "first.js"), "export const first = true;\n", "utf8");
  await git(["add", "."]);
  await gitCommit("before Beijing midnight", "2026-08-25T15:59:00Z");
  await mkdir(path.join(gitFixture, "minsheng"), { recursive: true });
  await writeFile(path.join(gitFixture, "minsheng", "second.js"), "export const second = true;\n", "utf8");
  await git(["add", "."]);
  await gitCommit("after Beijing midnight", "2026-08-25T16:01:00Z");

  const august25 = await collectDailyWebsiteChange(gitFixture, { date: "2026-08-25" });
  assert.equal(august25.metadata.count, 1);
  assert.deepEqual(august25.metadata.areas, ["管理员与留言"]);
  assert(august25.summary.includes("管理员后台"));
  const august26 = await collectDailyWebsiteChange(gitFixture, { date: "2026-08-26" });
  assert.equal(august26.metadata.count, 1);
  assert.deepEqual(august26.metadata.areas, ["民生日报"]);
  const noChanges = await collectDailyWebsiteChange(gitFixture, { date: "2026-08-24" });
  assert.equal(noChanges.status, "info");
  assert.equal(noChanges.title, "2026-08-24｜网站日志");
  assert.equal(noChanges.summary, "• 当天无修改");
  assert.equal(noChanges.sourceKey, "website_change:2026-08-24");
} finally {
  await rm(gitFixture, { recursive: true, force: true });
}

const migration = await read("supabase/migrations/202608250002_create_admin_logs.sql");
const dailyMigration = await read("supabase/migrations/202608250003_consolidate_daily_website_logs.sql");
const edgeFunction = await read("supabase/functions/manage-admin-logs/index.ts");
const supabaseConfig = await read("supabase/config.toml");
const adminHtml = await read("admin/messages/index.html");
const adminApp = await read("admin/messages/app.js");
const adminClient = await read("admin/messages/client.js");
const workflow = await read(".github/workflows/pages.yml");
const nightlyWorkflow = await read(".github/workflows/admin-log-nightly.yml");
const syncScript = await read("scripts/sync-admin-logs.mjs");

assert(migration.includes("create table public.admin_logs") && migration.includes("enable row level security"));
assert(migration.includes("revoke all on table public.admin_logs from public, anon, authenticated"));
assert(migration.includes("unique check") && migration.includes("on conflict (source_key) do update"));
assert(migration.includes("grant execute on function public.list_admin_logs_internal") && migration.includes("grant execute on function public.upsert_admin_logs_internal"));
assert(dailyMigration.includes("admin_logs_website_change_beijing_day_unique"));
assert(dailyMigration.includes("position > 1") && dailyMigration.includes("website_change:"));
assert(edgeFunction.includes("MESSAGE_ADMIN_USER_IDS") && edgeFunction.includes("ADMIN_LOG_SYNC_SECRET"));
assert(edgeFunction.includes('request.method === "GET"') && edgeFunction.includes('request.method === "POST"'));
assert(edgeFunction.includes("INVALID_SYNC_SECRET") && edgeFunction.includes("upsert_admin_logs_internal"));
assert(edgeFunction.includes('sourceKey !== `website_change:${beijingDate(occurredAt)}`'));
assert(!/sourceKey:\s*item\.source_key/u.test(edgeFunction), "读取接口不得返回内部 source_key");
assert(supabaseConfig.includes("[functions.manage-admin-logs]") && supabaseConfig.includes("verify_jwt = false"));

assert(adminHtml.includes('role="tablist"') && adminHtml.includes('id="websiteChangesPanel"') && adminHtml.includes('id="maintenancePanel"'));
assert(adminHtml.includes('id="websiteChangesTab" class="active"') && adminHtml.includes('data-tab="website">日志</button>'));
assert(adminHtml.includes('data-tab="maintenance">运维</button>') && adminHtml.includes('id="messagesPanel" role="tabpanel" aria-labelledby="messagesTab" hidden'));
assert(adminHtml.includes('id="websiteDateNav"') && adminHtml.includes('id="websiteDateOlder"'));
assert(!adminHtml.includes('id="websiteChangesLoadMore"'), "日志面板不得保留加载更多按钮");
assert(adminApp.includes('activateTab("website"') && adminApp.includes("!messagesLoaded"));
assert(adminApp.includes("createLogCard") && adminApp.includes("content.textContent = JSON.stringify"));
assert(adminApp.includes('if (item.kind === "maintenance") header.append(badge)'));
assert(adminApp.includes('document.createElement("ul")') && adminApp.includes('document.createElement("li")'));
assert(adminApp.includes("WEBSITE_LOG_PAGE_SIZE = 7") && adminApp.includes("showWebsitePage"));
assert(!/\.innerHTML\s*=/u.test(adminApp), "管理员日志必须使用纯文本 DOM 渲染");
assert(adminClient.includes("export class AdminLogsApi") && adminClient.includes("/manage-admin-logs"));
assert(!/新增日志|编辑日志|删除日志/u.test(adminHtml), "日志面板不得提供写操作");

assert(workflow.indexOf("uses: actions/deploy-pages@v4") < workflow.indexOf("Sync deployed website change log"));
assert(workflow.includes("continue-on-error: true") && workflow.includes("secrets.ADMIN_LOG_SYNC_SECRET"));
assert(workflow.includes("fetch-depth: 0"), "部署同步必须读取完整 Git 历史");
assert(nightlyWorkflow.includes('cron: "50 15 * * *"'));
assert(nightlyWorkflow.includes("workflow_dispatch:") && nightlyWorkflow.includes("required: true"));
assert(nightlyWorkflow.includes("date -u +%F") && nightlyWorkflow.includes("--daily-summary"));
assert(nightlyWorkflow.includes("secrets.ADMIN_LOG_SYNC_SECRET") && !nightlyWorkflow.includes("SUPABASE_SERVICE_ROLE_KEY"));
assert(syncScript.includes('args["daily-summary"]') && syncScript.includes("collectDailyWebsiteChange"));

console.log("管理员日志测试通过：私有存储、鉴权接口、幂等同步、敏感字段清理、按需标签页和自动化挂接均有效。");

async function read(file) { return readFile(path.join(root, file), "utf8"); }

async function git(args, options = {}) {
  return execFileAsync("git", args, { cwd: gitFixture, encoding: "utf8", ...options });
}

async function gitCommit(message, date) {
  return git(["commit", "-m", message], {
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
  });
}
