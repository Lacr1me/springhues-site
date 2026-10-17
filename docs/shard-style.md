# SHARD 风格规范（Springhues）

适用对象：以后要改页面或新增页面的 AI 与人。共享样式在 `site/css/shard-theme.css`（文件头有索引），检查脚本在 `scripts/check-shard-style.mjs`，外壳脚本在 `site/js/shell/`。首页（`index.html` + `site/`）与子页面（`game/ minsheng/ messages/ privacy/`）同属这套风格。

## 0. 一键配置提示词

把下面整段复制给任意 AI（同内容另存为纯文本 `docs/shard-style-prompt.txt`，便于整段复制）：

```text
你是 Springhues 站点的前端协作者。请把我指定的页面改成 SHARD 风格（克莱因蓝 + 冷白 + 勃艮第红“刃”，切角造型，无圆角矩形）。动手前先完整阅读两份文件：
1. docs/shard-style.md（风格规范：原则、token、字体、切角、组件与最小 HTML、动效、无障碍、新页面模板、日报页约束、自检清单）
2. site/css/shard-theme.css（跨页面共享样式，文件头有索引）

执行方式：
- 新页面从 docs/shard-style.md 第 9 节的“新页面最小模板”复制；只引入 site/css/shard-theme.css、site/css/wipe.css、site/boot.js、site/js/shell/shell.js（版本戳统一用 scripts/check-shard-style.mjs 导出的 SHARD_VERSION，当前为 20261018-shard-v4），页面专属样式放 site/css/pages-<名字>.css，选择器建议以 html.shard-live 开头（shard-theme.css 与 pages-daily.css 必须，脚本强制；留言 / 隐私等非日报页不强制，但新增规则请照做）。
- 只使用 .sd-* 组件类和 --sh-* / 语义 token（--bg --fg --surface --on-surface --blade --focus-ring --edge --muted --sd-*），不要写十六进制色值替代 token，不要复制粘贴 token 值。
- 新页面在 site/js/shell/links.js 登记后，菜单和页脚会自动出现；页首、页脚、主题切换、擦屏过渡由外壳脚本提供，不要自己再写。
- 主题键沿用 localStorage 的 springhues.home.theme（day / night），默认跟随系统；不要新增存储键。

硬约束（违反即返工）：
1. 禁止圆角矩形：border-radius 只能是 0；仅状态点 .sd-dot 与头像 .sd-avatar 允许 50%。
2. 配色比例：蓝约 60%、冷白约 30%、勃艮第红 ≤10% 且只当“刃”（新内容角标、关键按钮、强调线、悬停描边、焦点底色）。红字只能放在白 / 冷白底上；红底或蓝底上不放对方颜色的小字。不要滥用渐变。
3. 不引入任何 CDN、第三方动画库、字体或图标库；动效只用 WAAPI 和 site/js/core/tween.js，必须尊重 prefers-reduced-motion，失败时退化为普通跳转 / 静态显示。
4. 无障碍：正文对比度 ≥4.5:1，所有可交互元素有可见焦点（切角元素用内描边 outline-offset:-6px 加底色翻转），触控目标 ≥44px，键盘可达，各宽度无横向滚动。
5. 不得链接 admin/ 下任何页面；不得改 message-config.js、message-client.js、supabase/、data/、downloads/、config/、.github/。
6. 日报页（game/、minsheng/）的 HTML / PNG 由导出器同源渲染：不得修改 styles.css、brand.css、site-shell.js、两个 app.js、minsheng/*.css 和两个日报 HTML 的正文；线上外壳只能通过 site/css/pages-daily.css（全部以 html.shard-live 开头）叠加，只改颜色 / 边框颜色 / 圆角 / 切角，不改字号、行高、padding、网格和 .story 的高度；改完必须运行 node scripts/check-export-parity.mjs。
7. 不要 commit、push，不要运行日报生产、渲染写入 artifacts/、获取租约或发布。

完成后依次运行并把结果贴给我（任何一项失败先修复再汇报）：
  node scripts/check-shard-style.mjs                     （样式检查：圆角、日报共享样式未门控、未定义 token、命名色 / 十六进制色值、版本戳、未引用主题）
  node scripts/test-site.mjs                            （站点单测，含首页与子页面静态检查）
  node scripts/verify-home-redesign.mjs --section=pages （浏览器验收，需要本机 Edge）
  node scripts/check-export-parity.mjs --channel=both   （仅当改动涉及日报页）
  git diff --check
最后逐条对照 docs/shard-style.md 第 12 节的自检清单，说明哪些项已验证、哪些未验证。
```

