import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MESSAGE_LIMITS as browserLimits, MessageApi, MessageApiError, normalizeContent, normalizeNickname, validateMessage } from "../message-client.js";
import { AdminAuth, AdminLogsApi, AdminMessagesApi } from "../admin/messages/client.js";
import { MESSAGE_LIMITS as serverLimits, validateMessageInput, validateReplyInput } from "../supabase/functions/_shared/validation.js";

const root = process.cwd();
assert.deepEqual(browserLimits, serverLimits, "浏览器与服务端必须使用相同留言长度限制");
assert.equal(normalizeNickname("  小  春  "), "小 春");
assert.equal(normalizeContent("  第一行\r\n第二行  "), "第一行\n第二行");
assert(validateMessage({ nickname: "访客", content: "你好" }).ok);
assert(!validateMessage({ nickname: "", content: "你好" }).ok);
assert(!validateMessage({ nickname: "访客", content: "x".repeat(301) }).ok);
assert(validateMessage({ nickname: "😀", content: "保留 <script>alert(1)</script> 为纯文本" }).ok);
assert(validateMessageInput({ nickname: "访客", content: "正常留言" }).ok);
assert(!validateMessageInput({ nickname: "访客", content: "\u0000" }).ok);
assert.deepEqual(validateReplyInput("  谢谢你的留言  "), { ok: true, reply: "谢谢你的留言" });
assert.deepEqual(validateReplyInput("  "), { ok: true, reply: null });
assert(!validateReplyInput("x".repeat(501)).ok);
assert(!validateReplyInput("回复\u0007").ok);

let submittedRequest;
const submitApi = new MessageApi({ apiBaseUrl: "https://example.supabase.co/functions/v1" }, async (url, options) => {
  submittedRequest = { url, options };
  return jsonResponse(202, { ok: true, status: "pending" });
});
const submitted = await submitApi.submit({ nickname: "  访客  ", content: "  一条留言  ", turnstileToken: "test-token", website: "" });
assert.equal(submitted.status, "pending");
assert.equal(submittedRequest.url, "https://example.supabase.co/functions/v1/submit-message");
assert.deepEqual(JSON.parse(submittedRequest.options.body), { nickname: "访客", content: "一条留言", turnstileToken: "test-token", website: "" });

let listOptions;
const listApi = new MessageApi({ apiBaseUrl: "https://example.supabase.co/functions/v1" }, async (url, options) => {
  listOptions = options;
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(url.searchParams.get("cursor"), "cursor-token");
  return jsonResponse(200, { items: [{ id: "1", nickname: "春", content: "你好", approvedAt: "2026-08-24T11:00:00Z", reply: { content: "欢迎", repliedAt: "2026-08-24T12:00:00Z" } }], nextCursor: null });
});
const listed = await listApi.list({ cursor: "cursor-token", limit: 20 });
assert.equal(listed.items[0].reply.content, "欢迎");
assert.equal(listOptions.cache, "no-store");

const errorApi = new MessageApi({ apiBaseUrl: "https://example.supabase.co/functions/v1" }, async () => jsonResponse(429, { error: { code: "RATE_LIMITED", message: "提交过于频繁" } }));
await assert.rejects(() => errorApi.submit({ nickname: "访客", content: "你好", turnstileToken: "token" }), (error) => error instanceof MessageApiError && error.code === "RATE_LIMITED" && error.status === 429);

const storage = new Map();
globalThis.sessionStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key)
};
const adminCalls = [];
const adminConfig = {
  apiBaseUrl: "https://example.supabase.co/functions/v1",
  supabaseUrl: "https://example.supabase.co",
  supabasePublishableKey: "sb_publishable_test"
};
const adminFetch = async (url, options = {}) => {
  adminCalls.push({ url: String(url), options });
  if (String(url).includes("grant_type=password")) {
    return jsonResponse(200, { access_token: "access", refresh_token: "refresh", expires_in: 3600, user: { id: "admin-id", email: "admin@example.com" } });
  }
  if (options.method === "PATCH") {
    return jsonResponse(200, { item: { id: "message-id", status: "approved", reply: { content: "站方回复", repliedAt: "2026-08-25T00:00:00Z" } } });
  }
  return jsonResponse(200, { items: [], nextCursor: null });
};
const adminAuth = new AdminAuth(adminConfig, adminFetch);
const adminSession = await adminAuth.signIn(" admin@example.com ", "password");
assert.equal(adminSession.user.id, "admin-id");
const adminApi = new AdminMessagesApi(adminConfig, adminAuth);
await adminApi.list({ status: "pending" });
const adminUpdated = await adminApi.update({ id: "message-id", reply: "站方回复" });
assert.equal(adminUpdated.item.reply.content, "站方回复");
const patchCall = adminCalls.find((call) => call.options.method === "PATCH");
assert.equal(patchCall.options.headers["Content-Type"], "application/json");
assert(patchCall.options.headers.Authorization.startsWith("Bearer "));
const logsApi = new AdminLogsApi(adminConfig, adminAuth);
await logsApi.list({ kind: "maintenance", cursor: "log-cursor", limit: 20 });
const logCall = adminCalls.find((call) => call.url.includes("manage-admin-logs"));
assert(logCall.url.includes("kind=maintenance") && logCall.url.includes("cursor=log-cursor"));
assert.equal(logCall.options.cache, "no-store");

