import path from "node:path";
import { SOURCE_REGISTRY, canonicalSourceId, requiredSourceIds } from "./source-registry.mjs";

export const CATEGORY_COUNTS = { domestic: 10, international: 10, tech: 10, ai: 5 };
export const REQUIRED_METRIC_KINDS = ["gold", "domestic_oil", "international_oil", "usd_cny", "eur_cny", "jpy_cny"];
export const SOURCE_POLICY_VERSION = 2;
export const SOURCE_POLICY_EFFECTIVE_DATE = "2026-08-25";
export const EXTERNAL_SOURCE_MARKER = "（来自于外网）";

const CHINA_NEWS_DOMAINS = [
  "news.cn", "xinhuanet.com", "people.com.cn", "cctv.com", "cctv.cn",
  "chinanews.com.cn", "cnr.cn", "gmw.cn", "ce.cn", "china.com.cn",
  "chinadaily.com.cn", "cri.cn", "youth.cn", "stdaily.com", "sciencenet.cn"
];
const CHINA_DATA_DOMAINS = [
  ...CHINA_NEWS_DOMAINS,
  "sge.com.cn", "ndrc.gov.cn", "chinamoney.com.cn", "pbc.gov.cn", "safe.gov.cn",
  "sse.com.cn", "szse.cn", "ine.cn", "shfe.com.cn", "csindex.com.cn",
  "cnfin.com", "cs.com.cn", "cnstock.com", "stcn.com", "yicai.com", "cls.cn"
];
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
    throw new Error(`${date} 民生日报不得在北京时间 11:00 前发布`);
  }
}

