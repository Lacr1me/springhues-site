// 颜色家族像素分类：蓝 / 白 / 红 / 墨。
// 只此一份实现：--palette、浏览器验收（把本函数 toString() 注入页面）共用。
// 注意：函数必须自包含，不能引用函数外部的任何变量，否则注入浏览器后会失效。
export function classifyFamilies(rgba) {
  const anchors = [
    ['blue', 5, 55, 180], ['blue', 12, 43, 146], ['blue', 12, 34, 118], ['blue', 10, 29, 108], ['blue', 13, 24, 80],
    ['white', 252, 252, 252], ['white', 244, 246, 255],
    ['red', 144, 7, 42], ['red', 122, 16, 34],
    ['ink', 8, 6, 10]
  ];
  const counts = { blue: 0, white: 0, red: 0, ink: 0 };
  let total = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 8) continue; // 全透明像素不计入
    let best = 0, bestD = Infinity;
    for (let a = 0; a < anchors.length; a++) {
      const dr = rgba[i] - anchors[a][1], dg = rgba[i + 1] - anchors[a][2], db = rgba[i + 2] - anchors[a][3];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = a; }
    }
    counts[anchors[best][0]]++;
    total++;
  }
  const pct = {};
  for (const k of Object.keys(counts)) pct[k] = total ? +(counts[k] * 100 / total).toFixed(2) : 0;
  return { counts, total, pct };
}
