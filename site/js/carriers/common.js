// 载体共用外壳。h 由调用方注入（浏览器是 createElement 封装，Node 单测是假 h），这里不碰 document / window。
// 结构见 design §5.1：.card-hit 是无后代的覆盖层链接，其余可交互元素只能是它的兄弟。
export function pad2(n) { return String(n).padStart(2, '0'); }

export function shell(h, type, work, category, ctx, inner, extras = []) {
  const hit = h('a', {
    class: 'card-hit', href: '#work=' + work.slug, 'aria-label': work.name + '：查看详情',
    'data-cursor': 'open', 'data-slug': work.slug
  });
  const blade = (category && category.accent && category.accent.blade) || [];
  const face = h('article', { class: 'face', 'data-carrier': type, 'data-surface': (category && category.accent && category.accent.surface) || 'klein-500' },
    h('div', { class: 'face-in' }, ...inner,
      work.isNew && blade.includes('tag') ? h('span', { class: 'tag', 'aria-hidden': 'true' }, 'NEW') : null,
      h('i', { class: 'glare', 'aria-hidden': 'true' }),
      h('i', { class: 'sweep', 'aria-hidden': 'true' })),
    hit,
    ...extras);
  const root = h('li', { class: 'slot', 'data-carrier': type, 'data-slug': work.slug, 'data-category': work.category, 'data-blade': blade.join(' ') }, face);
  return { root, face, hit };
}
export function categoryName(category) { return (category && category.en) || ''; }