## 1. 这套风格是什么

一句话：刀切出来的颜色。大面积克莱因蓝，冷白做呼吸，勃艮第红只在“刃口”出现。图形语言是切角和斜切，不是圆角卡片。首页的主视觉来自参考图 `assets/hero/风格化.jpeg`，调色板取样自它（`node scripts/build-hero-assets.mjs --palette`）。

## 2. 设计原则与禁忌

| 原则 | 做法 |
| --- | --- |
| 色彩比例 | 蓝约 60%，冷白约 30%，勃艮第红 ≤10%。夜间页面底是深蓝，蓝+深蓝仍占多数。例外：游戏 / 民生日报页的正文纸面保持冷白（与导出同源），游戏页日间首屏实测蓝占比约 29.8%，略低于 30%，属于有意取舍 |
| 红只当“刃” | 新内容角标、关键按钮、强调细线、悬停描边、焦点底色。不做大面积底色，不做长段文字颜色 |
| 红字 / 蓝字的位置 | 红字只放白 / 冷白底。`#90072A` 与 `#0537B4` 亮度几乎相同，红字压蓝底、蓝字压红底都看不清 |
| 造型 | 切角（`clip-path` 多边形）与斜切。**不使用圆角矩形** |
| 渐变 | 不做平滑渐变。需要层次时用硬边多边形（`clip-path`）叠色块 |
| 外部资源 | 不用 CDN、外部字体、图标库；图标是内联 SVG（线性，`stroke-linecap: square`），不用 emoji 当图标 |
| 动效 | 每个动效都要有 `prefers-reduced-motion` 退路；不引入新动画库 |
| 内容优先 | 日报等长文本页面不为风格化牺牲内容密度和对齐 |

**必须圆的元素（唯一例外清单）**：`.sd-dot`（状态点）、`.sd-avatar`（头像）；日报线上页里的 `.live-dot`（旧页面既有的“更新中”小圆点）与 `.loading > span`（加载转圈）。这些元素的 `border-radius` 值只能是 `50%`。

## 3. 色板与 token

所有颜色都走变量。检查脚本的实际口径：`site/css/*.css` 里颜色类属性出现命名色（`red`、`blue` 等）报错；`pages-messages.css`、`pages-privacy.css` 与新增的 `pages-<名字>.css` 另禁十六进制色值（新页面请加入脚本的 `NO_HEX`）；`pages-daily.css` 因日报冷白纸面等固定色保留十六进制，`shard-theme.css` / `tokens.css` 是定义 token 的地方。`shard-theme.css` 的 token 值与 `site/css/tokens.css` 逐项相同（`check-shard-style.mjs` 会比对日 / 夜两套）。

### 调色板（日夜通用）

| 变量 | 值 | 用途 |
| --- | --- | --- |
| `--sh-klein-500` | `#0537B4` | 主蓝：页首按钮、英雄区、按钮底、页脚 |
| `--sh-klein-700` | `#0C2B92` | 悬停蓝、斜切色块 |
| `--sh-klein-900` | `#0A1D6C` | 夜间卡片底、夜间英雄区 |
| `--sh-klein-950` | `#0D1850` | 夜间页面底、页名条底、深色文字 |
| `--sh-white` | `#F4F6FF` | 冷白：日间页面底、白字 |
| `--sh-ink` | `#08060A` | 墨：极少量深色 |
| `--sh-burgundy` | `#90072A` | 勃艮第红：刃 |
| `--sh-burgundy-deep` | `#7A1022` | 红色按钮悬停 |

### 语义变量（日 / 夜）

| 变量 | 日间 `data-theme="day"` | 夜间 `data-theme="night"` |
| --- | --- | --- |
| `--bg` | `var(--sh-white)` | `var(--sh-klein-950)` |
| `--fg` | `var(--sh-klein-500)` | `var(--sh-white)` |
| `--surface` | `var(--sh-klein-500)` | `var(--sh-klein-900)` |
| `--on-surface` | `var(--sh-white)` | `var(--sh-white)` |
| `--blade` | `var(--sh-burgundy)` | `var(--sh-burgundy)` |
| `--focus-ring` | `var(--sh-burgundy)` | `var(--sh-white)` |
| `--edge` | `var(--sh-klein-950)` | `var(--sh-white)` |
| `--muted` | `#3a4f9a` | `#b9c4ee` |

### 通用变量

