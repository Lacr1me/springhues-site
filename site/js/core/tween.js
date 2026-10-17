// 缓动函数与关键帧采样器。纯模块：顶层不碰 window / document，可被 Node 直接导入。
// 动效本身全部交给 WAAPI（element.animate）；这里只负责把缓动曲线采样成线性关键帧，
// 这样位移 / 缩放 / 墙高共用同一条 document.timeline，不再需要第二个时钟。
//
// 命名沿用旧缓动表：power1Out 为二次方、power3Out / power3InOut 为四次方。
// power3InOut 在中点的最大斜率 = 32·x³ = 4，作品墙验收脚本（PEAK_SLOPE）依赖这个数值。
export const EASES = {
  linear: t => t,
  power1Out: t => 1 - (1 - t) * (1 - t),
  power3Out: t => 1 - Math.pow(1 - t, 4),
  power3InOut: t => (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * Math.pow(1 - t, 4))
};

export function ease(nameOrFn) {
  if (typeof nameOrFn === 'function') return nameOrFn;
  const fn = EASES[nameOrFn];
  if (!fn) throw new Error('未知缓动：' + String(nameOrFn));
  return fn;
}

// 返回 n+1 个点：offset = i/n，value = from + (to - from) · ease(i/n)。
export function easeFrames(nameOrFn, from, to, n = 48) {
  const fn = ease(nameOrFn);
  const out = [];
  for (let i = 0; i <= n; i++) out.push({ offset: i / n, value: from + (to - from) * fn(i / n) });
  return out;
}

// 多个属性共用同一条缓动：props = { opacity: [0, 1], scale: [0.8, 1] } → [{ offset, opacity, scale }, ...]
export function lerpFrames(nameOrFn, props, n = 24) {
  const fn = ease(nameOrFn);
  const keys = Object.keys(props);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const e = fn(i / n);
    const frame = { offset: i / n };
    for (const k of keys) frame[k] = props[k][0] + (props[k][1] - props[k][0]) * e;
    out.push(frame);
  }
  return out;
}
