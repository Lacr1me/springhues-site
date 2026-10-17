// 跨模块共享状态与事件。模块路径唯一（无查询串），所以这里是页面内的单例。
export const app = {
  works: [],
  categories: [],
  byCategory: new Map(),
  category: 'all',
  data: null,          // 作品数据是否就绪
  openWork: null,      // 由 wall/detail 注册：openWork(slug, opts)
  setCategory: null,   // 由 wall/filter 注册：setCategory(id, opts)
  archive: null,       // data/archive.js 实例
  parallax: null,      // 由 wall/parallax 注册：{ pause, resume, refresh, destroy }；lite / calm 档保持 null
  overlays: 0
};
const listeners = new Map();
export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}
export function emit(type, detail) {
  for (const fn of [...(listeners.get(type) || [])]) {
    try { fn(detail); } catch (e) { console.error('[app] 事件处理失败', type, e); }
  }
}
export const prefersReduced = () => !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
