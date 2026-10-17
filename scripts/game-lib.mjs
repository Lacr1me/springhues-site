import path from "node:path";

export const GAME_SECTION_COUNTS = {
  features: 2,
  news: 10,
  packs: 10,
  mods: 6,
  trends: 4
};

export const GAME_DEAL_LIMITS = { legacyMin: 4, min: 6, staticCaptureCount: 6 };
export const GAME_DEAL_POLICY_EFFECTIVE_DATE = "2026-08-25";
export const GAME_DEAL_COVERAGE_EFFECTIVE_DATE = "2026-08-25";
export const GAME_HEAT_EVIDENCE_EFFECTIVE_DATE = "2026-08-25";

const TEXT_FIELDS = {
  features: ["title", "summary", "source", "date", "image", "url"],
  news: ["title", "summary", "source", "date", "image", "url"],
  packs: ["name", "summary", "category", "source", "image", "url"],
  mods: ["name", "summary", "version", "loader", "date", "source", "url"],
  deals: ["name", "discount", "original", "price", "label", "ends", "image", "url"]
};

export function beijingDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function assertPublishTime(date, now = new Date()) {
  const publishAt = new Date(`${date}T11:00:00+08:00`).getTime();
  if (!Number.isFinite(publishAt) || now.getTime() < publishAt) {
    throw new Error(`${date} 日报不得在北京时间 11:00 前发布`);
  }
}

export function validateGame(brief, { expectedDate } = {}) {
  const errors = [];
  if (!brief || typeof brief !== "object") throw new Error("游戏日报必须是对象");
  if (expectedDate && brief.date !== expectedDate) errors.push(`日期必须为 ${expectedDate}`);
  if (!isDate(brief.date)) errors.push("date 必须为有效的 YYYY-MM-DD");
  if (!Number.isInteger(brief.issue) || brief.issue < 1) errors.push("issue 必须为正整数");
  for (const field of ["cutoff", "dataWindow"]) requireText(brief, field, "日报", errors);
  if (isDate(brief.date)) {
    if (!String(brief.cutoff || "").startsWith(brief.date)) errors.push(`cutoff 必须对应日报日期 ${brief.date}`);
    const previousDate = new Date(`${brief.date}T00:00:00Z`);
    previousDate.setUTCDate(previousDate.getUTCDate() - 1);
    const previousIso = previousDate.toISOString().slice(0, 10);
    if (!String(brief.dataWindow || "").includes(previousIso) || !String(brief.dataWindow || "").includes(brief.date)) {
      errors.push(`dataWindow 必须覆盖 ${previousIso} 至 ${brief.date}`);
    }
  }
  if (!Array.isArray(brief.sources) || brief.sources.length < 3) errors.push("sources 至少需要3项");
  else validateUniqueTextList(brief.sources, "sources", errors);

  for (const [section, count] of Object.entries(GAME_SECTION_COUNTS)) {
    if (!Array.isArray(brief[section]) || brief[section].length !== count) {
      errors.push(`${section} 必须为 ${count} 条`);
    }
  }
  const minimumDeals = brief.date >= GAME_DEAL_POLICY_EFFECTIVE_DATE ? GAME_DEAL_LIMITS.min : GAME_DEAL_LIMITS.legacyMin;
  if (!Array.isArray(brief.deals) || brief.deals.length < minimumDeals) {
    errors.push(`deals 至少需要 ${minimumDeals} 条；网页不得截断已核验的合格优惠`);
  }

  for (const section of ["features", "news", "packs", "mods", "deals"]) {
    const items = Array.isArray(brief[section]) ? brief[section] : [];
    const names = new Set();
    const urls = new Set();
    items.forEach((item, index) => {
      const label = `${section} 第${index + 1}条`;
      for (const field of TEXT_FIELDS[section]) requireText(item, field, label, errors);
      const identity = (item.title || item.name || "").trim();
      if (identity && names.has(identity)) errors.push(`${section} 标题重复：${identity}`);
      names.add(identity);
      if (item.url && urls.has(item.url)) errors.push(`${section} 链接重复：${item.url}`);
      urls.add(item.url);
      if (item.url && !isHttpsUrl(item.url)) errors.push(`${label} 必须使用 HTTPS 原文链接`);
      if (item.image && !isSafeImagePath(item.image)) errors.push(`${label} 图片路径不安全`);
      for (const field of TEXT_FIELDS[section]) {
        if (containsMarkup(item[field])) errors.push(`${label} 的 ${field} 不得包含 HTML 标签`);
      }
    });
  }

  for (const section of ["features", "news"]) {
    (brief[section] || []).forEach((item, index) => validateDatedItem(item, brief.date, 1, `${section} 第${index + 1}条`, errors));
  }
  (brief.mods || []).forEach((item, index) => validateDatedItem(item, brief.date, 30, `mods 第${index + 1}条`, errors));
  (brief.packs || []).forEach((item, index) => {
    if (!Number.isInteger(item.heat) || item.heat < 0 || item.heat > 100) errors.push(`packs 第${index + 1}条 heat 必须为0—100整数`);
    if (brief.date >= GAME_HEAT_EVIDENCE_EFFECTIVE_DATE) {
      requireText(item, "heatEvidenceAt", `packs 第${index + 1}条`, errors);
      requireText(item, "heatSignals", `packs 第${index + 1}条`, errors);
      validateDatedItem({ date: item.heatEvidenceAt }, brief.date, 1, `packs 第${index + 1}条热度证据`, errors);
      if (containsMarkup(item.heatSignals)) errors.push(`packs 第${index + 1}条 heatSignals 不得包含 HTML 标签`);
    }
  });
  (brief.deals || []).forEach((item, index) => {
    const label = `deals 第${index + 1}条`;
    if (brief.date >= GAME_DEAL_POLICY_EFFECTIVE_DATE && !["新史低", "平史低", "今日特惠"].includes(item.label)) {
      errors.push(`${label} label 只能为“新史低”“平史低”或“今日特惠”`);
    }
    if (brief.date >= GAME_DEAL_POLICY_EFFECTIVE_DATE && !steamAppIdFromUrl(item.url)) {
      errors.push(`${label} 必须链接到 Steam 官方 app 商品页`);
    }
    if (!/^-\d{1,3}%$/.test(item.discount || "")) errors.push(`${label} discount 格式无效`);
    if (!/^¥\d/.test(item.original || "") || !/^¥\d/.test(item.price || "")) errors.push(`${label} 价格必须以 ¥ 开头`);
    const match = /^(?:截至\s*)?(\d{2})-(\d{2})$/.exec(item.ends || "");
    if (!match) errors.push(`${label} ends 必须为“截至 MM-DD”`);
    else if (isDate(brief.date)) {
      const end = new Date(`${brief.date.slice(0, 4)}-${match[1]}-${match[2]}T23:59:59+08:00`);
      const edition = new Date(`${brief.date}T00:00:00+08:00`);
      if (Number.isNaN(end.getTime()) || end < edition) errors.push(`${label} 优惠截止时间不得早于日报日期`);
    }
  });
  if (Array.isArray(brief.trends)) validateUniqueTextList(brief.trends, "trends", errors);

  if (errors.length) throw new Error(`游戏日报校验失败：\n- ${errors.join("\n- ")}`);
  return brief;
}

