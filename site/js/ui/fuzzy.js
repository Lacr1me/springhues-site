// 命令面板的模糊匹配：子序列 + 打分（连续命中、词首命中、名字优先于简介）。纯函数。
function scoreOne(query, text) {
  if (!text) return -1;
  const t = text.toLowerCase();
  let ti = 0, score = 0, streak = 0, first = -1;
  for (const ch of query) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return -1;
    if (first < 0) first = at;
    streak = at === ti && ti > 0 ? streak + 1 : 0;
    score += 1 + streak * 2;
    if (at === 0 || /[\s\-_·/]/.test(t[at - 1])) score += 3;
    ti = at + 1;
  }
  if (t.includes(query)) score += 8;
  return score - first * 0.05;
}

// items: [{ title, hint?, keywords?: string[] , ...}]；返回按分数降序的前 limit 项（稳定）。
export function fuzzyFilter(items, rawQuery, limit = 12) {
  const query = String(rawQuery || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!query) return items.slice(0, limit);
  const scored = [];
  items.forEach((item, index) => {
    const title = scoreOne(query, item.title);
    const hint = scoreOne(query, item.hint);
    const kw = Math.max(-1, ...(item.keywords || []).map(k => scoreOne(query, k)));
    const best = Math.max(title >= 0 ? title * 2 : -1, hint, kw >= 0 ? kw * 0.8 : -1);
    if (best >= 0) scored.push({ item, best, index });
  });
  scored.sort((a, b) => b.best - a.best || a.index - b.index);
  return scored.slice(0, limit).map(s => s.item);
}
