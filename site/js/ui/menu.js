// 全屏菜单：碎片擦除覆盖后显示；role=dialog，焦点圈住，Esc 关闭，焦点回按钮。
import { wipe } from '../core/wipe.js';
import { openLayer } from '../core/focus.js';
import { go } from './nav.js';

let release = null;
let busy = false;

export function initMenu() {
  const btn = document.getElementById('btnMenu');
  const menu = document.getElementById('menu');
  const label = open => { btn.setAttribute('aria-expanded', String(open)); btn.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单'); };
  async function open() {
    if (busy || release) return;
    busy = true;
    await wipe({ onCover: () => { menu.hidden = false; release = openLayer({ el: menu, trigger: btn, onEscape: close }); label(true); } });
    busy = false;
  }
  async function close(after) {
    if (busy || !release) return;
    busy = true;
    await wipe({ onCover: () => {
      menu.hidden = true; const r = release; release = null; label(false);
      r && r({ restore: !after });
      if (typeof after === 'function') after();
    } });
    busy = false;
  }
  btn.addEventListener('click', () => (release ? close() : open()));
  document.getElementById('menuClose').addEventListener('click', () => close());
  menu.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[data-go]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    close(() => go(a.dataset.go, { immediate: true }));
  });
  return { open, close };
}
