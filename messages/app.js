import { MESSAGE_CONFIG, messageServiceConfigured } from "../message-config.js";
import { bindMessageForm, formatBeijingTime, MessageApi } from "../message-client.js";

const form = document.querySelector("[data-message-form]");
const list = document.querySelector("#messageList");
const state = document.querySelector("#messageState");
const loadMore = document.querySelector("#loadMore");
const api = messageServiceConfigured() ? new MessageApi(MESSAGE_CONFIG) : null;
const renderedItems = new Map();
let nextCursor = null;
let loading = false;

document.querySelector("#beijingDate").textContent = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "long",
  day: "numeric"
}).format(new Date());

bindMessageForm(form, { config: MESSAGE_CONFIG });

async function loadMessages({ reset = false } = {}) {
  if (!api || loading) return;
  loading = true;
  loadMore.disabled = true;
  state.textContent = reset ? "正在读取留言…" : "正在读取更多留言…";
  try {
    const result = await api.list({ cursor: reset ? "" : nextCursor, limit: 20 });
    if (reset) syncMessages(result.items);
    else appendMessages(result.items);
    nextCursor = result.nextCursor;
    updateFeedState();
  } catch (error) {
    state.textContent = error?.message || "留言暂时无法读取，请稍后重试。";
    loadMore.hidden = false;
    loadMore.dataset.mode = reset ? "retry-reset" : "retry-more";
    loadMore.textContent = "重新加载";
  } finally {
    loading = false;
    loadMore.disabled = false;
  }
}

async function refreshVisibleMessages() {
  if (!api || loading || document.hidden) return;
  loading = true;
  const target = Math.max(renderedItems.size, 20);
  const refreshed = [];
  let cursor = "";
  let result = null;
  try {
    do {
      result = await api.list({ cursor, limit: 20 });
      refreshed.push(...result.items);
      cursor = result.nextCursor || "";
    } while (cursor && refreshed.length < target);
    syncMessages(refreshed);
    nextCursor = result?.nextCursor || null;
    updateFeedState();
  } catch {
    // Keep the currently rendered feed during background refresh failures.
  } finally {
    loading = false;
  }
}

function syncMessages(items) {
  const incomingIds = new Set(items.map((item) => item.id));
  for (const [id, article] of renderedItems) {
    if (!incomingIds.has(id)) {
      article.remove();
      renderedItems.delete(id);
    }
  }
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    let article = renderedItems.get(item.id);
    if (!article) {
      article = createMessage(item);
      renderedItems.set(item.id, article);
    } else {
      updateMessage(article, item);
    }
    fragment.append(article);
  }
  list.replaceChildren(fragment);
}

function appendMessages(items) {
  for (const item of items) {
    const existing = renderedItems.get(item.id);
    if (existing) updateMessage(existing, item);
    else {
      const article = createMessage(item);
      renderedItems.set(item.id, article);
      list.append(article);
    }
  }
}

function createMessage(item) {
  const article = document.createElement("article");
  article.className = "message-item";
  article.dataset.messageId = item.id;
  const header = document.createElement("header");
  const nickname = document.createElement("h3");
  nickname.dataset.field = "nickname";
  const time = document.createElement("time");
  time.dataset.field = "approved-at";
  const content = document.createElement("p");
  content.className = "message-content";
  content.dataset.field = "content";
  const reply = document.createElement("section");
  reply.className = "owner-reply";
  reply.dataset.field = "reply";
  const replyHeader = document.createElement("header");
  const replyLabel = document.createElement("strong");
  replyLabel.textContent = "Springhues 回复";
  const replyTime = document.createElement("time");
  replyTime.dataset.field = "replied-at";
  const replyContent = document.createElement("p");
  replyContent.dataset.field = "reply-content";
  replyHeader.append(replyLabel, replyTime);
  reply.append(replyHeader, replyContent);
  header.append(nickname, time);
  article.append(header, content, reply);
  updateMessage(article, item);
  return article;
}

function updateMessage(article, item) {
  article.querySelector('[data-field="nickname"]').textContent = item.nickname;
  const approvedAt = article.querySelector('[data-field="approved-at"]');
  approvedAt.dateTime = item.approvedAt;
  approvedAt.textContent = formatBeijingTime(item.approvedAt);
  article.querySelector('[data-field="content"]').textContent = item.content;
  const reply = article.querySelector('[data-field="reply"]');
  reply.hidden = !item.reply;
  if (item.reply) {
    const repliedAt = article.querySelector('[data-field="replied-at"]');
    repliedAt.dateTime = item.reply.repliedAt;
    repliedAt.textContent = formatBeijingTime(item.reply.repliedAt);
    article.querySelector('[data-field="reply-content"]').textContent = item.reply.content;
  }
}

function updateFeedState() {
  state.textContent = renderedItems.size ? `共显示 ${renderedItems.size} 条已审核留言` : "还没有公开留言，欢迎留下第一句话。";
  loadMore.hidden = !nextCursor;
  loadMore.dataset.mode = "more";
  loadMore.textContent = "加载更多";
}

loadMore.addEventListener("click", () => loadMessages({ reset: loadMore.dataset.mode === "retry-reset" }));

if (api) {
  loadMessages({ reset: true });
  window.setInterval(refreshVisibleMessages, 30_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshVisibleMessages(); });
} else {
  state.textContent = "留言服务正在配置，公开留言将在配置完成后显示。";
  loadMore.hidden = true;
}
