export const MESSAGE_LIMITS = Object.freeze({ nickname: 20, content: 300, reply: 500 });

export function codePointLength(value) { return Array.from(value).length; }
export function normalizeNickname(value) { return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " "); }
export function normalizeContent(value) { return String(value ?? "").normalize("NFKC").replace(/\r\n?/gu, "\n").trim(); }

export function validateMessage(input) {
  const nickname = normalizeNickname(input?.nickname);
  const content = normalizeContent(input?.content);
  if (codePointLength(nickname) < 1 || codePointLength(nickname) > MESSAGE_LIMITS.nickname) {
    return { ok: false, code: "INVALID_NICKNAME", message: "昵称需为 1—20 个字符。" };
  }
  if (codePointLength(content) < 1 || codePointLength(content) > MESSAGE_LIMITS.content) {
    return { ok: false, code: "INVALID_CONTENT", message: "留言需为 1—300 个字符。" };
  }
  return { ok: true, nickname, content };
}

export class MessageApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "MessageApiError";
    this.code = code;
    this.status = status;
  }
}

export class MessageApi {
  constructor(config, fetchImpl) {
    this.config = config;
    this.fetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  }

  endpoint(name) { return `${this.config.apiBaseUrl}/${name}`; }

  async submit(input) {
    const validated = validateMessage(input);
    if (!validated.ok) throw new MessageApiError(validated.code, validated.message, 400);
    const response = await this.fetch(this.endpoint("submit-message"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: validated.nickname,
        content: validated.content,
        turnstileToken: input.turnstileToken,
        website: input.website || ""
      })
    });
    return parseResponse(response);
  }

  async list({ cursor = "", limit = 20 } = {}) {
    const url = new URL(this.endpoint("list-messages"));
    url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 50)));
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await this.fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    const result = await parseResponse(response);
    if (!Array.isArray(result.items)) throw new MessageApiError("INVALID_RESPONSE", "留言服务返回了无效数据。", 502);
    return result;
  }
}

async function parseResponse(response) {
  let data = null;
  try { data = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const error = data?.error || {};
    throw new MessageApiError(error.code || "REQUEST_FAILED", error.message || "请求失败，请稍后重试。", response.status);
  }
  return data || {};
}

let turnstileLoader;
export function loadTurnstile() {
  if (globalThis.turnstile) return Promise.resolve(globalThis.turnstile);
  if (turnstileLoader) return turnstileLoader;
  turnstileLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => globalThis.turnstile ? resolve(globalThis.turnstile) : reject(new Error("Turnstile 未加载。"));
    script.onerror = () => reject(new Error("人机验证服务加载失败。"));
    document.head.append(script);
  });
  return turnstileLoader;
}

class TurnstileGate {
  constructor(container, sitekey) {
    this.container = container;
    this.sitekey = sitekey;
    this.widgetId = null;
    this.pending = null;
  }

  async token() {
    const turnstile = await loadTurnstile();
    if (this.pending) return this.pending.promise;
    let resolveToken;
    let rejectToken;
    const promise = new Promise((resolve, reject) => { resolveToken = resolve; rejectToken = reject; });
    this.pending = { promise, resolve: resolveToken, reject: rejectToken };
    try {
      if (this.widgetId === null) {
        this.widgetId = turnstile.render(this.container, {
          sitekey: this.sitekey,
          size: "invisible",
          execution: "execute",
          action: "submit_message",
          callback: (token) => this.finish(null, token),
          "error-callback": () => this.finish(new Error("人机验证失败，请重试。")),
          "expired-callback": () => this.finish(new Error("验证已过期，请重试。"))
        });
      }
      turnstile.execute(this.widgetId);
    } catch (error) {
      this.pending = null;
      rejectToken(error);
    }
    return promise;
  }

  finish(error, token) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    if (error) pending.reject(error); else pending.resolve(token);
  }

  reset() {
    if (this.widgetId !== null && globalThis.turnstile) globalThis.turnstile.reset(this.widgetId);
  }
}

export function bindMessageForm(form, { config, onSuccess } = {}) {
  const nickname = form.elements.namedItem("nickname");
  const content = form.elements.namedItem("content");
  const website = form.elements.namedItem("website");
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector("[data-message-status]");
  const counter = form.querySelector("[data-message-counter]");
  const turnstileContainer = form.querySelector("[data-turnstile]");
  const configured = /^https:\/\/[^/]+\/functions\/v1$/u.test(config?.apiBaseUrl || "") && Boolean(config?.turnstileSiteKey);
  const api = configured ? new MessageApi(config) : null;
  const gate = configured ? new TurnstileGate(turnstileContainer, config.turnstileSiteKey) : null;

  try { nickname.value = localStorage.getItem("springhues-message-nickname") || ""; } catch { /* storage may be unavailable */ }
  const updateCounter = () => { if (counter) counter.textContent = `${codePointLength(content.value)}/${MESSAGE_LIMITS.content}`; };
  content.addEventListener("input", updateCounter);
  updateCounter();

  if (!configured) {
    button.disabled = true;
    setStatus(status, "留言服务尚未配置。", "error");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!configured || button.disabled) return;
    const validated = validateMessage({ nickname: nickname.value, content: content.value });
    if (!validated.ok) return setStatus(status, validated.message, "error");
    button.disabled = true;
    setStatus(status, "正在进行安全验证…", "loading");
    try {
      const token = await gate.token();
      await api.submit({ ...validated, website: website.value, turnstileToken: token });
      try { localStorage.setItem("springhues-message-nickname", validated.nickname); } catch { /* optional enhancement */ }
      nickname.value = validated.nickname;
      content.value = "";
      updateCounter();
      setStatus(status, "留言已提交，审核通过后会公开显示。", "success");
      onSuccess?.();
    } catch (error) {
      setStatus(status, error?.message || "留言暂时无法提交，请稍后重试。", "error");
    } finally {
      gate.reset();
      button.disabled = false;
    }
  });

  return { configured, api };
}

function setStatus(element, message, state) {
  element.textContent = message;
  element.dataset.state = state;
}

export function formatBeijingTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}
