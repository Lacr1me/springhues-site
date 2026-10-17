// 动效分档。computeTier 是纯函数；initTier 在启动时算一次，其他模块只用 getTier()。
export function computeTier({ reduced, finePointer, canHover, width, deviceMemory }) {
  if (reduced) return 'calm';
  if (!(finePointer && canHover) || width < 700) return 'lite';
  if (typeof deviceMemory === 'number' && deviceMemory < 4) return 'lite';
  return 'full';
}

let current = null;
export function readEnv(win = globalThis.window) {
  const mq = q => !!(win.matchMedia && win.matchMedia(q).matches);
  return {
    reduced: mq('(prefers-reduced-motion: reduce)'),
    finePointer: mq('(pointer: fine)'),
    canHover: mq('(hover: hover)'),
    width: win.innerWidth,
    deviceMemory: win.navigator && win.navigator.deviceMemory
  };
}
export function initTier(env) {
  current = computeTier(env || readEnv());
  return current;
}
export function getTier() { return current || 'lite'; }