export function assertMinshengProductionTime(brief) {
  if (!brief.backfilledAt) {
    if (!brief.productionTime?.startsWith(brief.date)) throw new Error(`productionTime 必须对应日报日期 ${brief.date}`);
    return;
  }
  const time = Date.parse(brief.backfilledAt);
  if (!Number.isFinite(time) || time <= Date.parse(`${brief.date}T11:00:00+08:00`) || time > Date.now() + 60_000) {
    throw new Error('backfilledAt 必须是原定发布时刻之后的真实补刊时间');
  }
  // Published legacy editions used backfilledAt as an archive timestamp.
  // Preserve their original same-day production field; new backfills use the contract below.
  if (time < Date.parse('2026-09-26T00:00:00+08:00') && brief.productionTime?.startsWith(brief.date)) return;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(time)).map(part => [part.type, part.value]));
  const expected = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}（北京时间）`;
  if (brief.productionTime !== expected) throw new Error(`productionTime 必须对应真实补刊时间 ${expected}`);
}

export function normalizeMinsheng(brief) {
  for (const [category, count] of Object.entries(CATEGORY_COUNTS)) {
    if (!Array.isArray(brief.sections?.[category])) continue;
    brief.sections[category] = brief.sections[category].slice(0, count).map((story, index) => ({
      id: `${category}-${String(index + 1).padStart(2, "0")}`,
      ...story
    }));
  }
  if (Array.isArray(brief.topStories)) {
    brief.topStoryIds = brief.topStories.map(({ category, position }) => `${category}-${String(position).padStart(2, "0")}`);
    delete brief.topStories;
  }
  return brief;
}

export function validateMinsheng(brief, { expectedDate } = {}) {
  const errors = [];
  if (!brief || typeof brief !== "object") throw new Error("日报必须是对象");
  if (expectedDate && brief.date !== expectedDate) errors.push(`日期必须为 ${expectedDate}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(brief.date || "")) errors.push("date 必须为 YYYY-MM-DD");
  if (!Number.isInteger(brief.issue) || brief.issue < 1) errors.push("issue 必须为正整数");
  const sourcePolicyRequired = /^\d{4}-\d{2}-\d{2}$/.test(brief.date || "") && brief.date >= SOURCE_POLICY_EFFECTIVE_DATE;
  const sourcePolicyV2 = brief.sourcePolicyVersion === SOURCE_POLICY_VERSION;
  if (sourcePolicyRequired && !sourcePolicyV2) errors.push(`从 ${SOURCE_POLICY_EFFECTIVE_DATE} 起 sourcePolicyVersion 必须为 ${SOURCE_POLICY_VERSION}`);
  if (brief.sourcePolicyVersion !== undefined && !sourcePolicyV2) errors.push(`不支持的 sourcePolicyVersion：${brief.sourcePolicyVersion}`);
  for (const field of ["weekday", "lunarDate", "cutoff", "productionTime", "metricsCutoff", "observation"]) {
    if (!brief[field] || typeof brief[field] !== "string") errors.push(`${field} 不能为空`);
  }
  for (const field of ["cutoff", "productionTime", "metricsCutoff"]) {
    if (brief[field] && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}（北京时间）$/.test(brief[field])) errors.push(`${field} 必须为 YYYY-MM-DD HH:mm（北京时间）`);
  }
  for (const field of ["cutoff"]) {
    if (brief[field] && brief.date && !brief[field].startsWith(brief.date)) errors.push(`${field} 必须对应日报日期 ${brief.date}`);
  }
  try { assertMinshengProductionTime(brief); } catch (error) { errors.push(error.message); }
  const editionDate = parseDate(brief.date);
  const metricsDate = parseDate((brief.metricsCutoff || "").slice(0, 10));
  if (editionDate && metricsDate) {
    const metricsAge = Math.floor((editionDate - metricsDate) / 86400000);
    if (metricsAge < 0 || metricsAge > 7) errors.push("metricsCutoff 必须是日报日期当天或此前7天内的最近有效行情日");
  }
  const observationLength = [...(brief.observation || "")].length;
  if (observationLength < 120 || observationLength > 220) errors.push(`今日观察必须为120—220字，当前${observationLength}字`);

  const ids = new Set();
  const titles = new Set();
  for (const [category, expectedCount] of Object.entries(CATEGORY_COUNTS)) {
    const stories = brief.sections?.[category];
    if (!Array.isArray(stories) || stories.length !== expectedCount) {
      errors.push(`${category} 必须为 ${expectedCount} 条`);
      continue;
    }
    stories.forEach((story, index) => {
      const prefix = `${category}-${String(index + 1).padStart(2, "0")}`;
      if (story.id !== prefix) errors.push(`${category} 第${index + 1}条 ID 应为 ${prefix}`);
      if (ids.has(story.id)) errors.push(`重复 ID：${story.id}`);
      ids.add(story.id);
      if (!story.title?.trim()) errors.push(`${prefix} 缺少标题`);
      if (titles.has(story.title?.trim())) errors.push(`重复标题：${story.title}`);
      titles.add(story.title?.trim());
      const summaryLength = [...(story.summary || "")].length;
      if (summaryLength < 40 || summaryLength > 90) errors.push(`${prefix} 摘要必须为40—90字，当前${summaryLength}字`);
      if (!story.source?.trim()) errors.push(`${prefix} 缺少来源`);
      if (!/^https:\/\//.test(story.url || "")) errors.push(`${prefix} 必须使用 HTTPS 原文链接`);
      if (sourcePolicyV2) validateStorySource(story, category, prefix, errors);
      if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(story.publishedAt || "")) errors.push(`${prefix} 发布时间格式无效`);
      const publishedDate = parseDate((story.publishedAt || "").slice(0, 10));
      if (!publishedDate) errors.push(`${prefix} 发布时间无效`);
      if (editionDate && publishedDate) {
        const age = Math.floor((editionDate - publishedDate) / 86400000);
        if (age < 0 || age > 7) errors.push(`${prefix} 发布时间必须在日报日期前7天内`);
      }
    });
  }

  if (!Array.isArray(brief.topStoryIds) || brief.topStoryIds.length !== 3) errors.push("topStoryIds 必须引用3条正文");
  else {
    if (new Set(brief.topStoryIds).size !== 3) errors.push("今日3件大事不能重复");
    brief.topStoryIds.forEach((id) => { if (!ids.has(id)) errors.push(`头条引用不存在：${id}`); });
  }

  if (!Array.isArray(brief.metrics) || brief.metrics.length < 6) errors.push("数据速览至少需要6项");
  const metricKinds = new Set((brief.metrics || []).map((metric) => metric.kind));
  REQUIRED_METRIC_KINDS.forEach((kind) => { if (!metricKinds.has(kind)) errors.push(`缺少数据指标：${kind}`); });
  (brief.metrics || []).forEach((metric, index) => {
    for (const field of ["kind", "icon", "name", "value", "note"]) if (!metric[field]?.trim()) errors.push(`第${index + 1}个指标缺少 ${field}`);
    if (sourcePolicyV2) validateMetricSource(metric, index, errors);
    if (!/(\d{4}-\d{2}-\d{2}|\d{1,2}月\d{1,2}日)/.test(metric.note || "")) errors.push(`第${index + 1}个指标必须标注数据日期`);
    if (metric.kind === "gold" && !/元\/克/.test(metric.value || "")) errors.push("国内金价必须标注元/克");
    if (metric.kind === "domestic_oil" && !/元\/升/.test(metric.value || "")) errors.push("中国油价必须标注元/升");
    if (metric.kind.startsWith("international_oil") && !/美元\/桶/.test(metric.value || "")) errors.push("国际油价必须标注美元/桶");
    if (["usd_cny", "eur_cny", "jpy_cny"].includes(metric.kind) && !/人民币/.test(metric.value || "")) errors.push(`${metric.kind} 必须写明兑人民币`);
  });
  if (!Array.isArray(brief.sources) || brief.sources.length < 3) errors.push("sources 至少需要3项");
  if (!Array.isArray(brief.metricSources) || brief.metricSources.length < 2) errors.push("metricSources 至少需要2项");
  if (sourcePolicyV2) {
    validateSourceSummary(brief.sources, "sources", errors);
    validateSourceSummary(brief.metricSources, "metricSources", errors);
    const metricSourceSet = new Set(brief.metricSources || []);
    for (const metric of brief.metrics || []) {
      if (metric.source?.trim() && !metricSourceSet.has(metric.source.trim())) {
        errors.push(`metricSources 缺少指标来源：${metric.source.trim()}`);
      }
    }
  }
  if (errors.length) throw new Error(`民生日报校验失败：\n- ${errors.join("\n- ")}`);
  return brief;
}