| 变量 | 值 |
| --- | --- |
| `--font-display` | `"Anton", Impact, "Arial Narrow Bold", sans-serif` |
| `--font-cn` | `"Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif` |
| `--ease-out` | `cubic-bezier(.16, 1, .3, 1)` |
| `--ease-wipe` | `cubic-bezier(.7, 0, .2, 1)` |
| `--cut` | `14px`（切角基准） |

### 仅子页面外壳使用的扩展变量（只在 `shard-theme.css` 定义，日 / 夜不同）

| 变量 | 日间 | 夜间 | 用途 |
| --- | --- | --- | --- |
| `--sd-panel` | `#FFFFFF` | `var(--sh-klein-900)` | 卡片、表单底 |
| `--sd-text` | `var(--sh-klein-950)` | `var(--sh-white)` | 卡片内正文 |
| `--sd-line` | `#C3CCEE` | `#2C3FA0` | 卡片外框线、分隔线 |
| `--sd-hero` / `--sd-hero-shard` | `var(--sh-klein-500)` / `var(--sh-klein-700)` | `var(--sh-klein-900)` / `var(--sh-klein-700)` | 英雄区底与斜切色块 |
| `--sd-foot` | `var(--sh-klein-500)` | `var(--sh-klein-900)` | 页脚底 |
| `--sd-top-h` | `84px`（≤699px 为 `76px`） | 同左 | 固定页首占位高度 |
| `--sd-cut` | `var(--cut)` | 同左 | 组件切角，可局部覆盖（`.sd-cut-lg` = 24px，`.sd-cut-sm` = 8px） |
| `--sd-wrap` | `1100px` | 同左 | 内容最大宽度 |

> 新增 token 必须同时在 `shard-theme.css` 的日 / 夜两个块里定义，并在本表登记；不要在页面样式里临时发明颜色变量名。

## 4. 字体与字号阶梯

不使用外部字体。Anton 随站点自托管（`assets/fonts/anton-latin.woff2`），只用于英文大标题、编号和标签。中文用系统字体栈。

| 角色 | 字体 / 字重 | 字号与行高 | 类 / 位置 |
| --- | --- | --- | --- |
| 正文 | `--font-cn` 400 | `16px / 1.7`（长文 `1.85–1.9`） | `.sd-page` |
| 英雄区英文大标题 | `--font-display` | `clamp(46px, 11vw, 132px) / .95`，大写 | `.sd-h1 .en` |
| 英雄区中文标题 | `--font-cn` 900 | `clamp(26px, 5vw, 52px) / 1.25`，`letter-spacing: .06em` | `.sd-h1 .cn` |
| 导语 | `--font-cn` | `clamp(15px, 1.6vw, 18px) / 1.9` | `.sd-lead` |
| 区块标题 | `--font-cn` 900 | `clamp(22px, 3vw, 30px) / 1.35` | `.sd-h2`，英文小标 `14px` Anton |
| 眉题 | `--font-display` | `15px`，`letter-spacing: .22em`，大写 | `.sd-eyebrow`（左侧 34×4 红刃） |
| 按钮 | `--font-cn` 800 | `15px / 1.2`，`letter-spacing: .06em` | `.sd-btn` |
| 标签 / 角标 | `--font-cn` 700 | `12px / 1.6` | `.sd-tag` |
| 页名条 | 中文 900 `16px` + Anton `14px` | — | `.sd-title` |
| 辅助文字 | `--font-cn` | `13–14px`，颜色 `--muted` | 计数、时间、说明 |

## 5. 切角形状工具

基准 `--cut: 14px`，组件内部用 `--sd-cut`（可局部覆盖）。**不要把 `clip-path` 写死在页面里**，用工具类：

| 类 | 形状 | 多边形 |
| --- | --- | --- |
| `.sd-cut-br` | 右下切角 | `polygon(0 0, 100% 0, 100% calc(100% - var(--sd-cut)), calc(100% - var(--sd-cut)) 100%, 0 100%)` |
| `.sd-cut-tl-br` | 左上 + 右下切角 | `polygon(var(--sd-cut) 0, 100% 0, 100% calc(100% - var(--sd-cut)), calc(100% - var(--sd-cut)) 100%, 0 100%, 0 var(--sd-cut))` |
| `.sd-cut-tr-bl` | 右上 + 左下切角 | `polygon(0 0, calc(100% - var(--sd-cut)) 0, 100% var(--sd-cut), 100% 100%, var(--sd-cut) 100%, 0 calc(100% - var(--sd-cut)))` |
| `.sd-cut-slash` | 右侧斜切条 | `polygon(0 0, 100% 0, calc(100% - var(--sd-cut)) 100%, 0 100%)` |
| `.sd-cut-slash-l` | 左侧斜切条 | `polygon(var(--sd-cut) 0, 100% 0, 100% 100%, 0 100%)` |
| `.sd-cut-lg` / `.sd-cut-sm` | 把 `--sd-cut` 改成 `24px` / `8px`，与上面任一形状组合 | — |

