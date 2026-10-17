// 首屏计数器：纯 CSS translateY 数字柱。calm 直接显示终值。
import { getTier } from '../core/tier.js';
import { h } from '../core/dom.js';

const values = { works: null, cats: null, issues: null };
let armed = false;
const done = new Set();

function paint(key, animate) {
  const dd = document.querySelector(`#counters [data-count="${key}"] .num`);
  if (!dd) return;
  const v = values[key];
  if (v == null) { dd.textContent = '—'; return; }
  const text = String(v);
  if (!animate || getTier() === 'calm' || !dd.animate) { dd.textContent = text; return; }
  dd.replaceChildren(...[...text].map((ch, i) => {
    const col = h('span', { class: 'col', 'aria-hidden': 'true' });
    const stack = h('span', {}, ...Array.from({ length: 10 }, (_, d) => h('i', {}, String(d))));
    col.appendChild(stack);
    stack.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-Number(ch)}em)` }], { duration: 900 + i * 160, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
    return col;
  }));
  dd.setAttribute('aria-label', text);
  dd.setAttribute('role', 'text');
}
export function setCount(key, value) {
  values[key] = value;
  if (armed && !done.has(key)) { done.add(key); paint(key, true); } else if (!armed) paint(key, false);
  else paint(key, false);
}
// 开场结束后调用：把已到达的值以动画方式滚出来
export function armCounters() {
  armed = true;
  for (const k of Object.keys(values)) if (values[k] != null) { done.add(k); paint(k, true); }
}
