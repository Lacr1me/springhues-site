// 作品数据校验与归一化。纯函数：顶层不碰 window/document，Node 可直接测试。
// 签名只增不改；破坏性改动请改文件名（模块没有版本戳，见 scripts/test-home.mjs 头注释）。
export class WorksDataError extends Error {
  constructor(message) { super(message); this.name = 'WorksDataError'; }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SURFACES = ['klein-500', 'klein-700', 'klein-900', 'white'];
const BLADES = ['tag', 'outline', 'sweep', 'button'];
const KINDS = ['download', 'visit', 'source', 'channel'];
const SIZES = ['s', 'm', 'l'];
const SOURCES = [['data/index.json', 'game/'], ['data/minsheng/index.json', 'minsheng/']];
// 提示词只允许放在作品自己的目录里，避免读到任意本地文件。
const PROMPT_SRC = /^works\/[a-z0-9-]+\/[A-Za-z0-9._-]+\.txt$/;
const warn = (...args) => { try { console.warn('[works]', ...args); } catch { /* 无控制台时忽略 */ } };

const isStr = v => typeof v === 'string';
const clip = (v, n) => v.length > n ? v.slice(0, n) : v;

export function isRealDate(v) {
  if (!isStr(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// 链接 href 校验。返回规范化后的字符串，非法返回 null。
export function safeHref(href) {
  if (!isStr(href) || !href || href.length > 300 || /[\s\u0000-\u001f\u007f\\]/.test(href)) return null;
  if (href === '#') return '#';
  if (href.startsWith('/')) return null;
  const adminFirst = p => String(p).split('/').filter(Boolean)[0]?.toLowerCase() === 'admin';
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    let url;
    try { url = new URL(href); } catch { return null; }
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null;
    if (['springhues.com', 'www.springhues.com'].includes(url.hostname.toLowerCase()) && adminFirst(url.pathname)) return null;
    return url.href;
  }
  if (!/^(?:\.\/)?[A-Za-z0-9][A-Za-z0-9._~/%-]*(?:\?[A-Za-z0-9._~=&%-]*)?(?:#[A-Za-z0-9._~=&%-]*)?$/.test(href)) return null;
  const pathPart = href.split(/[?#]/)[0].replace(/^\.\//, '');
  let decoded;
  try { decoded = decodeURIComponent(pathPart); } catch { return null; }
  if (decoded.split('/').includes('..')) return null;
  if (adminFirst(decoded)) return null;
  return href;
}

export function safeAssetSrc(src) {
  if (!isStr(src) || !/^assets\/[A-Za-z0-9._/-]+$/.test(src)) return null;
  return src.split('/').some(seg => seg === '' || seg === '..') ? null : src;
}

function normalizeCategory(raw, seen) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isStr(raw.id) || raw.id.length > 32 || !SLUG.test(raw.id) || seen.has(raw.id)) { warn('丢弃分类', raw && raw.id); return null; }
  if (!isStr(raw.name) || !raw.name || !isStr(raw.en) || !raw.en) { warn('丢弃分类（缺名称）', raw.id); return null; }
  const accent = raw.accent && typeof raw.accent === 'object' ? raw.accent : {};
  const blade = Array.isArray(accent.blade) ? [...new Set(accent.blade.filter(b => BLADES.includes(b)))] : [];
  const parallax = Number.isFinite(raw.parallax) ? Math.min(1.6, Math.max(0, raw.parallax)) : 1;
  seen.add(raw.id);
  return {
    id: raw.id,
    name: clip(raw.name, 16),
    en: clip(raw.en, 24),
    carrier: isStr(raw.carrier) && SLUG.test(raw.carrier) ? raw.carrier : 'shard',
    accent: { surface: SURFACES.includes(accent.surface) ? accent.surface : 'klein-500', blade },
    parallax,
    order: Number.isFinite(raw.order) ? raw.order : 1000
  };
}

function normalizeCover(raw) {
  const placeholder = label => ({ kind: 'placeholder', label: clip(isStr(label) ? label : '', 24) });
  if (!raw || typeof raw !== 'object') return placeholder('');
  if (raw.kind === 'image') {
    const src = safeAssetSrc(raw.src);
    if (src && isStr(raw.alt) && raw.alt && raw.alt.length <= 80 && Number.isInteger(raw.width) && raw.width > 0 && Number.isInteger(raw.height) && raw.height > 0) {
      return { kind: 'image', src, alt: raw.alt, width: raw.width, height: raw.height };
    }
    return placeholder('');
  }
  return placeholder(raw.label);
}

function normalizeWork(raw, cats, slugs) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isStr(raw.slug) || raw.slug.length > 64 || !SLUG.test(raw.slug) || slugs.has(raw.slug)) { warn('丢弃作品', raw.slug); return null; }
  if (!isStr(raw.name) || !raw.name || !isStr(raw.intro) || !raw.intro) { warn('丢弃作品（缺名称或简介）', raw.slug); return null; }
  if (!isStr(raw.category)) { warn('丢弃作品（缺分类）', raw.slug); return null; }
  if (!cats.has(raw.category)) {
    if (!SLUG.test(raw.category)) { warn('丢弃作品（分类 id 非法）', raw.slug); return null; }
    cats.set(raw.category, { id: raw.category, name: raw.category, en: raw.category.toUpperCase(), carrier: 'shard', accent: { surface: 'klein-500', blade: [] }, parallax: 1, order: 1000, synthetic: true });
    warn('作品使用了未登记的分类，已合成', raw.category);
  }
  const links = [];
  for (const l of (Array.isArray(raw.links) ? raw.links : []).slice(0, 6)) {
    const href = l && safeHref(l.href);
    if (!l || !isStr(l.label) || !l.label || href === null) { warn('丢弃链接', raw.slug); continue; }
    links.push({ kind: KINDS.includes(l.kind) ? l.kind : 'visit', label: clip(l.label, 24), href });
  }
  const shots = (Array.isArray(raw.shots) ? raw.shots : []).slice(0, 6).filter(s => s && typeof s === 'object').map(s => {
    const out = { label: clip(isStr(s.label) ? s.label : '', 24), ratio: isStr(s.ratio) && /^\d{1,3}\/\d{1,3}$/.test(s.ratio) ? s.ratio : '16/9' };
    const src = safeAssetSrc(s.src);
    if (src) out.src = src;
    return out;
  });
  let source = null;
  if (raw.source && raw.source.type === 'daily-archive' && SOURCES.some(([m, b]) => m === raw.source.manifest && b === raw.source.base)) {
    source = { type: 'daily-archive', manifest: raw.source.manifest, base: raw.source.base, fallbackTitle: isStr(raw.source.fallbackTitle) ? clip(raw.source.fallbackTitle, 60) : raw.name };
  } else if (raw.source) warn('丢弃日报 source', raw.slug);
  const work = {
    slug: raw.slug,
    category: raw.category,
    name: clip(raw.name, 60),
    intro: clip(raw.intro, 120),
    details: (Array.isArray(raw.details) ? raw.details : []).slice(0, 14)
      .filter(d => d && typeof d === 'object' && isStr(d.p) && d.p)
      .map(d => ({ h: isStr(d.h) ? clip(d.h, 28) : '', p: clip(d.p, 600) })),
    tags: (Array.isArray(raw.tags) ? raw.tags : []).filter(isStr).slice(0, 8).map(t => clip(t, 16)),
    isNew: raw.isNew === true,
    links,
    cover: normalizeCover(raw.cover),
    shots,
    layout: SIZES.includes(raw.layout && raw.layout.size) ? { size: raw.layout.size } : {},
    source
  };
  if (isStr(raw.version)) work.version = clip(raw.version, 40);
  if (isRealDate(raw.updatedAt)) work.updatedAt = raw.updatedAt;
  if (isStr(raw.prompt) && PROMPT_SRC.test(raw.prompt)) work.prompt = raw.prompt;
  else if (raw.prompt) warn('丢弃提示词路径', raw.slug);
  if (isStr(raw.carrier) && SLUG.test(raw.carrier)) work.carrier = raw.carrier;
  if (isStr(raw.platform) && raw.platform) work.platform = clip(raw.platform, 16);
  if (isStr(raw.model) && raw.model) work.model = clip(raw.model, 40);
  slugs.add(raw.slug);
  return work;
}

// 返回 { categories（已按 order 排序，含合成分类）, works }。整体结构错误时抛 WorksDataError。
export function parseWorks(payload) {
  if (!payload || payload.schemaVersion !== 1) throw new WorksDataError('作品清单版本不受支持');
  if (!Array.isArray(payload.categories) || !Array.isArray(payload.works)) throw new WorksDataError('作品清单格式不正确');
  if (payload.works.length > 200 || payload.categories.length > 24) throw new WorksDataError('作品清单过大');
  const seen = new Set();
  const cats = new Map();
  for (const raw of payload.categories) {
    const c = normalizeCategory(raw, seen);
    if (c) cats.set(c.id, c);
  }
  const slugs = new Set();
  const works = [];
  for (const raw of payload.works) {
    const w = normalizeWork(raw, cats, slugs);
    if (w) works.push(w);
  }
  const categories = [...cats.values()].sort((a, b) => a.order - b.order);
  return { categories, works };
}
