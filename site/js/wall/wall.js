// 作品墙增强层：载体卡片、12/8/6 列网格、筛选、详情、倾斜、视差、日报卡。
import { app } from '../core/app.js';
import { getTier } from '../core/tier.js';
import { buildCards, applyShapes, currentColumns } from './cards.js';
import { initFilters } from './filter.js';
import { initDetail } from './detail.js';
import { initTilt } from './tilt.js';
import { initParallax } from './parallax.js';
import { bindDaily } from './daily.js';

// 稳定的轮转排序：各分类交替出现，墙面不会被同类卡聚成一整块。
export function interleave(cards, categories) {
  const lanes = categories.map(c => cards.filter(card => card.work.category === c.id)).filter(l => l.length);
  const out = [];
  for (let i = 0; lanes.some(l => i < l.length); i++) for (const lane of lanes) if (lane[i]) out.push(lane[i]);
  return out;
}

export async function initWall({ data, archive }) {
  const wallEl = document.getElementById('worksWall');
  const cards = buildCards(data.works, data.categories);
  const ordered = interleave(cards, data.categories);
  applyShapes(cards, currentColumns());
  wallEl.replaceChildren(...ordered.map(c => c.root));
  wallEl.dataset.mode = 'enhanced';
  const relayout = () => { applyShapes(cards, currentColumns()); app.parallax && app.parallax.refresh(); };
  for (const q of ['(max-width: 699px)', '(max-width: 1099px)']) matchMedia(q).addEventListener('change', relayout);
  const staticLinks = document.querySelector('ul.static-links');
  if (staticLinks) staticLinks.hidden = true;
  initFilters({ cardList: cards, categories: data.categories, filtersEl: document.getElementById('filters'), wall: wallEl });
  initDetail(cards);
  bindDaily(cards, archive);
  if (getTier() === 'full' && matchMedia('(pointer: fine)').matches) initTilt(wallEl);
  // 视差：原生实现（scroll 事件 + IntersectionObserver），无外部依赖，同步挂载；仅 full 档
  if (getTier() === 'full') initParallax(cards);
  return cards;
}
