// 面板数字全部来自真实来源：GoatCounter 的每日快照与仓库里的归档清单。
// 快照由 scripts/build-site.mjs 在构建时刷新，避免浏览器跨域取数。
const COUNTER_URL = 'data/scene-stats.json';
// 实时通道：自建转发接口，返回当前计数；不可用时退回本地快照。
const LIVE_URL = 'https://etkjbxfdwmhqmuyzpttq.supabase.co/functions/v1/scene-stats';

function withTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal, credentials: 'omit', cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error('http ' + response.status);
      return response.json();
    })
    .finally(() => clearTimeout(timer));
}

function set(name, value) {
  const node = document.querySelector('[data-stat="' + name + '"]');
  if (node) node.textContent = value;
}

function count(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('zh-CN');
}

function editions(list) {
  if (!list) return [];
  if (Array.isArray(list)) return list;
  return Array.isArray(list.editions) ? list.editions : [];
}

export async function loadStats() {
  const [live, snapshot, game, civic, works] = await Promise.allSettled([
    withTimeout(LIVE_URL, 4000),
    withTimeout(COUNTER_URL, 5000),
    withTimeout('data/index.json', 5000),
    withTimeout('data/minsheng/index.json', 5000),
    withTimeout('site/works.json', 5000)
  ]);

  let hasCounter = false;
  let snapshotAt = '';
  let isLive = false;
  let visitorCount = null;
  const sources = [live, snapshot];
  for (const result of sources) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const data = result.value;
    const visits = data.visits !== undefined ? data.visits : data.count;
    const visitors = data.visitors !== undefined ? data.visitors : data.count_unique;
    if (visits === undefined) continue;
    set('visits', count(visits));
    if (visitors !== undefined) {
      set('visitors', count(visitors));
      const parsed = Number(visitors);
      if (Number.isFinite(parsed)) visitorCount = parsed;
    }
    if (data.updated) snapshotAt = String(data.updated);
    hasCounter = true;
    isLive = result === live;
    break;
  }

  const gameList = game.status === 'fulfilled' ? editions(game.value) : [];
  const civicList = civic.status === 'fulfilled' ? editions(civic.value) : [];
  const total = gameList.length + civicList.length;
  if (total > 0) set('issues', count(total));

  const dates = [...gameList, ...civicList]
    .map((item) => (item && item.date ? String(item.date) : ''))
    .filter(Boolean)
    .sort();
  if (dates.length) set('updated', dates[dates.length - 1]);

  if (works.status === 'fulfilled' && works.value && Array.isArray(works.value.works)) {
    set('works', count(works.value.works.length));
  }

  return { counter: hasCounter, snapshotAt, live: isLive, visitors: visitorCount };
}
