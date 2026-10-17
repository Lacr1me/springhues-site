// 标题遮挡用的几何常量与换算。坐标一律是整图归一化坐标（0..1，原图 4096x2336）。
// 多边形来自在 hero-1600.webp 上手描（项圈、十字架吊坠），只包含与标题带 B 实际相交的形状。
export const TITLE_BAND = [0.29, 0.51];            // 标题带 y 范围（整图归一化）
export const SAFE = { x: [0.36, 0.59], y: [0, 0.48] };      // 安全矩形 S：书的右半、脖子、项圈、十字架
export const S_NECK = { x: [0.47, 0.56], y: [0.29, 0.38] };  // 颈部/十字架子区
export const CROP = { x: 0.28, w: 0.40 };           // 竖屏裁切：横向 x∈[0.28, 0.68]，高度全取
export const FOCUS = { landscape: 0.47, portrait: 0.475 };

export const OCCLUDERS = {
  choker: [[0.478, 0.306], [0.512, 0.3], [0.554, 0.303], [0.556, 0.326], [0.512, 0.331], [0.48, 0.329]],
  pendant: [[0.5035, 0.311], [0.5205, 0.311], [0.5205, 0.346], [0.5245, 0.348], [0.5245, 0.36], [0.5205, 0.362], [0.5185, 0.382], [0.5065, 0.382], [0.5045, 0.362], [0.499, 0.36], [0.499, 0.348], [0.5035, 0.346]]
};

// 整图坐标 → 竖屏裁切图坐标
export function toCrop([x, y]) { return [(x - CROP.x) / CROP.w, y]; }
export function toCropRect({ x, y }) { return { x: x.map(v => (v - CROP.x) / CROP.w), y }; }

export function bbox(poly) {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
// 多边形包围盒与标题带的重叠高度（>0 即有正面积交集）
export function bandOverlap(poly) {
  const b = bbox(poly);
  return Math.max(0, Math.min(b.y1, TITLE_BAND[1]) - Math.max(b.y0, TITLE_BAND[0]));
}
export function polygonToCss(poly) {
  return 'polygon(' + poly.map(([x, y]) => `${(x * 100).toFixed(3)}% ${(y * 100).toFixed(3)}%`).join(',') + ')';
}