export function validateMinshengSourceAudit(brief, audit) {
  if (brief.sourcePolicyVersion !== SOURCE_POLICY_VERSION) return audit;
  const errors = [];
  if (!audit || typeof audit !== "object") throw new Error("来源审计必须是对象");
  if (audit.date !== brief.date) errors.push(`来源审计日期必须为 ${brief.date}`);
  if (audit.sourcePolicyVersion !== SOURCE_POLICY_VERSION) errors.push(`来源审计 sourcePolicyVersion 必须为 ${SOURCE_POLICY_VERSION}`);
  for (const [category, target] of Object.entries(CATEGORY_COUNTS)) {
    const stories = brief.sections?.[category] || [];
    const actualChina = stories.filter((story) => story.sourceOrigin === "china").length;
    const actualExternal = stories.filter((story) => story.sourceOrigin === "external").length;
    const requiredSources = requiredSourceIds("minsheng", category);
    validateAuditEntry(audit.categories?.[category], category, target, actualChina, actualExternal, requiredSources, errors);
  }
  const metrics = brief.metrics || [];
  const metricChina = metrics.filter((metric) => metric.sourceOrigin === "china").length;
  const metricExternal = metrics.filter((metric) => metric.sourceOrigin === "external").length;
  validateAuditEntry(
    audit.metrics,
    "metrics",
    metrics.length,
    metricChina,
    metricExternal,
    requiredSourceIds("minsheng", "metrics"),
    errors
  );
  if (errors.length) throw new Error(`民生日报来源审计失败：\n- ${errors.join("\n- ")}`);
  return audit;
}