规则：

- **含交互子元素且需要完整外描边的容器不要加 `clip-path`**（外描边会被裁掉）。内含 Turnstile 之类不能被裁切的元素时，用 `.sd-plate--layer`：背景与切角画在 `::before` 上，容器本身没有 `clip-path` / `overflow`。
- 被切角的元素用**内描边**表示焦点：`outline: 3px solid var(--focus-ring); outline-offset: -6px`，并翻转底色（见第 8 节）。
- 切角裁掉的是边框，不是内容；留出 `padding`，别让文字贴到斜边。
- 英雄区的大斜切用 `polygon(0 0, 100% 0, 100% calc(100% - 56px), 0 100%)`（手机 `36px`），不要用 `border-radius` 或 SVG 曲线。

## 6. 组件清单与最小 HTML

所有组件类都以 `sd-` 为前缀，并且只在 `html.shard-live` 下生效。

### 6.1 页首（由 `shell.js` 注入，不要手写）

左上 logo 返回首页，中间页名条，右上主题切换与菜单按钮。手写只用于说明结构：

```html
<header class="sd-top">
  <a class="sd-corner" href="/" aria-label="Springhues 首页"></a>
  <div class="sd-title" aria-hidden="true"><b>留言簿</b><i>MESSAGE</i></div>
  <div class="sd-actions" role="group" aria-label="快捷操作">
    <button class="sd-act" type="button" aria-label="切换到夜间主题（当前昼间）">…</button>
    <button class="sd-act" type="button" aria-expanded="false" aria-controls="sdMenu" aria-label="打开菜单">…</button>
  </div>
</header>
```

页名条取自 `body[data-site-page]` 在 `site/js/shell/links.js` 里的登记名；未登记的页面用 `<body data-sd-title="页面名" data-sd-title-en="NAME">`。

### 6.2 页脚与菜单（由 `shell.js` 注入）

页脚固定五项：返回首页、游戏日报、民生日报、留言簿、隐私说明，**没有 admin**。菜单项在此基础上加“作品 `./#works`、每日简报 `./#cat=daily`、关于 `./#about`”。新增页面在 `links.js` 的 `PAGES` 登记后，二者自动出现。

```html
<footer class="sd-foot"><div class="sd-foot-inner"><nav aria-label="站内入口"><a href="/">返回首页</a>…</nav><p>© 2026 Springhues · 作品与日常</p></div></footer>
```

### 6.3 斜切标题块（英雄区）

```html
<header class="sd-hero">
  <div class="sd-wrap">
    <p class="sd-eyebrow" data-sd-reveal="0">SECTION NAME</p>
    <h1 class="sd-h1" data-sd-reveal="1"><span class="en" aria-hidden="true">Title</span><span class="cn">页面标题</span></h1>
    <p class="sd-lead" data-sd-reveal="2">一两句导语。</p>
  </div>
</header>
```

英文装饰字加 `aria-hidden="true"`，`<h1>` 的可读名字只有中文。

### 6.4 按钮

```html
<button class="sd-btn" type="button">普通按钮</button>
<a class="sd-btn sd-btn--blade" href="…">关键按钮 <span aria-hidden="true">→</span></a>
```

关键按钮（红）每屏最多一两个，如“提交”“下载”。高度 ≥44px，焦点：内描边 + 底色翻转。

### 6.5 芯片筛选

```html
<div role="group" aria-label="按分类筛选">
  <button class="sd-chip" type="button" aria-pressed="true">全部</button>
  <button class="sd-chip" type="button" aria-pressed="false">软件</button>
</div>
```

选中态（`aria-pressed="true"`）蓝底白字并带左侧红刃。

### 6.6 标签与角标

```html
<span class="sd-tag">Android</span>
<span class="sd-tag sd-tag--new">NEW</span>
```

红色只给“新内容”角标。

### 6.7 卡片外框

```html
<section class="sd-plate sd-plate--blade" data-sd-reveal="0">
  <h2 class="sd-h2">标题</h2>
  <p>内容</p>
</section>
```

