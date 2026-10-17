// 文字拆分：容器保留 aria-label，字符 span 设 aria-hidden。
export function splitChars(el, text = el.textContent) {
  el.setAttribute('aria-label', el.dataset.label || text);
  el.dataset.label = el.getAttribute('aria-label');
  el.textContent = '';
  const chars = [];
  for (const ch of text) {
    const outer = document.createElement('span');
    outer.className = 'ch';
    outer.setAttribute('aria-hidden', 'true');
    const inner = document.createElement('span');
    inner.className = 'ch-in';
    inner.textContent = ch === ' ' ? '\u00a0' : ch;
    outer.appendChild(inner);
    el.appendChild(outer);
    chars.push(inner);
  }
  return chars;
}
