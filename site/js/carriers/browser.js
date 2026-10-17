// 浏览器载体（网页设计）：地址栏 + 抽象网页骨架。颜色、切角、字号都沿用其它卡片。
import { shell } from './common.js';

export default {
  type: 'browser',
  shapes: { s: [3, 3], m: [4, 4], l: [5, 3] },
  create(work, category, ctx) {
    const { h } = ctx;
    return shell(h, 'browser', work, category, ctx, [
      h('i', { class: 'dots', 'aria-hidden': 'true' }),
      h('div', { class: 'br-bar', 'aria-hidden': 'true' },
        h('span', { class: 'br-favicon' }),
        h('span', { class: 'br-cat' }, category.en),
        h('span', { class: 'br-url' }, 'works/' + work.slug + '/'),
        h('span', { class: 'br-ticks' }, h('i', {}), h('i', {}), h('i', {}))),
      h('div', { class: 'br-view', 'aria-hidden': 'true' },
        h('i', { class: 'br-hero' }),
        h('span', { class: 'br-cols' }, h('b', {}), h('b', {}), h('b', {})),
        h('i', { class: 'br-line' }),
        h('i', { class: 'br-line short' })),
      h('div', { class: 'sd-meta' },
        h('h3', {}, work.name),
        h('p', {}, work.intro),
        work.version ? h('span', { class: 'sd-ver' }, work.version) : null)
    ]);
  }
};
