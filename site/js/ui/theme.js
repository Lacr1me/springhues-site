// 昼夜主题：跟随系统直到手动选择；切换走碎片擦除；html[data-theme] 同时驱动 WebGL uDay 与静态回退的 .hero-shade。
import { emit } from '../core/app.js';
import { wipe } from '../core/wipe.js';
import { KEYS, read, write } from '../core/store.js';

const root = document.documentElement;
const COLORS = { day: '#F4F6FF', night: '#0D1850' };
export const currentTheme = () => (root.getAttribute('data-theme') === 'night' ? 'night' : 'day');

function apply(theme) {
  root.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', COLORS[theme]);
  const btn = document.getElementById('btnTheme');
  if (btn) btn.setAttribute('aria-label', theme === 'night' ? '切换到昼间主题（当前夜间）' : '切换到夜间主题（当前昼间）');
  emit('theme', theme);
}

export function initTheme() {
  apply(currentTheme());
  let busy = false;
  document.getElementById('btnTheme').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    const next = currentTheme() === 'night' ? 'day' : 'night';
    write('local', KEYS.theme, next);
    await wipe({ top: COLORS[next], onCover: () => apply(next) });
    busy = false;
  });
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', e => {
    if (read('local', KEYS.theme)) return; // 用户已手动选择，不再跟随系统
    apply(e.matches ? 'night' : 'day');
  });
}