变体：`sd-plate--blade`（左缘红刃）、`sd-plate--top`（顶边蓝条）、`sd-plate--layer`（背景画在 `::before`，容器不裁切）。

### 6.8 分隔带与字幕条

```html
<div class="sd-rule" role="presentation"></div>
<div class="sd-ticker" aria-hidden="true"><div><span>SPRINGHUES · </span><span>SPRINGHUES · </span><span>SPRINGHUES · </span></div></div>
```

字幕条用三份相同内容做无缝循环（`translateX(-33.33%)`），装饰性，必须 `aria-hidden`；reduced-motion 下动画被全局规则压成瞬间。

### 6.9 表单与输入

```html
<form>
  <label class="sd-field">昵称 <span>1—20 字</span><input class="sd-input" name="nickname" maxlength="20" required></label>
  <label class="sd-field">留言 <span>0/300</span><textarea class="sd-input" name="content" rows="5"></textarea></label>
  <p class="sd-note" role="status" aria-live="polite"></p>
</form>
```

`.sd-field` 的标签文字在左、提示 / 计数 `span` 在右，控件独占下一行。输入框是直角矩形（零圆角），左侧加粗 6px 边，聚焦时左边变红刃。留言页的 `.form-status` 用“正文色 + 左侧色刃”表示状态（错误是红刃，不用红字）。

### 6.10 表格与列表

```html
<ul class="sd-list"><li class="sd-item">…</li></ul>
<table class="sd-table"><thead><tr><th>列</th></tr></thead><tbody><tr><td>值</td></tr></tbody></table>
```

`.sd-item` 左缘 6px 蓝条，悬停变红刃；表头蓝底白字。

### 6.11 提示条

```html
<p class="sd-note">普通提示</p>
<p class="sd-note" data-state="error" role="alert">出错了</p>
<p class="sd-note" data-state="success" role="status">已完成</p>
```

空内容的 `.sd-note` 自动隐藏。

## 7. 动效规则

| 项 | 规则 |
| --- | --- |
| 微交互 | 悬停 / 按下 `200–300ms`，缓动 `var(--ease-out)`；只动 `transform`、`opacity`、`background-color`、`clip-path` |
| 擦屏（菜单、主题切换、页面进出） | 单段 `360ms`，红 / 蓝 / 白三层斜四边形，缓动 `cubic-bezier(.7,0,.2,1)`（`--ease-wipe`）；实现在 `site/js/core/wipe.js`，用 WAAPI |
| 跨文档 View Transition | **整站不使用**：新页面不要写 `@view-transition`。切页动画只由碎片擦屏负责。原因：Chrome 要求跨文档过渡两端同时 opt-in，一端有、另一端没有就会在导航时抛 `ViewTransition opt-in disabled`（外链样式的加载时序还会让它偶发）。日报页加载的 `brand.css`（被导出消费，不可改）自带 `navigation:auto`，所以 `pages-daily.css` 在其后用 `@view-transition{navigation:none}` 覆盖。`test-home.mjs` 会断言：首页和 `site/css` 里除 `pages-daily.css` 外没有 `@view-transition`，且日报页先加载 `brand.css` 再加载 `pages-daily.css` |
| 页面过渡 | `site/js/core/page-transition.js`：离开时在文档冒泡阶段拦截站内链接，盖屏最多等 700ms 再跳转；到达时从遮盖态擦出。动画不可用 / 抛错 / 超时都直接普通跳转，**绝不阻塞导航**；calm 档和修饰键点击、`target`、`download`、`rel=external`、`data-no-transition` 都不拦截 |
| 作品墙补间 | `700ms`，`power3InOut`（四次方缓动，中点斜率 4）；见 `site/js/core/tween.js` 与 `site/js/wall/morph.js` |
| reveal | 给元素加 `data-sd-reveal="n"`（n 为同批错峰序号，每级 70ms），进入视口时 `620ms` 淡入上移；纯 CSS 兜底 2.4s 后一定显示 |
| 工具 | 只用 WAAPI（`element.animate`）与 `core/tween.js` 的缓动 / 采样器。**禁止引入任何新动画库**，也不要写依赖 CDN 的脚本 |
| 动效档位 | `full`（精细指针且宽度 ≥700）/ `lite`（触屏或窄屏，砍掉视差与光标）/ `calm`（`prefers-reduced-motion: reduce`，只保留 150ms 淡入淡出，不拦截导航，不隐藏 reveal 元素） |
| reduced-motion | `shard-theme.css` 已有全局规则把动画 / 过渡压到 `.01ms`；`boot.js` 在 reduced 下不加 `html.sd-reveal`，因此内容不会被隐藏 |

