// 通用碎片卡：切角多边形 + 半色调点阵 + 胶带分类标签。未注册载体的兜底。
import { shell } from './common.js';

export default {
  type: 'shard',
  shapes: { s: [3, 3], m: [4, 4], l: [5, 3] },
  create(work, category, ctx) {
    const { h } = ctx;
    return shell(h, 'shard', work, category, ctx, [
      h('i', { class: 'dots', 'aria-hidden': 'true' }),
      h('span', { class: 'sd-cat', 'aria-hidden': 'true' }, category.en + (work.platform && work.platform.toUpperCase() !== category.en ? ' · ' + work.platform.toUpperCase() : '')),
      h('div', { class: 'sd-meta' },
        h('h3', {}, work.name),
        h('p', {}, work.intro),
        work.version ? h('span', { class: 'sd-ver' }, work.version) : null)
    ]);
  }
};
