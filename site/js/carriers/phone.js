// 手机载体（常用于 Android 软件）：竖屏手机。斜切机身 + 刘海缺口，屏幕默认暗，hover / focus 时点亮。
// 作品带真实封面图（cover.kind === 'image'）时，屏幕里显示截图，代替示意界面。
import { shell, pad2 } from './common.js';

export default {
  type: 'phone',
  shapes: { s: [3, 6], m: [3, 7], l: [4, 8] },
  create(work, category, ctx) {
    const { h } = ctx;
    const cover = work.cover && work.cover.kind === 'image' ? work.cover : null;
    const screen = cover
      ? h('div', { class: 'ph-screen has-shot', 'aria-hidden': 'true' },
        h('img', { class: 'ph-shot', src: cover.src, alt: '', width: cover.width, height: cover.height, loading: 'lazy', decoding: 'async' }))
      : h('div', { class: 'ph-screen', 'aria-hidden': 'true' },
        h('div', { class: 'ph-ui' }, h('i', {}), h('i', {}), h('i', {}), h('i', {}), h('div', { class: 'ph-grid' }, h('b', {}), h('b', {}), h('b', {}), h('b', {}))),
        h('span', { class: 'ph-no' }, pad2(ctx.index || 0)));
    return shell(h, 'phone', work, category, ctx, [
      h('i', { class: 'ph-notch', 'aria-hidden': 'true' }),
      screen,
      h('div', { class: 'ph-meta' },
        h('h3', {}, work.name),
        h('p', {}, (work.platform || category.en) + (work.version ? ' · ' + work.version : '')))
    ]);
  }
};
