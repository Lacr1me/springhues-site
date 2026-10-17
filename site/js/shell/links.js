// 子页面外壳的站内链接表。新增页面时在这里登记：菜单与页脚会自动出现，页首标题条也从这里取名。
// href 相对站点根目录（shell.js 用 siteRoot 拼成绝对地址）。不得登记 admin/ 下的任何页面（后台没有公开入口）。

// 菜单里指向首页的哈希锚点：由首页 main.js 的 handleRoute / hashchange 处理（core/url.js 的 parseAnchor / parseHash）。
export const PRIMARY = Object.freeze([
  { key: 'works', no: '01', cn: '作品', en: 'WORKS', href: './#works' },
  { key: 'daily', no: '02', cn: '每日简报', en: 'DAILY', href: './#cat=daily' },
  { key: 'about', no: '03', cn: '关于', en: 'ABOUT', href: './#about' }
]);

// 子页面。key 与各页 <body data-site-page="…"> 一致。
export const PAGES = Object.freeze([
  { key: 'game', no: '04', cn: '游戏日报', en: 'GAME', href: 'game/' },
  { key: 'minsheng', no: '05', cn: '民生日报', en: 'CIVIC', href: 'minsheng/' },
  { key: 'messages', no: '06', cn: '留言簿', en: 'MESSAGE', href: 'messages/' },
  { key: 'privacy', no: '07', cn: '隐私说明', en: 'PRIVACY', href: 'privacy/' }
]);

// 页脚：返回首页 + 四个子页面。
export const FOOTER = Object.freeze([
  { key: 'home', cn: '返回首页', href: './' },
  ...PAGES.map(p => ({ key: p.key, cn: p.cn, href: p.href }))
]);

export function pageInfo(key) {
  return PAGES.find(p => p.key === key) || null;
}
