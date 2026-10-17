// 本地托管第三方库的同源注入加载（UMD，不能 import()）。运行时零 CDN。
import { getTier } from './tier.js';

const cache = new Map();
export function loadScript(src, timeout = 8000) {
  if (cache.has(src)) return cache.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    const timer = setTimeout(() => { s.remove(); reject(new Error('脚本加载超时 ' + src)); }, timeout);
    s.src = src;
    s.async = true;
    s.onload = () => { clearTimeout(timer); resolve(); };
    s.onerror = () => { clearTimeout(timer); s.remove(); reject(new Error('脚本加载失败 ' + src)); };
    document.head.appendChild(s);
  });
  cache.set(src, p);
  p.catch(() => cache.delete(src));
  return p;
}

let lenisPromise = null;
export function loadLenis() {
  if (getTier() !== 'full') return Promise.resolve(false);
  if (lenisPromise) return lenisPromise;
  lenisPromise = loadScript('vendor/lenis/lenis.min.js').then(() => true).catch(e => { console.warn('[vendor] Lenis 不可用，使用原生滚动', e && e.message); return false; });
  return lenisPromise;
}
