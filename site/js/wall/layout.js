// 作品墙布局纯函数。
// G = 当前网格列数（12 | 8 | 6）；[c, r] = 载体在 12 列下的占位；minCols = 载体声明，缺省 2。
export function fitShape([c, r], G, minCols = 2) {
  const cols = Math.min(G, Math.max(Math.min(minCols, G), Math.round(c * G / 12)));
  const rows = Math.max(2, Math.round(r * cols / c));
  return { cols, rows };
}

// 稳定哈希（FNV-1a 32 位）：刷新、筛选后保持一致，不用 Math.random。
export function hashSlug(slug) {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) { h ^= slug.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export function sizeFor(work) {
  const s = work.layout && work.layout.size;
  if (s === 's' || s === 'm' || s === 'l') return s;
  return ['s', 'm', 'l'][hashSlug(work.slug) % 3];
}
// 返回 {tilt(deg), dx, dy(px)}，范围 ±2.5° / ±14px
export function jitterFor(slug) {
  const h = hashSlug(slug);
  const f = n => ((h >>> n) & 0xff) / 255 * 2 - 1;
  return { tilt: +(f(0) * 2.5).toFixed(2), dx: Math.round(f(8) * 14), dy: Math.round(f(16) * 14) };
}