export function safePendingPath(root, date) {
  const pendingDir = path.resolve(root, "data", ".pending", "minsheng");
  const pending = path.resolve(pendingDir, `${date}.json`);
  if (path.dirname(pending) !== pendingDir) throw new Error("拒绝使用非预期草稿路径");
  return { pendingDir, pending };
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const date = new Date(`${value}T00:00:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validateStorySource(story, category, prefix, errors) {
  validateSourceOrigin(story, prefix, errors);
  if (story.source?.includes(EXTERNAL_SOURCE_MARKER)) errors.push(`${prefix} source 不得手写外网标记，由页面统一生成`);
  const hostname = httpsHostname(story.url);
  if (!hostname) return;
  const domesticGovernmentSource = category === "domestic" && isGovernmentDomain(hostname);
  const domesticMediaSource = matchesDomain(hostname, CHINA_NEWS_DOMAINS);
  const isChinaSource = domesticGovernmentSource || domesticMediaSource;
  if (story.sourceOrigin === "china" && !isChinaSource) {
    errors.push(`${prefix} 标记为国内来源，但主链接不是已批准的国内权威媒体或政府新闻页：${hostname}`);
  }
  if (story.sourceOrigin === "external" && isChinaSource) {
    errors.push(`${prefix} 的主链接属于国内权威来源，不应标记为外网：${hostname}`);
  }
}

function validateMetricSource(metric, index, errors) {
  const label = `第${index + 1}个指标`;
  for (const field of ["source", "sourceUrl"]) {
    if (!metric[field]?.trim()) errors.push(`${label}缺少 ${field}`);
  }
  validateSourceOrigin(metric, label, errors);
  if (metric.source?.includes(EXTERNAL_SOURCE_MARKER)) errors.push(`${label} source 不得手写外网标记，由页面统一生成`);
  if (metric.source && metric.note?.includes(metric.source)) errors.push(`${label} note 不得重复来源名称，来源由页面统一追加`);
  const hostname = httpsHostname(metric.sourceUrl);
  if (!hostname) {
    if (metric.sourceUrl) errors.push(`${label} sourceUrl 必须使用有效的 HTTPS 链接`);
    return;
  }
  const isChinaSource = matchesDomain(hostname, CHINA_DATA_DOMAINS) || isGovernmentDomain(hostname);
  if (metric.sourceOrigin === "china" && !isChinaSource) {
    errors.push(`${label}标记为国内数据来源，但链接不在国内官方或权威财经来源范围：${hostname}`);
  }
  if (metric.sourceOrigin === "external" && isChinaSource) {
    errors.push(`${label}链接属于国内数据来源，不应标记为外网：${hostname}`);
  }
}

function validateSourceOrigin(item, label, errors) {
  if (!["china", "external"].includes(item.sourceOrigin)) errors.push(`${label} sourceOrigin 必须为 china 或 external`);
}

function validateSourceSummary(values, label, errors) {
  if (!Array.isArray(values)) return;
  const normalized = values.map((value) => typeof value === "string" ? value.trim() : "");
  if (normalized.some((value) => !value)) errors.push(`${label} 必须全部为非空字符串`);
  if (normalized.some((value) => value.includes(EXTERNAL_SOURCE_MARKER))) errors.push(`${label} 不得手写外网标记，由页面统一生成`);
  if (new Set(normalized).size !== normalized.length) errors.push(`${label} 不得包含重复来源`);
}

function httpsHostname(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.hostname.toLowerCase().replace(/\.$/, "") : "";
  } catch {
    return "";
  }
}

function isGovernmentDomain(hostname) {
  return hostname === "gov.cn" || hostname.endsWith(".gov.cn");
}

function matchesDomain(hostname, domains) {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function validateAuditEntry(entry, label, target, actualChina, actualExternal, requiredSources, errors) {
  if (!entry || typeof entry !== "object") {
    errors.push(`来源审计缺少 ${label}`);
    return;
  }
  const attempted = Array.isArray(entry.attemptedChinaSources)
    ? entry.attemptedChinaSources.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())
    : [];
  const attemptedIds = new Set(attempted.map(canonicalSourceId).filter(Boolean));
  const unknownSources = attempted.filter((source) => !canonicalSourceId(source));
  if (unknownSources.length) errors.push(`${label} 包含来源注册表无法识别的名称：${unknownSources.join("、")}`);
  for (const sourceId of requiredSources) {
    if (!attemptedIds.has(sourceId)) errors.push(`${label} 未记录尝试国内来源：${SOURCE_REGISTRY.sources[sourceId].label}`);
  }
  for (const field of ["usableChinaCandidates", "rejectedChinaCandidates", "finalChinaCount", "finalExternalCount"]) {
    if (!Number.isInteger(entry[field]) || entry[field] < 0) errors.push(`${label} ${field} 必须为非负整数`);
  }
  if (entry.finalChinaCount !== actualChina) errors.push(`${label} finalChinaCount 应为 ${actualChina}`);
  if (entry.finalExternalCount !== actualExternal) errors.push(`${label} finalExternalCount 应为 ${actualExternal}`);
  if (actualChina + actualExternal !== target) errors.push(`${label} 最终来源数量必须为 ${target}`);
  if (Number.isInteger(entry.usableChinaCandidates) && entry.usableChinaCandidates < actualChina) {
    errors.push(`${label} 可用国内候选数不能少于最终采用数 ${actualChina}`);
  }
  if (actualExternal > 0 && entry.usableChinaCandidates !== actualChina) {
    errors.push(`${label} 尚有未采用的国内可用候选，不得使用外网补足`);
  }
  const reasons = Array.isArray(entry.rejectionReasons)
    ? entry.rejectionReasons.filter((value) => typeof value === "string" && value.trim())
    : [];
  if (entry.rejectedChinaCandidates > 0 && !reasons.length) errors.push(`${label} 有被淘汰的国内候选时必须记录原因`);
  if (actualExternal > 0 && !(typeof entry.shortageReason === "string" && entry.shortageReason.trim())) {
    errors.push(`${label} 使用外网补足时必须记录 shortageReason`);
  }
}
