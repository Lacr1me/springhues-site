// localStorage / sessionStorage 的安全封装：任何异常都视为“无记录”，绝不抛出。
export const KEYS = Object.freeze({
  theme: 'springhues.home.theme',
  introAt: 'springhues.home.introAt',
  introSeen: 'springhues.home.introSeen'
});
function area(kind) {
  try { return kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage; } catch { return null; }
}
export function read(kind, key) {
  try { const s = area(kind); return s ? s.getItem(key) : null; } catch { return null; }
}
export function write(kind, key, value) {
  try { const s = area(kind); if (!s) return false; s.setItem(key, String(value)); return true; } catch { return false; }
}
export function remove(kind, key) {
  try { const s = area(kind); if (s) s.removeItem(key); } catch { /* 忽略 */ }
}
