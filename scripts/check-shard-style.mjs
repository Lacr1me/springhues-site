// SHARD 风格检查器（纯 Node，无依赖）。AI 或人类配置新页面后运行：
//   node scripts/check-shard-style.mjs                 检查整个仓库的受管文件（CI：test-site.mjs 会调用 checkShardStyle）
//   node scripts/check-shard-style.mjs path/a.html path/b.css   只检查给定文件（相对仓库根或绝对路径）
//   node scripts/check-shard-style.mjs --self-test     只跑内置自测
//   选项：--root=<仓库根>  --json（机器可读输出）
// 有 error 时退出码为 1。规则与取值见 docs/shard-style.md。
//
// 规则：
//   1. 非零圆角：border-radius / border-*-radius 不是 0 即错；白名单 RADIUS_ALLOW（.sd-dot、.sd-avatar，值限 50%）。
//   2. 门控：GATED 文件（shard-theme.css、pages-daily.css）里每条顶层规则的选择器必须以 html.shard-live 开头
//      （@font-face / @keyframes 除外）——这是日报导出同源的保证：导出运行时页面没有 shard-live。
//   3. 未定义 token：var(--x)（无 fallback）必须在 site/css/*.css 中定义，或属于 JS_VARS / site/js 里 setProperty 过的变量。
//   4. token 一致性：shard-theme.css 里与 tokens.css 同名的变量（日/夜两套）值必须完全相同。
//   5. 页面引用：SHARD_PAGES 必须引用 site/css/shard-theme.css?v=SHARD_VERSION；任何含 data-sd-page 或 sd-top 的页面同理。
//   6. 版本戳：页面里对 site/** 资源的 ?v= 必须等于 SHARD_VERSION（portal-data.js 例外）。
//   7. 硬编码颜色：site/css 里颜色类属性不得用命名色（red、blue、white 等）；NO_HEX 文件（pages-messages.css、pages-privacy.css）另禁十六进制色值。
//      shard-theme.css / tokens.css 定义 token，pages-daily.css 里日报冷白纸面等固定色允许十六进制。
// 范围：OWNED = site/css/*.css。FROZEN_LEGACY（不扫、不改，被日报导出或后台消费）见下。
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHARD_VERSION = '20261018-shard-v4';
export const SHARD_PAGES = ['messages/index.html', 'privacy/index.html', 'game/index.html', 'minsheng/index.html'];
export const GATED = ['site/css/shard-theme.css', 'site/css/pages-daily.css'];
// 这些文件的颜色必须全部来自 var(--token)，不得写十六进制色值。
export const NO_HEX = ['site/css/pages-messages.css', 'site/css/pages-privacy.css'];
const NAMED_COLORS = 'red|blue|white|black|green|yellow|orange|purple|pink|gray|grey|navy|crimson|maroon|silver|gold|brown|cyan|magenta|teal|olive|lime|aqua|fuchsia|indigo|violet|beige|ivory|coral|salmon|tomato|skyblue|royalblue|darkblue|lightblue|darkred|firebrick';
const COLOR_PROP = /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-color)?)?(?:-color)?|outline(?:-color)?|box-shadow|text-shadow|fill|stroke|caret-color|accent-color|text-decoration(?:-color)?|column-rule(?:-color)?)$/;
const NAMED_RE = new RegExp('(?<![\\w-])(?:' + NAMED_COLORS + ')(?![\\w-])', 'i');
// 必须圆的元素（状态点、头像）。选择器正则 + 允许的值。
export const RADIUS_ALLOW = [{ selector: /(^|[\s>+~,.])\.sd-dot\b/, value: /^50%$/ }, { selector: /(^|[\s>+~,.])\.sd-avatar\b/, value: /^50%$/ }];
// 首页走 tokens.css 模块化样式（不引 shard-theme.css）；admin 是后台，不改。
export const EXEMPT_SHARD_REF = ['index.html'];
// 被日报导出器或后台消费的旧样式：不扫描、不修改。
export const FROZEN_LEGACY = ['brand.css', 'styles.css', 'portal.css', 'home.css', 'site-shell.js', 'minsheng/', 'admin/'];
// 由脚本写入的变量（element.style.setProperty / 内联 style），CSS 里只读不定义。
export const JS_VARS = ['--cols', '--rows', '--tilt', '--dx', '--dy', '--press', '--p', '--r', '--ar', '--k', '--ki', '--shape', '--shape-in', '--face-bg', '--face-fg', '--edge-c', '--glare-x', '--glare-y', '--tilt-x', '--tilt-y', '--py', '--G', '--accent', '--shot-ratio'];
const SKIP_DIRS = new Set(['admin', 'works', 'dist', '.agents', '.worktrees', '.git', 'node_modules', 'output', 'offline-homepage-editor', 'downloads', 'data', 'artifacts', 'vendor', 'assets', 'brand-assets', 'game-brief-assets', 'daily-brief-template-package', '.codex', '.tools', '.github', 'docs', 'supabase', 'scripts']);