## 8. 无障碍与响应式底线

- 正文与背景对比度 ≥4.5:1（大字 ≥3:1）。红字不放蓝底；小字不放红底。
- 每个可交互元素都有可见焦点。普通元素 `outline: 3px solid var(--focus-ring); outline-offset: 3px`；被切角的元素（`.sd-act .sd-btn .sd-chip .sd-corner` 页脚链接）用 `outline-offset: -6px` 加底色翻转。
- 触控目标 ≥44px 高；键盘能走完所有功能；叠层（菜单）要圈住 Tab、Esc 关闭、焦点回到触发按钮、背景 `inert`（`shell.js` 已实现）。
- 页面第一个可聚焦元素是“跳到主要内容”；有且只有一个 `<main>` 和一个 `<h1>`；`<html lang="zh-CN">`。
- 断点沿用首页：`1099px`、`699px`。各宽度（390 / 768 / 1024 / 1366 / 1920）无横向滚动条。
- 装饰元素（英文大字、字幕条、点）加 `aria-hidden="true"`；图标按钮必须有 `aria-label`。
- `forced-colors: active` 下焦点用 `Highlight`，组件补 1px 边框（`shard-theme.css` 已处理）。
- 全站完整的无障碍验证需要真实辅助技术和人工评审，脚本只覆盖可自动判定的部分。

## 9. 新页面最小模板

放在仓库根的一级目录（如 `foo/index.html`）。`<base href="../">` 让 `site/…` 相对根目录解析；放在根目录时去掉 `<base>`。

```html
<!doctype html>
<html lang="zh-CN" class="shard-live" data-theme="day">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <base href="../">
  <meta name="theme-color" content="#F4F6FF">
  <meta name="description" content="一句话说明本页。">
  <title>页面名 · Springhues</title>
  <link rel="icon" type="image/png" href="brand-assets/springhues-logo.png">
  <!-- 主题防闪：同步执行；读取 springhues.home.theme，默认跟随系统 -->
  <script src="site/boot.js?v=20261018-shard-v4"></script>
  <link rel="stylesheet" href="site/css/shard-theme.css?v=20261018-shard-v4">
  <link rel="stylesheet" href="site/css/wipe.css?v=20261018-shard-v4">
  <!-- 页面专属样式（可选）：规则都以 html.shard-live 开头 -->
  <link rel="stylesheet" href="site/css/pages-foo.css?v=20261018-shard-v4">
  <!-- 外壳脚本：注入页首 / 菜单 / 页脚，接管主题切换与擦屏过渡 -->
  <script type="module" src="site/js/shell/shell.js?v=20261018-shard-v4"></script>
</head>
<body data-site-page="foo" data-sd-title="页面名" data-sd-title-en="FOO">
  <main id="main" class="sd-page" tabindex="-1">
    <header class="sd-hero">
      <div class="sd-wrap">
        <p class="sd-eyebrow">FOO</p>
        <h1 class="sd-h1"><span class="en" aria-hidden="true">Foo</span><span class="cn">页面名</span></h1>
        <p class="sd-lead">一两句导语。</p>
      </div>
    </header>
    <div class="sd-wrap">
      <section class="sd-plate sd-plate--blade">
        <h2 class="sd-h2">内容标题</h2>
        <p>内容。</p>
      </section>
    </div>
    <noscript><p class="sd-note">当前浏览器未启用 JavaScript，页首与页脚导航不可用。<a href="./">返回首页</a></p></noscript>
  </main>
</body>
</html>
```

新增页面的收尾步骤：

1. 在 `site/js/shell/links.js` 的 `PAGES` 登记 `{ key: 'foo', no, cn, en, href: 'foo/' }`（菜单与页脚自动出现；**不得登记 admin 下的页面**）。
2. 在 `scripts/check-shard-style.mjs` 的 `SHARD_PAGES` 加入 `foo/index.html`；`scripts/build-site.mjs` 里 `foo` 目录要加入复制列表，`scripts/verify-build.mjs` 加存在断言。`site/` 下新增的文件随整目录复制，不需要改白名单。
3. 版本戳统一用 `SHARD_VERSION`；改了 `site/` 下任何文件就升级该常量并同步所有页面引用（首页 `index.html` 也一样）。`site/js` 内部模块互相 `import` 不带查询串。
4. 运行第 12 节的命令。

