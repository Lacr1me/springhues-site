// 把 occluder 多边形栅格化成 256 宽的轻微模糊遮罩（白=不位移）。
import { OCCLUDERS, toCrop } from './occluders.js';

export function buildMask(portrait, imageAspect) {
  const w = 256;
  const h = Math.max(2, Math.round(w / imageAspect));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.filter = 'blur(1.5px)';
  g.fillStyle = '#fff';
  for (const poly of Object.values(OCCLUDERS)) {
    g.beginPath();
    poly.forEach((p, i) => {
      const [x, y] = portrait ? toCrop(p) : p;
      i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h);
    });
    g.closePath();
    g.fill();
  }
  return c;
}
