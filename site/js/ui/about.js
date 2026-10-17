// 章节 reveal + 关于区动效。full：字幕随滚动速度、碎片窗反向视差；lite：纯 CSS 匀速；calm：静止。
import { getTier } from '../core/tier.js';
import { subscribe } from '../core/ticker.js';

export function initReveal() {
  const tier = getTier();
  if (tier === 'calm' || !('IntersectionObserver' in window)) return;
  const targets = [...document.querySelectorAll('.works-head > *, .about-copy > *, .about-links, .about-shards')];
  targets.forEach(t => t.classList.add('reveal'));
  document.documentElement.classList.add('js-ready');
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const i = targets.indexOf(e.target);
      e.target.style.transitionDelay = Math.min(i % 6, 5) * 60 + 'ms';
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  targets.forEach(t => io.observe(t));
}

export function initAbout() {
  const tier = getTier();
  const track = document.getElementById('marquee');
  const a = document.querySelector('.shard.sh-a'), b = document.querySelector('.shard.sh-b');
  if (tier === 'calm') { if (track) track.style.animation = 'none'; return; }
  if (tier !== 'full') return;
  if (track) {
    document.documentElement.classList.add('motion-js');
    let x = 0, last = scrollY, vel = 0;
    subscribe((t, dt) => {
      const dy = scrollY - last; last = scrollY;
      vel += (Math.abs(dy) - vel) * 0.1;
      x -= (0.045 + vel * 0.06) * dt;
      const w = track.scrollWidth / 3;
      if (-x >= w) x += w;
      track.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
    });
  }
  if (a && b) {
    const sec = document.getElementById('about');
    let raf = 0;
    const upd = () => {
      raf = 0;
      const r = sec.getBoundingClientRect();
      const p = (innerHeight - r.top) / (innerHeight + r.height);
      const s = (p - 0.5) * 120;
      a.style.translate = `0 ${(-s).toFixed(1)}px`;
      b.style.translate = `0 ${s.toFixed(1)}px`;
    };
    addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true });
    upd();
  }
}
