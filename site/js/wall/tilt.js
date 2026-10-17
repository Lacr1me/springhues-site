// 卡片 3D 倾斜 + 鼠标跟随反光。仅 full 档 + 精细指针；指针事件挂在 .slot 上，变量写到 .face。rAF 合批。
export function initTilt(wall) {
  let pending = null;
  let raf = 0;
  const flush = () => {
    raf = 0;
    if (!pending) return;
    const { face, nx, ny } = pending;
    pending = null;
    face.style.setProperty('--tilt-x', (nx * 8).toFixed(2) + 'deg');
    face.style.setProperty('--tilt-y', (-ny * 8).toFixed(2) + 'deg');
    face.style.setProperty('--glare-x', ((nx + 1) * 50).toFixed(1) + '%');
    face.style.setProperty('--glare-y', ((ny + 1) * 50).toFixed(1) + '%');
  };
  wall.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const slot = e.target.closest && e.target.closest('.slot');
    const face = slot && slot.querySelector(':scope > .face');
    if (!face) return;
    const r = slot.getBoundingClientRect();
    pending = { face, nx: Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)), ny: Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1)) };
    if (!raf) raf = requestAnimationFrame(flush);
  });
  wall.addEventListener('pointerout', e => {
    const slot = e.target.closest && e.target.closest('.slot');
    if (!slot || (e.relatedTarget && slot.contains(e.relatedTarget))) return;
    const face = slot.querySelector(':scope > .face');
    if (!face) return;
    pending = null;
    for (const k of ['--tilt-x', '--tilt-y']) face.style.setProperty(k, '0deg');
  });
}
