// 开场加载器（WAAPI，无外部动画库）：full ≈2.8s / short ≈0.9s / skip 0.4s / calm 0.2s。
// 结束条件 min(首图 decode && fonts.ready, 3.5s)，6s 强制结束。
import { wipe } from '../core/wipe.js';
import { KEYS, write } from '../core/store.js';

const root = document.documentElement;
const EASE = 'cubic-bezier(.16,1,.3,1)';
const wait = ms => new Promise(r => setTimeout(r, ms));

function buildWord(word) {
  const letters = [];
  [...word.textContent].forEach((ch, i) => {
    const lt = document.createElement('span');
    lt.className = 'lt' + (i === 3 ? ' hot' : '');
    const ghost = document.createElement('span');
    ghost.className = 'ghost'; ghost.textContent = ch;
    lt.appendChild(ghost);
    for (const k of ['f1', 'f2', 'f3']) {
      const f = document.createElement('b');
      f.className = 'f ' + k; f.textContent = ch;
      lt.appendChild(f);
    }
    letters.push(lt);
  });
  word.replaceChildren(...letters);
  return letters;
}

export function runLoader({ mode, ready, onReveal }) {
  const loader = document.getElementById('loader');
  const word = document.getElementById('loaderWord');
  const num = document.getElementById('loaderNum');
  const skipBtn = document.getElementById('loaderSkip');
  const blade = loader.querySelector('.loader-blade');
  const inertTargets = ['#main', '#chrome', '.site-foot'].map(s => document.querySelector(s)).filter(Boolean);
  inertTargets.forEach(el => el.setAttribute('inert', ''));

  return new Promise(resolve => {
    let finished = false, skipped = false;
    const anims = [];
    const run = (el, frames, opts) => { const a = el.animate(frames, { fill: 'both', ...opts }); anims.push(a); return a; };

    function cleanup() {
      inertTargets.forEach(el => el.removeAttribute('inert'));
      root.classList.remove('is-loading', 'js-failed');
      const main = document.getElementById('main');
      if (main) main.focus({ preventScroll: true });
      write('session', KEYS.introSeen, '1');
      write('local', KEYS.introAt, Date.now());
      document.removeEventListener('keydown', onKey);
      loader.removeEventListener('click', onSkip);
      anims.forEach(a => { try { a.cancel(); } catch { /* 忽略 */ } });
      loader.style.display = 'none';
      resolve();
    }
    function finish() {
      if (finished) return;
      finished = true;
      onReveal && onReveal();
      cleanup();
    }
    async function fadeOut(ms) {
      if (finished) return;
      onReveal && onReveal();
      const a = run(loader, [{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'linear' });
      await a.finished.catch(() => {});
      finished = true;
      cleanup();
    }
    function onSkip() {
      if (finished || skipped) return;
      skipped = true;
      anims.forEach(a => { try { a.cancel(); } catch { /* 忽略 */ } });
      fadeOut(300);
    }
    function onKey(e) { if (e.key === 'Escape') onSkip(); }
    skipBtn.addEventListener('click', e => { e.stopPropagation(); onSkip(); });
    loader.addEventListener('click', onSkip);
    document.addEventListener('keydown', onKey);
    skipBtn.focus({ preventScroll: true });
    setTimeout(() => { if (!finished) { skipped = true; finish(); } }, 6000); // 强制结束

    const readyOrTimeout = Promise.race([ready, wait(3500)]);

    if (mode === 'calm') { readyOrTimeout.then(() => !skipped && fadeOut(200)); return; }
    if (mode === 'skip') { readyOrTimeout.then(() => !skipped && fadeOut(400)); return; }

    const letters = buildWord(word);
    const frags = letters.flatMap(l => [...l.querySelectorAll('.f')]);
    if (mode === 'short') {
      letters.forEach((l, i) => run(l, [{ transform: 'translateY(40%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 360, delay: i * 18, easing: EASE }));
      num.textContent = '100';
      Promise.all([wait(520), readyOrTimeout]).then(async () => {
        if (skipped) return;
        await wipe({ onCover: finish });
      });
      return;
    }
    // full
    const dirs = [['-60vw', '-30vh', '-12deg'], ['60vw', '40vh', '10deg'], ['0vw', '-90vh', '0deg']];
    letters.forEach((l, i) => {
      [...l.querySelectorAll('.f')].forEach((f, k) => {
        const [dx, dy, rot] = dirs[k];
        run(f, [{ transform: `translate(${dx},${dy}) rotate(${rot})`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 900, delay: 200 + i * 40, easing: EASE });
      });
    });
    const t0 = performance.now();
    const tick = () => {
      if (finished || skipped) return;
      const p = Math.min(1, (performance.now() - t0) / 1550);
      num.textContent = String(Math.round(p * 100)).padStart(3, '0');
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    run(blade, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 350, delay: 1200, easing: 'cubic-bezier(.7,0,.2,1)' });
    (async () => {
      await wait(1550);
      await readyOrTimeout;
      if (skipped) return;
      frags.forEach((f, i) => run(f, [{ transform: 'none', opacity: 1 }, { transform: `translate(${(Math.random() - .5) * 60}vw, ${(Math.random() - .5) * 60}vh) rotate(${(Math.random() - .5) * 90}deg) scale(1.5)`, opacity: 0 }], { duration: 560, delay: (i % 10) * 12, easing: 'cubic-bezier(.7,0,.2,1)' }));
      await wipe({ onCover: finish });
    })();
  });
}
