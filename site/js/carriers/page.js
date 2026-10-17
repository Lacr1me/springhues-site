// 日报：书页 / 报纸。左右双页 + 中缝折线，呼应参考图里的书。
// 两个 .card-link 是 .card-hit 的兄弟（z-index 更高），不能放进 .card-hit。
import { shell } from './common.js';

const channelKey = base => (base === 'minsheng/' ? 'minsheng' : base === 'game/' ? 'game' : null);

export default {
  type: 'page',
  shapes: { s: [4, 6], m: [4, 6], l: [4, 6] },
  minCols: 3,
  create(work, category, ctx) {
    const { h } = ctx;
    const base = work.source ? work.source.base : null;
    const key = base ? channelKey(base) : null;
    const channel = work.links.find(l => l.kind === 'channel') || work.links[0];
    const extras = [];
    if (key) extras.push(h('a', { class: 'card-link', 'data-role': 'latest', 'data-latest': key, href: base }, '阅读最新一期'));
    if (channel) extras.push(h('a', { class: 'card-link', 'data-role': 'channel', href: channel.href }, channel.label || '进入频道'));
    return shell(h, 'page', work, category, ctx, [
      h('div', { class: 'pg-spread' },
        h('div', { class: 'pg-left' },
          h('span', { class: 'pg-no' }, 'DAILY NO.—'),
          h('h3', { class: 'pg-name' }, work.name),
          h('span', { class: 'pg-big', 'aria-hidden': 'true' }, 'NO.')),
        h('div', { class: 'pg-right' },
          h('span', { class: 'pg-date' }, '— — —'),
          h('p', { class: 'pg-head' }, work.source ? '正在读取最新一期…' : work.intro),
          h('span', { class: 'pg-state' }, ''),
          h('div', { class: 'pg-lines', 'aria-hidden': 'true' }, h('i', {}), h('i', {}), h('i', {}), h('i', {}))),
        h('i', { class: 'pg-spine', 'aria-hidden': 'true' }))
    ], extras);
  },
  // 日报动态内容回写：{ no, date, headline, state, retry }
  update(face, patch) {
    const set = (sel, text) => { const el = face.querySelector(sel); if (el && text != null) el.textContent = text; };
    if (patch.no != null) { set('.pg-no', 'DAILY NO.' + patch.no); set('.pg-big', 'NO.' + patch.no); }
    if (patch.date != null) set('.pg-date', patch.date);
    if (patch.headline != null) set('.pg-head', patch.headline);
    set('.pg-state', patch.state || '');
  }
};