## 10. 如何新增作品 / 分类 / 载体

首页作品墙由 `site/works.json` 驱动，筛选栏、计数、命令面板都从清单生成。

**现状（第二轮精简后）**：筛选栏共 5 项 = `all`（全部，由代码提供）+ 4 个分类。

| 分类 id | 名称 | 默认载体 | 作品数 |
| --- | --- | --- | --- |
| `software` | 软件工具 | `window` | 2 |
| `game` | 游戏资源 | `shard` | 1 |
| `web` | 网页设计 | `browser` | 1 |
| `daily` | 每日简报 | `page` | 2 |

载体共 5 种：`phone`（手机屏）、`window`（桌面窗口）、`page`（日报纸页）、`shard`（切角碎片）、`browser`（带地址栏的浏览器窗口）。Android 作品属于 `software` 分类，但要显式写 `"carrier": "phone"` 才会用手机外形；Windows 软件用分类默认的 `window`；日报用 `page`；网页设计用 `browser`；游戏用 `shard`。载体名称未知时回退 `shard`（旧版里出现过的 `cartridge`、`tab`、`disc` 现在都回退为 `shard`，不是独立载体）。旧站的 `android / windows / mod` 分类链接由 `site/js/core/category.js` 的别名表映射到现分类。

**新增作品**：在 `works` 数组追加一项。必填 `slug`（小写字母数字加连字符）、`category`、`name`、`intro`、`links`；常用可选 `platform`（≤16 字）、`model`（≤40 字，详情面板显示「模型」）、`carrier`、`tags`、`version`、`updatedAt`、`isNew`、`cover`、`shots`、`layout.size`（`s/m/l`）、`prompt`（`works/<slug>/xxx.txt`，详情面板显示「复制提示词」按钮）。链接只允许站内相对路径或 HTTPS，且不得指向 `admin/`；暂时没有的链接写 `"#"`。示例：

```json
{
  "slug": "windows-my-tool",
  "category": "software",
  "name": "我的工具",
  "platform": "Windows",
  "intro": "一句话说明它解决什么问题。",
  "tags": ["Windows"],
  "links": [{ "kind": "download", "label": "下载", "href": "#" }],
  "layout": { "size": "m" }
}
```

**新增分类**：在 `categories` 追加 `{ id, name, en, carrier, accent: { surface, blade }, parallax, order }`。`accent.surface` 取 `klein-500 / klein-700 / klein-900 / white`；`blade` 是应用红刃的位置数组（`tag / outline / sweep / button`）。作品用到的分类若没登记，会合成一个默认分类。

**新增载体外形**：在 `site/js/carriers/` 新建模块（参照 `phone.js` / `shard.js`），在 `site/js/carriers/index.js` 里 `registerCarrier(type, carrier)`，再让分类或单个作品的 `carrier` 指向它。载体结构里 `.card-hit` 必须是**无后代**的整卡链接，卡内其他可交互元素只能是 `.card-link`（`test-home.mjs` 会检查）。

改完运行 `node scripts/test-home.mjs`（或整套 `node scripts/test-site.mjs`）与 `node scripts/verify-home-redesign.mjs --section=wall`。

## 11. 日报页特别约束摘要

日报 HTML / PNG 是“导出同源”的：每日制作用已安装技能里的 `render.mjs` 打开**真实线上页** `game/?date=…` 或 `minsheng/?date=…`，冻结 `Date`，把页面上下文里的规范 CSS 内联后整页截图。所以线上页怎么改，PNG 就可能怎么变。

