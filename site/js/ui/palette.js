// 命令面板：Ctrl/Cmd+K 或搜索按钮。combobox + listbox 语义，↑↓ 选择，Enter 执行，Esc 关闭，输入法组合期间不执行。
import { app, emit } from '../core/app.js';
import { h } from '../core/dom.js';
import { openLayer } from '../core/focus.js';
import { fuzzyFilter } from './fuzzy.js';
import { go } from './nav.js';
import { navigate } from '../core/page-transition.js';

let release = null;
let items = [];
let shown = [];
let active = 0;

function buildItems() {
  const list = [];
  for (const w of app.works) {
    const cat = app.byCategory.get(w.category);
    list.push({ kind: '作品', title: w.name, hint: cat ? cat.name : '', keywords: [w.intro, ...(w.tags || []), w.platform || '', cat ? cat.en : '', cat ? cat.name : ''], run: () => app.openWork && app.openWork(w.slug) });
  }
  const href = (id, fallback) => { const a = document.getElementById(id); return a ? a.getAttribute('href') : fallback; };
  list.push(
    { kind: '页面', title: '游戏日报', hint: 'game/', keywords: ['game', 'daily'], run: () => navigate(href('gameLink', 'game/')) },
    { kind: '页面', title: '民生日报', hint: 'minsheng/', keywords: ['minsheng', 'daily'], run: () => navigate(href('civicLink', 'minsheng/')) },
    { kind: '页面', title: '留言簿', hint: 'messages/', keywords: ['message', 'liuyan'], run: () => navigate('messages/') },
    { kind: '页面', title: '隐私说明', hint: 'privacy/', keywords: ['privacy'], run: () => navigate('privacy/') },
    { kind: '命令', title: '切换昼夜主题', hint: 'THEME', keywords: ['theme', 'dark', 'light', '夜间', '昼间'], run: () => document.getElementById('btnTheme').click() },
    { kind: '命令', title: '跳到作品', hint: 'WORKS', keywords: ['works', 'zuopin'], run: () => go('works') },
    { kind: '命令', title: '跳到关于', hint: 'ABOUT', keywords: ['about', 'guanyu'], run: () => go('about') },
    { kind: '命令', title: 'Silent Things', hint: 'EASTER EGG', keywords: ['egg', '彩蛋', 'silent'], run: () => { go('top'); setTimeout(() => emit('egg'), 500); } }
  );
  return list;
}

export function initPalette() {
  const root = document.getElementById('palette');
  const input = document.getElementById('paletteInput');
  const list = document.getElementById('paletteList');
  const empty = document.getElementById('paletteEmpty');
  const btn = document.getElementById('btnSearch');

  function render() {
    shown = fuzzyFilter(items, input.value, 12);
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map((it, i) => {
      const li = h('li', { id: 'pal-' + i, role: 'option', 'aria-selected': String(i === active) },
        h('span', { class: 'pl-kind' }, it.kind), h('span', { class: 'pl-title' }, it.title), h('span', { class: 'pl-hint' }, it.hint));
      li.addEventListener('pointermove', () => { if (active !== i) { active = i; paintActive(); } });
      li.addEventListener('click', () => run(i));
      return li;
    }));
    empty.hidden = shown.length > 0;
    input.setAttribute('aria-activedescendant', shown.length ? 'pal-' + active : '');
  }
  function paintActive() {
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    input.setAttribute('aria-activedescendant', shown.length ? 'pal-' + active : '');
    const el = list.children[active];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }
  function open() {
    if (release) return;
    items = buildItems();
    root.hidden = false;
    input.value = '';
    active = 0;
    render();
    release = openLayer({ el: root, trigger: document.activeElement, initialFocus: input, onEscape: close });
  }
  function close(restore = true) {
    if (!release) return;
    const r = release; release = null;
    root.hidden = true;
    r({ restore: restore !== false });
  }
  function run(i) {
    const it = shown[i];
    if (!it) return;
    close(false);
    // 等背景 inert 解除后再执行
    setTimeout(() => it.run(), 30);
  }
  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (shown.length) { active = (active + 1) % shown.length; paintActive(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (shown.length) { active = (active - 1 + shown.length) % shown.length; paintActive(); } }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
  });
  root.addEventListener('mousedown', e => { if (e.target === root) close(); });
  btn.addEventListener('click', open);
  addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k' || e.shiftKey || e.altKey) return;
    const t = e.target;
    const typing = t && t !== input && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (typing) return;
    e.preventDefault();
    release ? close() : open();
  });
  return { open, close };
}
