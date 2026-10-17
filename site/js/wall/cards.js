// 作品墙的卡片构造（wall.js 与 render-basic.js 共用）。
import { carrierFor } from '../carriers/index.js';
import { fitShape, sizeFor, jitterFor } from './layout.js';
import { h } from '../core/dom.js';
import { getTier } from '../core/tier.js';

export function buildCards(works, categories) {
  const byId = new Map(categories.map(c => [c.id, c]));
  const ctxBase = { h, tier: getTier(), tr: k => k };
  const cards = [];
  works.forEach((work, i) => {
    const category = byId.get(work.category);
    const carrier = carrierFor(work, category);
    const built = carrier.create(work, category, { ...ctxBase, index: i + 1 });
    const size = sizeFor(work);
    const [c, r] = (carrier.shapes[size] || carrier.shapes.m);
    const j = jitterFor(work.slug);
    built.root.style.setProperty('--tilt', j.tilt + 'deg');
    built.root.style.setProperty('--dx', j.dx + 'px');
    built.root.style.setProperty('--dy', j.dy + 'px');
    built.root.dataset.parallax = String(category.parallax);
    cards.push({ work, category, carrier, shape: [c, r], minCols: carrier.minCols || 2, ...built });
  });
  return cards;
}

// 按当前网格列数 G 设置 --cols/--rows（CSS 里 12 / 8 / 6 列）
export function applyShapes(cards, G) {
  for (const card of cards) {
    const { cols, rows } = fitShape(card.shape, G, card.minCols);
    card.root.style.setProperty('--cols', cols);
    card.root.style.setProperty('--rows', rows);
  }
}
export function currentColumns() {
  const mq = q => matchMedia(q).matches;
  return mq('(max-width: 699px)') ? 6 : mq('(max-width: 1099px)') ? 8 : 12;
}
