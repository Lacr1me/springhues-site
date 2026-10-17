// 旧首页链接兼容与 hash 解析。纯函数。
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ?view=journal|about|saved|library 与 ?work=slug 映射到新首页位置；无需处理返回 null。
export function legacyRoute(search) {
  if (typeof search !== 'string' || !search || search === '?') return null;
  let params;
  try { params = new URLSearchParams(search); } catch { return null; }
  const view = params.get('view');
  const work = params.get('work');
  if (view === 'journal') return { scroll: 'works', cat: 'daily', work: null };
  if (view === 'about') return { scroll: 'about', cat: null, work: null };
  if (view === 'saved' || view === 'library') return { scroll: 'works', cat: 'all', work: null };
  if (work && work.length <= 64 && SLUG.test(work)) return { scroll: null, cat: null, work };
  if (params.has('work') || params.has('category') || params.has('q') || params.has('saved')) return { scroll: null, cat: null, work: null };
  return null;
}

// 解析 location.hash：#work=slug、#cat=id、其余忽略。
export function parseHash(hash) {
  const m = /^#(work|cat)=([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(hash || '');
  if (!m) return { work: null, cat: null, raw: hash || '' };
  return { work: m[1] === 'work' ? m[2] : null, cat: m[1] === 'cat' ? m[2] : null, raw: hash };
}
// 解析站内锚点：#works | #about | #top（子页面菜单链接 ./#works 等）。不影响 parseHash 的返回形状。
const ANCHORS = new Set(['works', 'about', 'top']);
export function parseAnchor(hash) {
  const m = /^#([a-z]+)$/.exec(hash || '');
  return m && ANCHORS.has(m[1]) ? m[1] : null;
}
