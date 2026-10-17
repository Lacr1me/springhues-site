// 日报导出一致性检查：证明线上 SHARD 外壳不改变日报导出结果。
//   node scripts/check-export-parity.mjs [--channel=game|minsheng|both] [--baseline-ref=HEAD] [--scale=1] [--retries=4] [--keep]
// 做法：用已安装技能里的真实 render.mjs（和每日制作用的是同一个导出器），分别对“基线树”（git archive <ref>）与“当前树”（本工作区）
// 渲染最新一期，比较 HTML 快照的 sha256 与 PNG（先比哈希，不等再逐像素）。两者必须完全一致。
// 只写系统临时目录：不碰 artifacts/ downloads/ data/，不获取租约，不检索新闻，不发布。结束清理（--keep 保留以便排查）。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const channels = args.channel && args.channel !== 'both' ? [args.channel] : ['game', 'minsheng'];
const ref = args['baseline-ref'] || 'HEAD';
const scale = args.scale || '1';
const SKILLS = {
  game: path.join(os.homedir(), '.codex', 'skills', 'artifact-template-minecraft-daily-brief', 'scripts', 'render.mjs'),
  minsheng: path.join(os.homedir(), '.codex', 'skills', 'artifact-template-daily-brief', 'scripts', 'render.mjs')
};
// 导出消费的全部文件（见 docs/shard-style.md §11）。基线树只需要这些。
const PATHS = ['game', 'minsheng', 'app.js', 'styles.css', 'brand.css', 'site-shell.js', 'brand-assets', 'game-brief-assets', 'data', 'scripts/game-lib.mjs', 'scripts/minsheng-lib.mjs', 'scripts/source-registry.mjs'];
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
// HTML 快照里归档链接带本地服务器的随机端口（render.mjs 用端口 0），比较前归一化；其余字节必须相同。
const shaHtml = file => createHash('sha256').update(readFileSync(file, 'utf8').replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:PORT')).digest('hex');

for (const c of channels) if (!existsSync(SKILLS[c])) { console.error(`缺少导出器：${SKILLS[c]}`); process.exit(2); }
const tmp = path.join(os.tmpdir(), `shard-parity-${Date.now()}`);
const baseTree = path.join(tmp, 'baseline');
mkdirSync(baseTree, { recursive: true });
try {
  const tar = path.join(tmp, 'base.tar');
  let r = spawnSync('git', ['-C', root, 'archive', '--format=tar', '-o', tar, ref, '--', ...PATHS], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('git archive 失败：' + r.stderr);
  r = spawnSync('tar', ['-xf', tar, '-C', baseTree], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('解包基线树失败：' + r.stderr);

  let sharp = null;
  try {
    const base = path.join(os.homedir(), '.cache', 'codex-runtimes');
    for (const d of readdirSync(base)) {
      const p = path.join(base, d, 'dependencies', 'node', 'node_modules', 'sharp', 'dist', 'index.mjs');
      if (!sharp && existsSync(p)) sharp = (await import(pathToFileURL(p).href)).default;
    }
  } catch { /* 没有 sharp 时只比哈希 */ }

  const results = [];
  for (const channel of channels) {
    const manifestFile = channel === 'game' ? 'data/index.json' : 'data/minsheng/index.json';
    const editions = JSON.parse(readFileSync(path.join(root, manifestFile), 'utf8')).editions.filter(e => Date.parse(e.publishAt) <= Date.now()).sort((a, b) => b.date.localeCompare(a.date));
    const date = editions[0].date;
    const renderOnce = async (label, tree, n) => {
      const dir = path.join(tmp, `${channel}-${label}-${n}`);
      mkdirSync(dir, { recursive: true });
      const brief = path.join(tree, channel === 'game' ? 'data' : path.join('data', 'minsheng'), `${date}.json`);
      const run = spawnSync(process.execPath, [SKILLS[channel], '--project-root', tree, '--brief', brief, '--html-out', path.join(dir, 'x.html'), '--png-out', path.join(dir, 'x.png'), '--scale', scale, '--validate', 'false'], { encoding: 'utf8', timeout: 600000 });
      if (run.status !== 0) throw new Error(`${channel}/${label} 导出失败：\n${(run.stderr || run.stdout).slice(-1500)}`);
      return { html: path.join(dir, 'x.html'), png: path.join(dir, 'x.png') };
    };
    // 比较两张 PNG：返回 { same, detail }
    const comparePng = async (x, y) => {
      if (sha(x) === sha(y)) return { same: true, detail: '字节相同' };
      if (!sharp) return { same: false, detail: 'PNG 哈希不同（无 sharp，未做像素比较）' };
      const a = await sharp(x).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const b = await sharp(y).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (a.info.width !== b.info.width || a.info.height !== b.info.height) return { same: false, detail: `尺寸不同 ${a.info.width}x${a.info.height} vs ${b.info.width}x${b.info.height}` };
      let diff = 0;
      for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) diff++;
      return { same: diff === 0, detail: diff === 0 ? '字节相同' : `像素差异通道数 ${diff}` };
    };
    // 游戏导出器自身不是完全确定的（同一份代码渲染两次，PNG 偶尔有少量像素差异）。
    // 所以 PNG 不一致时：先重试当前树，并渲染第二份基线作对照；只要当前树在重试内与任一基线渲染字节相同即视为一致。
    const retries = Math.max(1, Number(args.retries) || 4);
    const base = [await renderOnce('baseline', baseTree, 0)];
    let htmlSame = true, pngSame = false, detail = '', attempts = 0, control = '';
    for (let n = 0; n < retries && !pngSame; n++) {
      const cur = await renderOnce('current', root, n);
      attempts++;
      htmlSame = htmlSame && shaHtml(base[0].html) === shaHtml(cur.html);
      for (const b of base) {
        const r = await comparePng(b.png, cur.png);
        detail = r.detail;
        if (r.same) { pngSame = true; break; }
      }
      if (!pngSame && base.length === 1) {
        base.push(await renderOnce('baseline', baseTree, 1));
        const c = await comparePng(base[0].png, base[1].png);
        control = c.same ? '基线对基线字节相同' : `基线对基线也不同（${c.detail}），导出器自身存在不确定性`;
      }
    }
    if (attempts > 1 || control) detail += `；重试 ${attempts} 次${control ? '；' + control : ''}`;
    results.push({ channel, date, htmlSame, pngSame, detail });
    console.log(`${channel} ${date}：HTML 快照${htmlSame ? '一致' : '不一致'}；PNG ${pngSame ? '一致' : '不一致'}（${detail}）`);
  }  const ok = results.every(r => r.htmlSame && r.pngSame);
  console.log(ok ? `导出一致：${results.map(r => r.channel).join('、')} 的 HTML 与 PNG 与基线（${ref}）逐字节/逐像素相同。` : '导出不一致：HTML 快照不同，或 PNG 在重试内始终与基线（含对照基线）不同。先看上面的“对照”信息，区分外壳影响与导出器自身抖动。');
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  console.error(e.message);
  process.exitCode = 2;
} finally {
  if (args.keep) console.log('已保留临时目录：' + tmp); else rmSync(tmp, { recursive: true, force: true });
}