const portalHtml = await read("index.html");
const messageHtml = await read("messages/index.html");
const messagesApp = await read("messages/app.js");
const messageCss = await read("site/css/pages-messages.css");
const adminHtml = await read("admin/messages/index.html");
const adminApp = await read("admin/messages/app.js");
const config = await read("message-config.js");
const privacyHtml = await read("privacy/index.html");
const firstMigration = await read("supabase/migrations/202608240001_create_messages.sql");
const replyMigration = await read("supabase/migrations/202608250001_add_message_replies.sql");
const submitFunction = await read("supabase/functions/submit-message/index.ts");
const listFunction = await read("supabase/functions/list-messages/index.ts");
const manageFunction = await read("supabase/functions/manage-messages/index.ts");
const sharedHttp = await read("supabase/functions/_shared/http.js");
const gameHtml = await read("game/index.html");
const minshengHtml = await read("minsheng/index.html");

assert(portalHtml.includes('id="worksWall"'), "首页采用 SHARD 作品墙布局并保留日报入口");
assert(portalHtml.includes('class="quick-message-link"') && portalHtml.includes('href="messages/"') && !portalHtml.includes("data-message-form"), "首页保留独立留言入口，不内嵌留言表单");
assert(!/href=["'](?:\.\/)?admin\//.test(portalHtml), "首页不得公开管理员入口");
assert(messageHtml.includes('id="messageList"') && messageHtml.includes("data-message-counter"), "独立留言页必须包含完整表单与公开列表");
assert(gameHtml.includes('class="header-message-link" href="messages/"') && minshengHtml.includes('class="header-message-link" href="../messages/"'), "两个日报页头必须包含留言入口");
assert(adminHtml.includes('name="robots" content="noindex,nofollow,noarchive"') && adminHtml.includes("Content-Security-Policy"), "管理后台必须禁止索引并设置 CSP");
assert(!/\.innerHTML\s*=/.test(messagesApp + adminApp), "访客与管理员页面不得使用 innerHTML 渲染用户内容");
assert(messagesApp.includes('textContent = item.reply.content') && messagesApp.includes("30_000"), "留言页必须安全渲染回复并每 30 秒同步");
assert(messageCss.includes(".owner-reply"), "留言样式必须包含站长回复区块");
assert(messageHtml.includes("data-turnstile") && messageHtml.includes('class="honeypot"') && messageHtml.includes('name="website"') && messageHtml.includes('maxlength="300"') && messageHtml.includes('maxlength="20"') && messageHtml.includes('id="beijingDate"') && messageHtml.includes("data-message-status"), "留言页必须保留 Turnstile 挂载点、蜜罐、字数上限、日期节点与状态区");
assert(!/href=["'](?:\.\.?\/)?admin\//.test(messageHtml), "留言页不得公开管理员入口");
assert(/\.honeypot\s*\{[^}]*left:\s*-10000px/.test(messageCss) && messageCss.includes(".turnstile-slot") && messageCss.includes('.form-status[data-state="error"]') && /\[hidden\]\s*\{\s*display:\s*none/.test(messageCss), "留言样式必须保留蜜罐离屏、Turnstile 挂载点、状态色与 hidden 规则");
{
  // Turnstile 挂载点不得被样式裁切：含它的容器（表单、留言卡片）不得设置 clip-path / overflow:hidden
  const css = messageCss.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/\.message-compose(?!\s*[:\w-])|\.message-form|\.form-submit-row/.test(m[1]) && !/::before|::after/.test(m[1])) assert(!/clip-path|overflow\s*:\s*hidden/.test(m[2]), "含 Turnstile 的容器不得裁切：" + m[1].trim());
  }
}
assert(!/SERVICE_ROLE|SECRET_KEY|RATE_LIMIT_SECRET/u.test(config), "公开配置不得包含服务端秘密字段");
assert(config.includes("supabasePublishableKey") && config.includes("etkjbxfdwmhqmuyzpttq.supabase.co/functions/v1"), "公开配置必须包含项目地址与 publishable key 槽位");
assert(privacyHtml.includes("Turnstile Privacy Addendum") && privacyHtml.includes("来源哈希"), "Invisible Turnstile 必须配套公开隐私说明");
assert(privacyHtml.includes("springhues.home.theme") && privacyHtml.includes("springhues.home.introAt") && privacyHtml.includes("springhues.home.introSeen") && privacyHtml.includes("不会上传") && !privacyHtml.includes("资源收藏"), "隐私说明须列出首页本地偏好键并说明浏览器本地存储边界");
assert(firstMigration.includes("enable row level security") && firstMigration.includes("revoke all on table public.messages from anon, authenticated"), "留言表必须默认拒绝匿名直连");
assert(replyMigration.includes("owner_reply") && replyMigration.includes("list_messages_for_admin_internal") && replyMigration.includes("update_message_for_admin_internal"), "回复迁移必须包含公开回复与管理员 RPC");
assert(replyMigration.includes("revoke all on function public.list_messages_for_admin_internal") && replyMigration.includes("grant execute on function public.update_message_for_admin_internal"), "管理员 RPC 必须仅授权 service role");
assert(submitFunction.includes("siteverify") && submitFunction.includes("hmacSha256") && submitFunction.includes("TURNSTILE_ALLOWED_HOSTNAMES"), "提交函数必须验证 Turnstile、来源主机和哈希限流键");
assert(listFunction.includes("owner_reply") && !listFunction.includes("submitter_hash"), "公开列表只能增加回复字段，不得返回提交者哈希");
assert(manageFunction.includes("MESSAGE_ADMIN_USER_IDS") && manageFunction.includes("authenticatedUser") && !manageFunction.includes("submitter_hash"), "管理函数必须执行用户与管理员白名单校验且不得返回提交者哈希");
assert(sharedHttp.includes('"authorization, apikey, content-type, x-client-info"'), "CORS 必须允许管理员鉴权请求头");

console.log("留言系统测试通过：回复校验、公开同步、后台会话、管理员授权契约、RLS、Turnstile、限流与纯文本渲染均有效。");

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
async function read(file) { return readFile(path.join(root, file), "utf8"); }