- **导出消费、不可修改**：`styles.css`、`minsheng/styles.css`、`brand.css`、`minsheng/mobile-fix.css`、`minsheng/aligned-layout.css`、`minsheng/message-link.css`、`site-shell.js`、根级 `app.js`、`minsheng/app.js`，以及 `game/index.html`、`minsheng/index.html` 的正文结构（这两个 HTML 只允许在 `<head>` 末尾追加外壳引用，且写在同一行以免多出空白节点）。`site-shell.js` 与 `brand.css` 同时被 `admin/` 使用，所以也保持字节不变，它们的 `?v=` 戳不动。
- **导出运行时不启用外壳**：`site/boot.js` 第一行判断 `Date.name !== 'Date'`（导出器把 `Date` 换成了 `FixedDate`）就直接返回，页面不会带 `html.shard-live`，`shell.js` 立即退出（零 DOM、零副作用），`shard-theme.css` 与 `pages-daily.css` 的规则因为全部以 `html.shard-live` 开头而不生效。`__SHARD_FORCE__` 只供本地验收脚本注入。
- **线上外壳层的权限**：`site/css/pages-daily.css` 只能改颜色、背景、边框颜色、`border-radius → 0`、切角 `clip-path`、页首页脚与外壳；不能改字体、字号、行高、`padding`、列宽、网格，不能碰 `.story`、`.metric`、`.news-column` 的高度相关属性。民生页桌面（≥1501px）的逐行对齐（`alignStoryRows()`）与 ≤1180px / ≤720px 的 `height: auto !important` 重置必须在线上同时有效；导出关键样式继续保留在 `minsheng/mobile-fix.css`。
- **夜间**：日报正文保持冷白纸面（画在 `main::before` 上，不改变任何盒子尺寸）。理由是日报本质是可打印成品，且有大量硬编码浅色。
- **不能动的行为**：`?date=YYYY-MM-DD` 的有效 / 无效 / 未到发布时刻回退；`#downloadPng` 指向当前期 PNG 并带 `download`；外链 `rel="noopener noreferrer"`；原始来源链接；民生“（来自于外网）”标识；归档弹窗；`publishAt` 过滤。
- **守卫**：`node scripts/check-export-parity.mjs --channel=both` 用真实导出器分别渲染“基线（`git archive HEAD`）”与“当前树”，要求 HTML 快照和 PNG 完全一致；只写系统临时目录。改了导出器或日报页之后必须重跑。

## 12. 验收自检清单与命令

自检清单：

- [ ] 页面引用了 `shard-theme.css`（带 `SHARD_VERSION`），新页面有 `html.shard-live`、`boot.js`、`shell.js`。
- [ ] 没有非零 `border-radius`（只有 `.sd-dot / .sd-avatar` 等例外），没有渐变滥用，没有 CDN / 外部字体 / emoji 图标。
- [ ] 蓝约 60%、冷白约 30%、红 ≤10% 且只当刃；红字只在白底。
- [ ] 页首（logo 返回首页、菜单、主题切换）与页脚（五项，无 admin）齐全；主题键是 `springhues.home.theme`，日夜两套都看过。
- [ ] 键盘走一遍：焦点可见、菜单圈住 Tab、Esc 关闭；各宽度无横向滚动；对比度 ≥4.5:1。
- [ ] reduced-motion 下无依赖动画的内容隐藏；动画失败时页面照常可用、链接照常跳转。
- [ ] 没有链接到 `admin/`；没有改 `message-config.js`、`supabase/`、`data/`。
- [ ] 日报页：导出消费文件无改动（`git diff --name-only` 里没有它们），`check-export-parity` 一致。
- [ ] 读过 4 页 × 日 / 夜 × 桌面 / 手机的截图（`.agents/tasks/site-redesign/screenshots/pages/`）。

命令（在仓库根执行）：

```powershell
node scripts/check-shard-style.mjs                      # 样式检查；可附文件名只检查指定文件；--self-test 只跑自测
node scripts/test-site.mjs                             # 站点单测（含 test-home：纯函数、静态检查、boot.js 守卫、shell 零副作用）
node scripts/test-messages.mjs                         # 留言系统与隐私说明
node scripts/verify-home-redesign.mjs --section=pages  # 子页面浏览器验收（需要本机 Edge；--section=all 含首页全部分区）
node scripts/check-export-parity.mjs --channel=both    # 日报导出一致性（仅日报页相关改动需要）
node scripts/build-site.mjs; node scripts/verify-build.mjs   # 构建与产物校验（运行前确认 dist 不存在，跑完删除 dist）
git diff --check
```
`check-shard-style.mjs` 检查：非零圆角、命名色、`NO_HEX` 文件（`pages-messages.css`、`pages-privacy.css`）里的十六进制色值、`pages-daily.css` / `shard-theme.css` 里未以 `html.shard-live` 开头的规则、未定义的 `var(--x)`、tokens.css 与 shard-theme.css 的 token 值是否一致、页面是否引用 `shard-theme.css`、`site/` 资源的 `?v=` 是否等于 `SHARD_VERSION`。`brand.css`、`styles.css`、`minsheng/*.css`、`portal.css`、`home.css`、`admin/` 属于被日报导出或后台消费的旧样式，不扫描也不修改。

> 关于旧文档：`docs/website-change-history.md` 与 `.agents/` 下早期设计文档保持原样，仅作历史；其中关于旧版动画库、7 个分类、收藏功能的描述已被本规范取代。
