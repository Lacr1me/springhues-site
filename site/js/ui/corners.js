// 四角：章节编号 01/03（IntersectionObserver）与滚动进度条。
export function initCorners() {
  const now = document.getElementById('secNow');
  const bar = document.getElementById('progressBar');
  const num = document.getElementById('progressNum');
  const prog = document.getElementById('progress');
  const sections = [...document.querySelectorAll('[data-section]')];
  let shown = '01';
  const show = n => {
    const text = String(n).padStart(2, '0');
    if (text === shown) return;
    shown = text;
    now.textContent = text;
    now.classList.remove('tick'); void now.offsetWidth; now.classList.add('tick');
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) show(e.target.dataset.section);
    }, { rootMargin: '-50% 0px -50% 0px' });
    sections.forEach(s => io.observe(s));
  }
  let raf = 0;
  const paint = () => {
    raf = 0;
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    prog.style.setProperty('--p', p.toFixed(4));
    bar.style.setProperty('--p', p.toFixed(4));
    num.textContent = Math.round(p * 100) + '%';
    prog.setAttribute('aria-valuenow', String(Math.round(p * 100)));
  };
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(paint); }, { passive: true });
  addEventListener('resize', () => { if (!raf) raf = requestAnimationFrame(paint); });
  paint();
}
