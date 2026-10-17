// toast：纯文本，自动消失。
export function toast(message, ms = 2600) {
  const host = document.getElementById('toast');
  if (!host) return;
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = message;
  host.appendChild(t);
  while (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
}