export function safePendingPath(root, date) {
  const pendingDir = path.resolve(root, "data", ".pending");
  const pending = path.resolve(pendingDir, `${date}.json`);
  if (path.dirname(pending) !== pendingDir) throw new Error("拒绝使用非预期草稿路径");
  return { pendingDir, pending };
}

export function steamAppIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "store.steampowered.com") return null;
    return /^\/app\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1] || null;
  } catch {
    return null;
  }
}

function requireText(item, field, label, errors) {
  if (!item?.[field] || typeof item[field] !== "string" || !item[field].trim()) errors.push(`${label} 缺少 ${field}`);
}

function validateUniqueTextList(values, label, errors) {
  const seen = new Set();
  values.forEach((value, index) => {
    if (typeof value !== "string" || !value.trim()) errors.push(`${label} 第${index + 1}项不能为空`);
    else if (seen.has(value.trim())) errors.push(`${label} 不得重复：${value.trim()}`);
    else if (containsMarkup(value)) errors.push(`${label} 第${index + 1}项不得包含 HTML 标签`);
    seen.add(value?.trim());
  });
}

function validateDatedItem(item, editionDate, maxAge, label, errors) {
  if (!isDate(item.date)) return errors.push(`${label} 日期无效`);
  if (!isDate(editionDate)) return;
  const edition = new Date(`${editionDate}T00:00:00+08:00`);
  const published = new Date(`${item.date}T00:00:00+08:00`);
  const age = Math.floor((edition - published) / 86400000);
  if (age < 0 || age > maxAge) errors.push(`${label} 日期必须在日报日期前${maxAge}天内`);
}

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function isHttpsUrl(value) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function isSafeImagePath(value) {
  return /^game-brief-assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value || "");
}

function containsMarkup(value) {
  return typeof value === "string" && /<\/?[a-z][^>]*>/i.test(value);
}
