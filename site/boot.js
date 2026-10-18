/* SHARD 子页面启动脚本（经典脚本，放在 <head> 里同步执行，首帧前完成）。
   只做：主题（与首页共用 localStorage 键 springhues.home.theme，缺省跟随系统）→ html[data-theme]、
   html.shard-live、html.sd-reveal、html.shard-arrive（站内到达）。无依赖，存储读取全部 try/catch。

   日报导出器（artifact-template-*-daily-brief/scripts/render.mjs）会把 Date 换成冻结类 FixedDate 再截图，
   并注入 __SHARD_FORCE__ 让导出图使用线上 SHARD 外观；该标记只由导出器和本地验收脚本注入，线上不存在。 */
(function () {
  'use strict';
  if (Date.name !== 'Date' && !globalThis.__SHARD_FORCE__) return;
  var d = document.documentElement, theme = null, reduced = false;
  try { theme = localStorage.getItem('springhues.home.theme'); } catch (e) {}
  try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  if (theme !== 'day' && theme !== 'night') {
    try { theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day'; } catch (e) { theme = 'day'; }
  }
  d.setAttribute('data-theme', theme);
  d.classList.add('shard-live');
  if (!reduced) d.classList.add('sd-reveal');
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'night' ? '#0D1850' : '#F4F6FF');
  // 站内到达：同源 referrer + 导航类型为 navigate + 非 reduced-motion → 首帧盖住，脚本就绪后擦出（见 wipe.css）
  try {
    var nav = performance.getEntriesByType('navigation')[0], ref = document.referrer && new URL(document.referrer);
    if (!reduced && ref && ref.origin === location.origin && nav && nav.type === 'navigate') d.classList.add('shard-arrive');
  } catch (e) {}
})();
