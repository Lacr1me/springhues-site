// WebGL 降级判定。纯函数：tier 已涵盖 reduced-motion / 粗指针 / 窄屏 / 低内存。
export function shouldDegrade({ tier, hardwareConcurrency }) {
  if (tier !== 'full') return true;
  if (typeof hardwareConcurrency === 'number' && hardwareConcurrency < 4) return true;
  return false;
}
