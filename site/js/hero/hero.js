// 首屏：标题拆字与进场、宽屏 occluder、WebGL 布料着色器与降级、帧探测。
import { on } from '../core/app.js';
import { getTier } from '../core/tier.js';
import { splitChars } from '../core/split.js';
import { subscribe } from '../core/ticker.js';
import { shouldDegrade } from './fallback.js';
import { OCCLUDERS, polygonToCss } from './occluders.js';
import { buildMask } from './mask.js';
import { createHeroGL } from './webgl.js';

const root = document.documentElement;

export function initHero() {
  const stage = document.getElementById('heroStage');
  const img = document.getElementById('heroImg');
  const canvas = document.getElementById('heroCanvas');
  const occ = document.getElementById('heroOcc');
  const hero = document.getElementById('top');
  const title = document.getElementById('heroTitle');
  const tier = getTier();
  const chars = splitChars(title);
  const portraitMq = matchMedia('(max-aspect-ratio: 9/10)');
  const state = { gl: null, visible: true, probe: null, degraded: false, introDone: false };

  // ---- occluder：宽屏（>=3:2）启用，其余走描边叠加回退 ----
  const supportsClip = !!(window.CSS && CSS.supports && CSS.supports('clip-path', 'polygon(0 0)'));
  function syncOccluders() {
    const wide = innerWidth / innerHeight >= 1.5 && !portraitMq.matches && supportsClip && tier !== 'calm';
    if (!wide) { root.classList.remove('has-occ'); return; }
    const src = img.currentSrc || img.src;
    if (!occ.children.length) {
      for (const [name, poly] of Object.entries(OCCLUDERS)) {
        const o = document.createElement('img');
        o.alt = ''; o.setAttribute('aria-hidden', 'true'); o.dataset.part = name;
        o.style.clipPath = polygonToCss(poly);
        occ.appendChild(o);
      }
    }
    for (const o of occ.children) if (o.src !== src) o.src = src;
    root.classList.add('has-occ');
  }
  img.addEventListener('load', () => { syncOccluders(); if (state.gl) { state.gl.reupload(); resizeGL(); } });
  addEventListener('resize', () => { syncOccluders(); resizeGL(); });
  if (img.complete) syncOccluders();

  // ---- 降级路径：静态图 + CSS 呼吸 + 径向刀光 ----
  function degrade(reason) {
    if (state.degraded) return;
    state.degraded = true;
    console.info('[hero] 降级为静态图：' + reason);
    if (state.gl) { state.gl.destroy(); state.gl = null; }
    root.classList.remove('gl-on');
    if (tier !== 'calm') root.classList.add('hero-breathe');
    if (tier === 'full' && matchMedia('(pointer: fine)').matches) {
      hero.addEventListener('pointermove', e => {
        const r = stage.getBoundingClientRect();
        stage.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 100).toFixed(1) + '%');
        stage.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 100).toFixed(1) + '%');
      }, { passive: true });
    }
  }

  function resizeGL() {
    if (!state.gl) return;
    const r = stage.getBoundingClientRect();
    if (r.width > 1) state.gl.resize(r.width, r.height);
  }

  // ---- WebGL ----
  const reason = shouldDegrade({ tier, hardwareConcurrency: navigator.hardwareConcurrency }) ? '性能档位或硬件并发度不足' : null;
  if (reason) degrade(reason);
  else {
    const start = () => {
      const aspect = (img.naturalWidth || 4096) / (img.naturalHeight || 2336);
      const mask = buildMask(portraitMq.matches, aspect);
      const gl = createHeroGL(canvas, { img, maskCanvas: mask, onLost: () => degrade('WebGL 上下文丢失') });
      if (!gl) { degrade('WebGL 不可用'); return; }
      state.gl = gl;
      gl.setDayNow(root.getAttribute('data-theme') === 'night' ? 0 : 1);
      resizeGL();
      root.classList.add('gl-on');
    };
    if (img.complete && img.naturalWidth) start(); else img.addEventListener('load', start, { once: true });
    portraitMq.addEventListener('change', () => { if (state.gl) { state.gl.destroy(); state.gl = null; root.classList.remove('gl-on'); degrade('取景方向变化，重建需刷新'); } });
    if ('IntersectionObserver' in window) new IntersectionObserver(es => { state.visible = es[0].isIntersecting; }).observe(hero);
    let frames = 0, sum = 0;
    subscribe((t, dt) => {
      const gl = state.gl;
      if (!gl || !state.visible) return;
      gl.render(t / 1000, dt);
      // 帧探测：开场结束后开始，丢弃前 10 帧，其后 30 帧平均 >24ms 则降级
      if (state.probe) {
        frames += 1;
        if (frames > 10) { sum += dt; if (frames === 40) { const avg = sum / 30; state.probe = null; if (avg > 24) degrade('帧时间过长 ' + avg.toFixed(1) + 'ms'); } }
      }
    });
    state.startProbe = () => { frames = 0; sum = 0; state.probe = true; };
  }
  // 昼夜：与 html[data-theme] 同步（WebGL 0.6s 插值；静态路径由 CSS 过渡）
  on('theme', th => { if (state.gl) state.gl.setDay(th === 'night' ? 0 : 1); });

  // ---- 进场：加载器结束后调用 ----
  function sweep() {
    if (tier === 'calm') return;
    const s = document.createElement('i');
    s.className = 'hero-sweep';
    s.setAttribute('aria-hidden', 'true');
    document.getElementById('heroInner').appendChild(s);
    const a = s.animate([{ transform: 'translateX(-20vw) skewX(-24deg)' }, { transform: 'translateX(120vw) skewX(-24deg)' }], { duration: 1100, delay: 350, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'both' });
    a.finished.then(() => s.remove(), () => s.remove());
  }
  function intro() {
    root.classList.remove('title-prep');
    state.introDone = true;
    if (tier !== 'calm') {
      chars.forEach((c, i) => c.animate([{ transform: 'translateY(130%)' }, { transform: 'none' }], { duration: 950, delay: i * 35, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }));
      const rise = (sel, delay) => document.querySelectorAll(sel).forEach(el => el.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }));
      rise('.hero-sub span', 550); rise('.scroll-cue', 800); rise('.counters', 800);
      sweep();
    }
    if (state.startProbe) setTimeout(state.startProbe, 900);
  }
  return { intro, state, degrade };
}
