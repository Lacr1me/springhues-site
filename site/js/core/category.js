// 分类 id 规范化。纯 ESM：顶层不碰 window/document，Node 可直接测试。
// 第二轮把 7 类精简为 software / web / game / daily；旧链接 #cat=android|windows|mod 在这里换算。
export const LEGACY_CATEGORY_ALIASES = Object.freeze({ android: 'software', windows: 'software', mod: 'game' });

// known：含 has() 的集合（Map / Set，通常是 app.byCategory）。返回规范分类 id；未知值回退 'all'。
export function resolveCategory(raw, known) {
  if (raw === 'all') return 'all';
  if (known && known.has(raw)) return raw;
  const alias = Object.prototype.hasOwnProperty.call(LEGACY_CATEGORY_ALIASES, raw) ? LEGACY_CATEGORY_ALIASES[raw] : null;
  return alias && known && known.has(alias) ? alias : 'all';
}
