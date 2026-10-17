// 日报索引读取：封装 portal-data.js 暴露的 globalThis.SpringhuesPortalData，保证“11:00 前不展示”只有一份实现。
// fetch / now / data 以参数注入，Node 可用假对象测试。同一个 manifest 在一轮刷新内只请求一次。
export const CHANNELS = Object.freeze({
  game: { manifest: 'data/index.json', base: 'game/' },
  minsheng: { manifest: 'data/minsheng/index.json', base: 'minsheng/' }
});

export function editionHref(base, edition) {
  return edition ? base + '?date=' + encodeURIComponent(edition.date) : base;
}

export function createArchive({ fetchImpl, now = () => Date.now(), data, timeoutMs = 10000 } = {}) {
  let cache = new Map();
  let lastCheck = 0;
  const getData = () => data || globalThis.SpringhuesPortalData || null;
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { cache: 'no-store', signal: controller.signal, credentials: 'same-origin' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(timer); }
  }

  // 返回 { ok, editions(已发布，新→旧), latest, error }；永不抛出。
  function readManifest(manifest) {
    if (cache.has(manifest)) return cache.get(manifest);
    const p = (async () => {
      const api = getData();
      if (!api || typeof api.publishedEditions !== 'function') {
        console.warn('[archive] portal-data.js 未加载，日报索引按读取失败处理');
        return { ok: false, editions: [], latest: null, error: new Error('portal-data 缺失') };
      }
      try {
        const json = await fetchJson(manifest);
        const editions = api.publishedEditions(json, now());
        return { ok: true, editions, latest: editions[0] || null, error: null };
      } catch (error) {
        console.warn('[archive] 日报索引读取失败', manifest, error && error.message);
        return { ok: false, editions: [], latest: null, error };
      }
    })();
    cache.set(manifest, p);
    return p;
  }

  // 下一轮刷新：丢弃缓存，重新请求
  function reset() { cache = new Map(); lastCheck = now(); }
  function stale(ms = 60000) { return now() - lastCheck > ms; }

  // 把页面里全部 a[data-latest] 的 href 改写成带 ?date= 的最新已发布期次；失败/无期次保持原值。
  async function applyLinks(root = globalThis.document) {
    const results = {};
    await Promise.all(Object.entries(CHANNELS).map(async ([key, ch]) => {
      const r = await readManifest(ch.manifest);
      results[key] = r;
      if (!r.latest || !root) return;
      for (const a of root.querySelectorAll(`a[data-latest="${key}"]`)) a.setAttribute('href', editionHref(ch.base, r.latest));
    }));
    lastCheck = now();
    return results;
  }

  // 近期简报数：两个索引（各只保留最近 7 期）当前已发布期数之和，不是历史累计；任一失败返回 null（页面显示“—”）
  async function totalEditions() {
    const rs = await Promise.all(Object.values(CHANNELS).map(ch => readManifest(ch.manifest)));
    return rs.every(r => r.ok) ? rs.reduce((n, r) => n + r.editions.length, 0) : null;
  }

  return { readManifest, reset, stale, applyLinks, totalEditions };
}
