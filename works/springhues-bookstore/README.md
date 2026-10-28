# 四季书屋 · 访客风景

Springhues 个人网站的独立作品。建筑根据用户参考图从零搭建，以真实的本站匿名访客汇总驱动场景人物，支持昼夜、四季、旋转、缩放和开关门。

## 运行与构建

网站入口为 `index.html`。它内嵌 Three.js、模型、字体、图标、Logo 和页面代码；统计通过公开匿名接口读取。无 npm 依赖。

从仓库根目录执行：

```sh
node works/springhues-bookstore/build.mjs
node works/springhues-bookstore/test-stats.mjs
```

编辑 `src/` 后重新构建，勿直接编辑生成的 HTML。运行本地站点可用仓库已有的 `scripts/serve.mjs`。

## 数据口径

- 只显示 GoatCounter 的一种公开访客计数。`count_unique` 是 `count` 的兼容别名，不把它们拆成 PV 和 UV。
- 累计计数覆盖全部记录，近 7 日和近 30 日采用供应商的滚动时间范围。公开数据可能缓存最多 4 小时，页面每 5 分钟读取一次，支持手动刷新。
- 首选本站 GoatCounter 公开计数；累计计数不可用时，依次尝试本站既有只读转发服务与已保存快照。无有效数据时显示横线且不生成访客；刷新失败可保留并标注上次数据。
- 小人仅代表汇总计数，最多 24 位；它们不是当前在线用户，也不提供个人身份、地区或真实浏览轨迹。行走、浏览和进出门是程序编排的场景动作。
- 作品数与近期日报归档数来自本站公开清单；近期归档数不是历史累计期数。
- 只有 `https://springhues.com` 和 `https://www.springhues.com` 加载原站 GoatCounter 统计脚本。本地或下载预览不记录访问，不新增 Cookie 或浏览器存储。

接口、严格数值验证、并发上限、超时与取消在 `src/stats.js`。人物系统在 `src/visitors.js`。完整隐私说明见站点 `/privacy/`。

## 来源

参考 [SueKit Virtual Shop](https://github.com/yisu0830/suekit-virtual-shop) 的“统计驱动微缩人物”思路，建筑、人物、界面和数据适配独立实现。只使用本站数据。

GoatCounter 口径参考 [官方计数器说明](https://www.goatcounter.com/help/visitor-counter)。Three.js、Anton 与 Lucide 的许可见 `THIRD-PARTY-NOTICES.txt`，也内嵌于生成的 HTML。
