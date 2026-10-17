// 彩蛋：十字架处三击（1.2s 内）触发 “THE SILENT THINGS”，约 2s 后复原。布局不位移。命令面板另有键盘入口。
import { on } from '../core/app.js';
import { splitChars } from '../core/split.js';
import { getTier } from '../core/tier.js';

let running = false;
export function initEgg() {
  const title = document.getElementById('heroTitle');
  const hit = document.getElementById('eggHit');
  const layer = document.getElementById('heroInner');
  if (!title) return;
  const original = title.dataset.label || title.getAttribute('aria-label') || title.textContent;
  async function trigger() {
    if (running) return;
    running = true;
    const w0 = title.getBoundingClientRect().width;
    const blade = document.createElement('i');
    blade.className = 'egg-blade';
    layer.appendChild(blade);
    const calm = getTier() === 'calm';
    if (!calm && blade.animate) blade.animate([{ transform: 'scaleX(0)', opacity: 1 }, { transform: 'scaleX(1)', opacity: 1, offset: .6 }, { transform: 'scaleX(1)', opacity: 0 }], { duration: 900, easing: 'cubic-bezier(.7,0,.2,1)' });
    const swap = text => {
      const chars = splitChars(title, text);
      title.classList.add('is-egg');
      const w1 = title.getBoundingClientRect().width;
      title.style.transformOrigin = '50% 50%';
      title.style.transform = text === original ? '' : `scale(${(w0 / w1).toFixed(4)})`;
      if (!calm) chars.forEach((c, i) => c.animate([{ transform: `translate(${(Math.random() - .5) * 1.2}em, ${(Math.random() - .5) * .9}em) rotate(${(Math.random() - .5) * 60}deg)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 520, delay: i * 18, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }));
    };
    swap('THE SILENT THINGS');
    await new Promise(r => setTimeout(r, 2000));
    swap(original);
    title.classList.remove('is-egg');
    await new Promise(r => setTimeout(r, 600));
    blade.remove();
    running = false;
  }
  let count = 0, timer = 0;
  hit.addEventListener('click', () => {
    count += 1;
    clearTimeout(timer);
    timer = setTimeout(() => { count = 0; }, 1200);
    if (count >= 3) { count = 0; trigger(); }
  });
  on('egg', trigger);
}
