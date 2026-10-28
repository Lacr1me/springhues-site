// Public visitor aggregates only. This module never sends a tracking event.
// count_unique is a legacy alias of count, not a second metric:
// https://www.goatcounter.com/help/visitor-counter
const RAW_COUNTER = 'https://springhues.goatcounter.com/counter/TOTAL.json';
const PUBLIC_PROXY = 'https://etkjbxfdwmhqmuyzpttq.supabase.co/functions/v1/scene-stats';
const SITE = 'https://springhues.com/';
const SNAPSHOT = SITE + 'data/scene-stats.json';
const CACHE_HINT = '公开访客计数最多缓存 4 小时 不代表实时在线人数';
const MAX_CONCURRENT = 4;

/** Accept nonnegative safe integers and the provider's comma-separated strings. */
export function parseCount(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(text)) return null;
  const number = Number(text.replaceAll(',', ''));
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function abortError(signal) {
  return signal?.reason || new DOMException('Statistics request cancelled', 'AbortError');
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

async function requestJSON(url, { signal, fetchImpl, timeoutMs }) {
  if (signal?.aborted) throw abortError(signal);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(abortError(signal));
  signal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Statistics request timed out', 'TimeoutError')), timeoutMs);
  let rejectAborted;
  const aborted = new Promise((_, reject) => {
    rejectAborted = () => reject(abortError(controller.signal));
    controller.signal.addEventListener('abort', rejectAborted, { once: true });
  });
  try {
    const response = Promise.resolve().then(() => fetchImpl(url, {
      method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store',
      referrerPolicy: 'no-referrer', signal: controller.signal,
    })).then(result => {
      if (!result.ok) throw new Error(`Statistics HTTP ${result.status}`);
      return result.json();
    });
    return await Promise.race([response, aborted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
    controller.signal.removeEventListener('abort', rejectAborted);
  }
}

async function boundedRequests(entries, options) {
  const results = Object.create(null);
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      if (options.signal?.aborted) throw abortError(options.signal);
      const [name, url] = entries[cursor++];
      try { results[name] = { ok: true, data: await requestJSON(url, options) }; }
      catch (error) {
        if (options.signal?.aborted) throw abortError(options.signal);
        results[name] = { ok: false };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, entries.length) }, worker));
  return results;
}

function archiveList(result, now) {
  if (!result?.ok) return null;
  const data = result.data;
  const entries = Array.isArray(data) ? data : data?.editions;
  if (!Array.isArray(entries)) return null;
  const normalized = [];
  for (const entry of entries) {
    const date = dateOnly(entry?.date);
    if (!date) return null;
    if (entry.publishAt !== undefined) {
      const publishAt = timestamp(entry.publishAt);
      if (!publishAt) return null;
      if (Date.parse(publishAt) > now) continue;
    }
    normalized.push({ date });
  }
  return normalized;
}

function catalogFrom(results, now) {
  const worksList = results.works?.ok ? results.works.data?.works : null;
  const works = Array.isArray(worksList) && worksList.every(item => item && typeof item.slug === 'string')
    ? worksList.length : null;
  const game = archiveList(results.game, now);
  const civic = archiveList(results.civic, now);
  const complete = game !== null && civic !== null;
  const dates = [...(game || []), ...(civic || [])].map(item => item.date).sort();
  return {
    works, archives: complete ? game.length + civic.length : null,
    latestDate: dates.length ? dates[dates.length - 1] : null,
  };
}

/**
 * One abortable refresh. No polling, storage, cookies, or tracking is performed.
 * Raw counters are fetched once; a failed total falls back to the existing public
 * proxy and then the static snapshot. At most eight GETs and four in flight.
 * `week` / `month` mean the provider's rolling 7 / 30 days, not calendar periods.
 * The counter's date-only bounds are UTC-midnight inclusive, so they cannot be
 * presented as complete local calendar days without additional boundary queries.
 */
export async function loadStats({
  signal, fetchImpl = globalThis.fetch, timeoutMs = 5000, now = () => new Date(),
} = {}) {
  if (signal?.aborted) throw abortError(signal);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is required');
  const startTime = new Date(now()).getTime();
  const options = {
    signal, fetchImpl,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.max(10, Math.min(10000, timeoutMs)) : 5000,
  };
  const results = await boundedRequests([
    ['total', RAW_COUNTER],
    ['week', RAW_COUNTER + '?start=week'],
    ['month', RAW_COUNTER + '?start=month'],
    ['works', SITE + 'site/works.json'],
    ['game', SITE + 'data/index.json'],
    ['civic', SITE + 'data/minsheng/index.json'],
  ], options);

  let visitors = results.total?.ok ? parseCount(results.total.data?.count) : null;
  let status = visitors === null ? 'unavailable' : 'live';
  let source = visitors === null ? null : 'goatcounter';
  let sourceUpdatedAt = null;

  if (visitors === null) {
    for (const [name, url] of [['public-api', PUBLIC_PROXY], ['static-snapshot', SNAPSHOT]]) {
      if (signal?.aborted) throw abortError(signal);
      try {
        const data = await requestJSON(url, options);
        const count = parseCount(data?.visitors);
        if (count === null) continue;
        visitors = count;
        source = name;
        status = name === 'static-snapshot' ? 'snapshot' : 'live';
        // Existing endpoints report their retrieval time, not the last visit.
        sourceUpdatedAt = timestamp(data.updated);
        break;
      } catch (error) {
        if (signal?.aborted) throw abortError(signal);
      }
    }
  }
  if (signal?.aborted) throw abortError(signal);
  const week = results.week?.ok ? parseCount(results.week.data?.count) : null;
  const month = results.month?.ok ? parseCount(results.month.data?.count) : null;
  return {
    status, visitors, source,
    fetchedAt: new Date(now()).toISOString(), sourceUpdatedAt,
    cacheHint: CACHE_HINT,
    periods: source === 'goatcounter' && (week !== null || month !== null)
      ? { week, month } : null,
    trend: null,
    catalog: catalogFrom(results, startTime),
  };
}