// ---------------------------------------------------------------- CSS 解析（够用的小解析器）
export function stripComments(css) { return css.replace(/\/\*[\s\S]*?\*\//g, ''); }
function splitTop(text, sep) {
  const parts = []; let depth = 0, q = null, cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { cur += ch; if (ch === '\\') { cur += text[++i] ?? ''; } else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth <= 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}
function parseDecls(body) {
  const out = [];
  for (const part of splitTop(body, ';')) {
    const i = part.indexOf(':');
    if (i < 1) continue;
    out.push({ prop: part.slice(0, i).trim().toLowerCase(), value: part.slice(i + 1).trim().replace(/\s+/g, ' ') });
  }
  return out;
}
// 返回 [{ selector, decls, parents, atRule }]；@media / @supports / @layer 递归，其余 at 规则（font-face、keyframes）标记 atRule。
export function parseCss(src, parents = []) {
  const css = parents.length ? src : stripComments(src);
  const rules = [];
  let i = 0;
  while (i < css.length) {
    let depth = 0, q = null, s = i;
    for (; i < css.length; i++) {
      const ch = css[i];
      if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (ch === '(') depth++; else if (ch === ')') depth--;
      else if (depth <= 0 && (ch === '{' || ch === ';' || ch === '}')) break;
    }
    const prelude = css.slice(s, i).trim();
    if (css[i] !== '{') { i++; continue; }
    i++;
    let d = 1; q = null; const bs = i;
    for (; i < css.length && d > 0; i++) {
      const ch = css[i];
      if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (ch === '{') d++; else if (ch === '}') d--;
    }
    const body = css.slice(bs, i - 1);
    if (!prelude) continue;
    if (prelude.startsWith('@')) {
      if (/^@(media|supports|layer|container)\b/i.test(prelude)) rules.push(...parseCss(body, [...parents, prelude]));
      else rules.push({ selector: prelude, decls: /^@font-face/i.test(prelude) ? parseDecls(body) : [], parents, atRule: true });
    } else rules.push({ selector: prelude.replace(/\s+/g, ' '), decls: parseDecls(body), parents, atRule: false });
  }
  return rules;
}

const ZERO = /^0(?:px|%|em|rem)?$/;
const isZeroRadius = value => value.replace(/!important/i, '').trim().split(/[\s/]+/).every(t => ZERO.test(t));
const RADIUS_PROP = /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$|^border-radius$/;

// ---------------------------------------------------------------- 扫描
// ctx: { definedTokens:Set, gated:boolean }
export function scanCss(text, file = '<css>', ctx = {}) {
  const errors = [], warnings = [];
  const rules = parseCss(text);
  for (const r of rules) {
    if (r.atRule) continue;
    for (const d of r.decls) {
      if (RADIUS_PROP.test(d.prop) && !isZeroRadius(d.value)) {
        const v = d.value.replace(/!important/i, '').trim();
        const allowed = RADIUS_ALLOW.some(a => a.selector.test(r.selector) && a.value.test(v));
        if (!allowed) errors.push(`${file}: 非零圆角 ${r.selector} { ${d.prop}: ${d.value} }（只允许 0；例外见 RADIUS_ALLOW）`);
      }
      if (COLOR_PROP.test(d.prop)) {
        const plain = d.value.replace(/url\([^)]*\)/gi, '').replace(/(["'])(?:\\.|(?!\1).)*\1/g, '');
        const named = NAMED_RE.exec(plain);
        if (named) errors.push(`${file}: 命名色 ${named[0]}（${r.selector}，${d.prop}）：颜色请用 var(--token)`);
        if (ctx.noHex && /#[0-9a-f]{3,8}\b/i.test(plain)) errors.push(`${file}: 十六进制色值（${r.selector}，${d.prop}）：本文件颜色必须全部用 var(--token)`);
      }
      if (ctx.definedTokens) {
        for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
          if (!m[2] && !ctx.definedTokens.has(m[1])) errors.push(`${file}: 未定义 token ${m[1]}（${r.selector}）`);
        }
      }
    }
    if (ctx.gated) {
      for (const sel of splitTop(r.selector, ',')) {
        if (!/^\s*html\.shard-live(?![\w-])/.test(sel)) errors.push(`${file}: 未门控规则 “${sel.trim()}”（必须以 html.shard-live 开头，保证日报导出时不生效）`);
      }
    }
  }
  return { errors, warnings };
}

export function scanHtml(text, file = '<html>', ctx = {}) {
  const errors = [], warnings = [];
  const norm = file.replace(/\\/g, '/');
  const refs = [...text.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/g)].map(m => m[1]);
  const hasShardMarker = /data-sd-page|class="[^"]*\bsd-top\b/.test(text);
  const needsTheme = ctx.requireTheme ?? (SHARD_PAGES.includes(norm) || hasShardMarker);
  if (needsTheme && !refs.some(r => r.includes('site/css/shard-theme.css'))) errors.push(`${file}: 未引用 site/css/shard-theme.css?v=${SHARD_VERSION}`);
  if (needsTheme && !refs.some(r => r.includes('site/boot.js'))) warnings.push(`${file}: 未引用 site/boot.js（主题防闪与导出守卫）`);
  for (const r of refs) {
    if (!/(?:^|\/)site\/(?:css\/|js\/|boot\.js)/.test(r)) continue;
    const v = /[?&]v=([^&#]+)/.exec(r);
    if (!v || v[1] !== SHARD_VERSION) errors.push(`${file}: ${r} 的版本戳应为 ?v=${SHARD_VERSION}`);
  }
  for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const r = scanCss(m[1], file + '<style>', ctx.cssCtx || {});
    errors.push(...r.errors); warnings.push(...r.warnings);
  }
  for (const m of text.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)) {
    for (const d of parseDecls(m[1])) if (RADIUS_PROP.test(d.prop) && !isZeroRadius(d.value)) errors.push(`${file}: 内联样式出现非零圆角 ${d.prop}: ${d.value}`);
  }
  return { errors, warnings };
}

// token 一致性：tokens.css（首页）与 shard-theme.css（子页面）的同名变量值必须完全相同。
export function checkTokenParity(tokensCss, themeCss) {
  const errors = [];
  const pick = css => {
    const map = new Map();
    for (const r of parseCss(css)) if (!r.atRule) for (const sel of splitTop(r.selector, ',')) {
      const key = sel.trim().replace(/^html\.shard-live/, ':root');
      if (!/^:root(\[data-theme="(?:day|night)"\])?$/.test(key)) continue;
      for (const d of r.decls) if (d.prop.startsWith('--')) map.set(key + '|' + d.prop, d.value.toLowerCase());
    }
    return map;
  };
  const a = pick(tokensCss), b = pick(themeCss);
  for (const [k, v] of a) {
    if (!b.has(k)) errors.push(`shard-theme.css 缺少 tokens.css 的变量 ${k.replace('|', ' ')}`);
    else if (b.get(k) !== v) errors.push(`token 值不一致 ${k.replace('|', ' ')}：tokens.css=${v}，shard-theme.css=${b.get(k)}`);
  }
  return errors;
}

// ---------------------------------------------------------------- 仓库级检查
async function readText(file) { return readFile(file, 'utf8'); }
async function exists(p) { try { await stat(p); return true; } catch { return false; } }
async function walk(dir, ext, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, ext, out);
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out;
}
async function collectTokens(root) {
  const defined = new Set(JS_VARS);
  for (const f of await walk(path.join(root, 'site', 'css'), '.css')) {
    for (const m of (await readText(f)).matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  }
  for (const f of await walk(path.join(root, 'site', 'js'), '.js')) {
    for (const m of (await readText(f)).matchAll(/['"`](--[\w-]+)['"`:]/g)) defined.add(m[1]);
  }
  return defined;
}
async function pageCandidates(root) {
  const out = [];
  const top = await readdir(root, { withFileTypes: true });
  for (const e of top) {
    if (e.isFile() && e.name === 'index.html') out.push(path.join(root, e.name));
    if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) out.push(...await walk(path.join(root, e.name), '.html'));
  }
  return out;
}

export async function checkShardStyle({ root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), files = null } = {}) {
  const errors = [], warnings = [];
  const definedTokens = await collectTokens(root);
  const rel = f => path.relative(root, f).replace(/\\/g, '/');
  const add = r => { errors.push(...r.errors); warnings.push(...r.warnings); };
  const cssFiles = files ? files.filter(f => f.endsWith('.css')) : await walk(path.join(root, 'site', 'css'), '.css');
  for (const f of cssFiles) {
    const r = rel(f);
    if (FROZEN_LEGACY.some(p => r === p || (p.endsWith('/') && r.startsWith(p)))) { warnings.push(`${r}: 属于被日报导出或后台消费的旧样式，已跳过`); continue; }
    add(scanCss(await readText(f), r, { definedTokens, gated: GATED.includes(r), noHex: NO_HEX.includes(r) }));
  }
  const htmlFiles = files ? files.filter(f => f.endsWith('.html')) : [...new Set([...SHARD_PAGES.map(p => path.join(root, p)), ...await pageCandidates(root)])];
  for (const f of htmlFiles) {
    const r = rel(f);
    if (!(await exists(f))) { errors.push(`${r}: 页面不存在`); continue; }
    if (r.startsWith('admin/')) continue;
    add(scanHtml(await readText(f), r, { requireTheme: EXEMPT_SHARD_REF.includes(r) ? false : undefined, cssCtx: { definedTokens } }));
  }
  if (!files) {
    const tokens = path.join(root, 'site', 'css', 'tokens.css'), theme = path.join(root, 'site', 'css', 'shard-theme.css');
    if (await exists(tokens) && await exists(theme)) errors.push(...checkTokenParity(await readText(tokens), await readText(theme)));
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------- 自测（由 test-home.mjs 调用）
export function selfTest() {
  const eq = (c, m) => { if (!c) throw new Error('check-shard-style 自测失败：' + m); };
  const defined = new Set(['--bg', '--sh-white']);
  eq(scanCss('.a{border-radius:8px}', 'x').errors.length === 1, '坏圆角应被抓');
  eq(scanCss('.a{border-top-left-radius:4px 2px}', 'x').errors.length === 1, '单角圆角应被抓');
  eq(scanCss('.a{border-radius:0 !important}.b{border-radius:0px 0 0 0}', 'x').errors.length === 0, '零圆角应放行');
  eq(scanCss('.sd-dot{border-radius:50%}', 'x').errors.length === 0, '白名单应放行');
  eq(scanCss('.sd-dot{border-radius:8px}', 'x').errors.length === 1, '白名单值限 50%');
  eq(scanCss('.card{border-radius:50%}', 'x').errors.length === 1, '非白名单 50% 应被抓');
  eq(scanCss('/* border-radius: 9px */ .a{color:inherit}', 'x').errors.length === 0, '注释里的圆角应忽略');
  eq(scanCss('.a{color:var(--nope)}', 'x', { definedTokens: defined }).errors.length === 1, '未定义 token 应被抓');
  eq(scanCss('.a{color:var(--nope, #fff);background:var(--bg)}', 'x', { definedTokens: defined }).errors.length === 0, 'fallback 与已定义 token 应放行');
  eq(scanCss('html.shard-live .a{color:red}', 'x').errors.length === 1, '命名色应被抓');
  eq(scanCss('html.shard-live .a{color:var(--bg);border:1px solid transparent;background:url(red.png)}', 'x').errors.length === 0, 'token、transparent、url 里的名字应放行');
  eq(scanCss('.a{color:#fff}', 'x', { noHex: true }).errors.length === 1, 'NO_HEX 文件的十六进制应被抓');
  eq(scanCss('.a{color:#fff}', 'x').errors.length === 0, '普通文件允许十六进制');
  eq(scanCss('.a{color:blue}', 'x', { gated: true }).errors.length === 2, '未门控 + 命名色各一条');
  eq(scanCss('.a{color:red}', 'x', { gated: true }).errors.length === 2, '未门控规则应被抓');
  eq(scanCss('@font-face{font-family:A}@keyframes k{to{opacity:1}}@media (max-width:9px){html.shard-live .a{color:inherit}}html.shard-live .b, html.shard-live .c{color:inherit}', 'x', { gated: true }).errors.length === 0, '门控规则与 at 规则应放行');
  eq(scanCss('@media (max-width:9px){.a{color:inherit}}', 'x', { gated: true }).errors.length === 1, 'media 内未门控规则应被抓');
  eq(scanHtml('<link href="site/css/pages-x.css?v=' + SHARD_VERSION + '">', 'messages/index.html').errors.length === 1, '未引用 shard-theme 应被抓');
  const good = `<link rel="stylesheet" href="site/css/shard-theme.css?v=${SHARD_VERSION}"><script src="site/boot.js?v=${SHARD_VERSION}"></script>`;
  eq(scanHtml(good, 'messages/index.html').errors.length === 0, '正确页面应通过');
  eq(scanHtml(good.replace(SHARD_VERSION, 'old'), 'messages/index.html').errors.length === 1, '旧版本戳应被抓');
  eq(scanHtml('<div class="sd-top"></div>', 'new/index.html').errors.length === 1, '含 sd-top 的页面必须引用 shard-theme');
  eq(scanHtml('<div style="border-radius:6px"></div>' + good, 'messages/index.html').errors.length === 1, '内联圆角应被抓');
  eq(scanHtml('<style>.a{border-radius:3px}</style>' + good, 'messages/index.html').errors.length === 1, '<style> 内圆角应被抓');
  const tk = ':root{--a:#FFF}:root[data-theme="day"]{--bg:#F4F6FF}';
  eq(checkTokenParity(tk, 'html.shard-live{--a:#fff}html.shard-live[data-theme="day"]{--bg:#F4F6FF}').length === 0, 'token 一致应通过');
  eq(checkTokenParity(tk, 'html.shard-live{--a:#fff}html.shard-live[data-theme="day"]{--bg:#000}').length === 1, 'token 不一致应被抓');
  eq(checkTokenParity(tk, 'html.shard-live{--a:#fff}').length === 1, '缺失 token 应被抓');
  return true;
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = Object.fromEntries(argv.filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
  const positional = argv.filter(a => !a.startsWith('--'));
  selfTest();
  if (opt['self-test']) { console.log('check-shard-style 自测通过'); process.exit(0); }
  const root = path.resolve(opt.root || path.dirname(fileURLToPath(import.meta.url)) + '/..');
  const files = positional.length ? positional.map(p => path.resolve(root, p)) : null;
  const r = await checkShardStyle({ root, files });
  if (opt.json) console.log(JSON.stringify(r, null, 2));
  else {
    for (const w of r.warnings) console.log('warn  ' + w);
    for (const e of r.errors) console.log('ERROR ' + e);
    console.log(r.errors.length ? `check-shard-style：${r.errors.length} 个错误` : `check-shard-style 通过（${files ? files.length + ' 个文件' : '整个仓库'}，${r.warnings.length} 条提示）`);
  }
  process.exit(r.errors.length ? 1 : 0);
}
