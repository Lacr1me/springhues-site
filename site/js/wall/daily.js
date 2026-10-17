// 日报卡动态内容：日期 / 期号 / headline / “暂无已发布期次” / “暂时无法读取”+重试 / 回前台 >60s 刷新。
import { h } from '../core/dom.js';

const fmt = d => d.replace(/-/g, '.');

export function bindDaily(cards, archive) {
  const daily = cards.filter(c => c.work.source && typeof c.carrier.update === 'function');
  if (!daily.length) return;
  async function paint(card) {
    const r = await archive.readManifest(card.work.source.manifest);
    const old = card.face.querySelector(':scope > .card-retry');
    if (old) old.remove();
    if (!r.ok) {
      card.carrier.update(card.face, { no: '—', date: '— — —', headline: card.work.source.fallbackTitle, state: '暂时无法读取' });
      const retry = h('button', { class: 'card-retry', type: 'button' }, '重试');
      retry.addEventListener('click', async () => { archive.reset(); await Promise.all(daily.map(paint)); archive.applyLinks(document); });
      card.face.appendChild(retry);
    } else if (!r.latest) {
      card.carrier.update(card.face, { no: '—', date: '— — —', headline: card.work.source.fallbackTitle, state: '暂无已发布期次' });
    } else {
      const e = r.latest;
      card.carrier.update(card.face, { no: e.issue != null ? String(e.issue) : '—', date: fmt(e.date), headline: e.headline || e.title || card.work.source.fallbackTitle, state: e.issue != null ? '第 ' + e.issue + ' 期' : '' });
    }
  }
  Promise.all(daily.map(paint)).then(() => archive.applyLinks(document));
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || !archive.stale(60000)) return;
    archive.reset();
    await Promise.all(daily.map(paint));
    archive.applyLinks(document);
  });
}
