// 分类筛选：斜切 chip（aria-pressed）+ FLIP 重排。#cat= 用 replaceState 同步。
import { app } from '../core/app.js';
import { h } from '../core/dom.js';
import { getTier } from '../core/tier.js';
import { resolveCategory } from '../core/category.js';
import { canAnimateRects } from '../core/flip.js';
import { createMorph } from './morph.js';

let cards = [];
let chips = new Map();
let wallEl = null;
let filtersBar = null;
let morph = null;
let emptyEl = null;

function syncHash(id) {
  const base = location.pathname + location.search;
  const want = id === 'all' ? base : base + '#cat=' + id;
  if (/^#work=/.test(location.hash)) return; // 详情占用 hash 时不改
  if (location.pathname + location.search + location.hash !== want) history.replaceState(history.state, '', want);
}
// 只滚动筛选条自身，让被选中的芯片露出来（不用 scrollIntoView，避免带动整页）。
function revealChip(btn) {
  const bar = filtersBar;
  if (!bar || !btn || bar.scrollWidth <= bar.clientWidth) return;
  const b = btn.getBoundingClientRect(), r = bar.getBoundingClientRect();
  const left = bar.scrollLeft + (b.left - r.left) - Math.max(0, (bar.clientWidth - b.width) / 2);
  const reduce = getTier() === 'calm';
  try { bar.scrollTo({ left: Math.max(0, left), behavior: reduce ? 'auto' : 'smooth' }); } catch { bar.scrollLeft = Math.max(0, left); }
}
function paintChips(id) {
  for (const [key, btn] of chips) btn.setAttribute('aria-pressed', String(key === id));
  revealChip(chips.get(id));
}
// 已登记但暂时没有作品的分类：显示空栏位提示，而不是整面墙塌成空白。
function syncEmpty(id) {
  if (!emptyEl) return;
  const has = id === 'all' ? cards.length > 0 : cards.some(c => c.work.category === id);
  emptyEl.hidden = has;
}

export async function setCategory(raw, { silent = false, immediate = false } = {}) {
  const id = resolveCategory(raw, app.byCategory);
  // 旧别名（#cat=android）或未知值：即使 silent 也把地址栏改写为规范值。
  const rewritten = raw !== id;
  if (id === app.category && !immediate) { paintChips(id); if (rewritten) syncHash(id); return; }
  const changed = id !== app.category;
  app.category = id;
  paintChips(id);
  syncEmpty(id);
  if (!silent || rewritten) syncHash(id);
  if (!changed) return;
  const visible = card => id === 'all' || card.work.category === id;
  const canMorph = !immediate && getTier() !== 'calm' && canAnimateRects();
  const toggle = () => cards.forEach(c => { c.root.hidden = !visible(c); });
  // 芯片高亮与地址栏已同步完成；补间不 await，连点时由 morph 让后一次接管前一次。
  if (canMorph) { (morph || (morph = createMorph({ wall: wallEl, cards, app }))).run(toggle); return; }
  // 即时路径（calm / 不支持 WAAPI 位移 / 路由初始化 / popstate）：一步到位，不做任何透明度动画。
  toggle();
  if (app.parallax) app.parallax.refresh();
}

export function initFilters({ cardList, categories, filtersEl, wall }) {
  cards = cardList; wallEl = wall; filtersBar = filtersEl;
  const counts = new Map();
  cards.forEach(c => counts.set(c.work.category, (counts.get(c.work.category) || 0) + 1));
  const make = (id, label, en, n) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(id === app.category), 'data-cat': id, 'data-cursor': 'open' }, label, h('small', { 'aria-hidden': 'true' }, en + ' ' + String(n).padStart(2, '0')));
    b.addEventListener('click', () => setCategory(id));
    chips.set(id, b);
    return b;
  };
  filtersEl.replaceChildren(make('all', '全部资源', 'ALL', cards.length),
    ...categories.map(c => make(c.id, c.name, c.en, counts.get(c.id) || 0)));
  emptyEl = h('li', { class: 'wall-empty', hidden: true }, '这个分类还没有作品，之后会补上。');
  wallEl.append(emptyEl);
  syncEmpty(app.category);
  app.setCategory = setCategory;
}
