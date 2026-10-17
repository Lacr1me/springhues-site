// 首页主视觉衍生图管线。
//   node scripts/build-hero-assets.mjs            生成 assets/hero/web/*、site/css/hero-lqip.css（需要 Playwright + Edge，只在开发机运行）
//   node scripts/build-hero-assets.mjs --palette  输出调色板直方图与蓝/白/红/墨家族占比（同上）
//   node scripts/build-hero-assets.mjs --check    纯 Node 校验产物（文件名 ASCII、体积上限、像素尺寸），CI 可用
// 模块顶层不依赖 Playwright：只有生成与 --palette 分支会动态 import。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classifyFamilies } from './color-family.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(root, 'assets', 'hero', '风格化.jpeg');
const OUT = path.join(root, 'assets', 'hero', 'web');
const LQIP_CSS = path.join(root, 'site', 'css', 'hero-lqip.css');

// 横向 6 档与竖屏裁切 6 档。webp 首屏图必须 < 400KB（实现上限 380000 字节）。
const WEBP_HARD = 380000;
export const TARGETS = [
  { name: 'hero-2560', w: 2560, h: 1460, webp: WEBP_HARD, jpg: 600e3 },
  { name: 'hero-1600', w: 1600, h: 913, webp: 250e3, jpg: 350e3 },
  { name: 'hero-960', w: 960, h: 548, webp: 150e3, jpg: 200e3 },
  { name: 'hero-p-1638', w: 1638, h: 2336, webp: WEBP_HARD, jpg: 600e3, crop: true },
  { name: 'hero-p-1080', w: 1080, h: 1540, webp: 250e3, jpg: 350e3, crop: true },
  { name: 'hero-p-720', w: 720, h: 1027, webp: 150e3, jpg: 200e3, crop: true }
];
const CROP = { x: 1147, w: 1638 }; // 原图 x∈[0.28,0.68]，高度全取

// ---------- 纯 Node：产物校验 ----------
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('不是 JPEG');
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('JPEG 缺少 SOF 段');
}
function webpSize(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') throw new Error('不是 WebP');
  const kind = buf.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8X') return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
  throw new Error('未知 WebP 块 ' + kind);
}
export async function checkHeroAssets(dir = OUT) {
  const errors = [];
  for (const t of TARGETS) {
    for (const [ext, limit, sizer] of [['webp', t.webp, webpSize], ['jpg', t.jpg, jpegSize]]) {
      const file = `${t.name}.${ext}`;
      if (!/^[\x20-\x7e]+$/.test(file)) errors.push(file + ' 文件名不是 ASCII');
      let buf;
      try { buf = await fs.readFile(path.join(dir, file)); } catch { errors.push(file + ' 不存在'); continue; }
      if (buf.length > limit) errors.push(`${file} 体积 ${buf.length} 超过上限 ${limit}`);
      try {
        const s = sizer(buf);
        if (s.w !== t.w || s.h !== t.h) errors.push(`${file} 尺寸 ${s.w}x${s.h}，应为 ${t.w}x${t.h}`);
      } catch (e) { errors.push(`${file} 无法解析：${e.message}`); }
    }
  }
  try {
    const lq = await fs.readFile(path.join(dir, 'hero-lqip.jpg'));
    const s = jpegSize(lq);
    if (s.w !== 32 || s.h !== 18) errors.push('hero-lqip.jpg 应为 32x18');
    if (lq.length > 2000) errors.push('hero-lqip.jpg 过大');
  } catch { errors.push('hero-lqip.jpg 缺失或无法解析'); }
  return { ok: errors.length === 0, errors };
}

// ---------- 开发机：生成与采样 ----------
async function openBrowser() {
  const { loadPlaywright } = await import('./collect-steam-discovery.mjs');
  const playwright = await loadPlaywright();
  const browser = await playwright.chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage();
  await page.goto('about:blank');
  const b64 = (await fs.readFile(SOURCE)).toString('base64');
  await page.evaluate(async data => {
    const img = new Image();
    img.src = 'data:image/jpeg;base64,' + data;
    await img.decode();
    window.__src = img;
  }, b64);
  return { browser, page };
}
async function render(page, spec, mime, quality) {
  const data = await page.evaluate(({ spec, mime, quality, crop }) => {
    const img = window.__src;
    const c = document.createElement('canvas');
    c.width = spec.w; c.height = spec.h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    if (spec.crop) g.drawImage(img, crop.x, 0, crop.w, img.naturalHeight, 0, 0, spec.w, spec.h);
    else g.drawImage(img, 0, 0, spec.w, spec.h);
    return c.toDataURL(mime, quality).split(',')[1];
  }, { spec, mime, quality, crop: CROP });
  return Buffer.from(data, 'base64');
}
async function generate() {
  await fs.mkdir(OUT, { recursive: true });
  const { browser, page } = await openBrowser();
  try {
    for (const t of TARGETS) {
      for (const [ext, mime, limit] of [['webp', 'image/webp', t.webp], ['jpg', 'image/jpeg', t.jpg]]) {
        let done = null;
        for (const q of [0.82, 0.76, 0.7, 0.62, 0.55]) {
          const buf = await render(page, t, mime, q);
          if (buf.length <= limit) { done = { buf, q }; break; }
        }
        if (!done) throw new Error(`${t.name}.${ext} 在最低质量下仍超过 ${limit} 字节`);
        await fs.writeFile(path.join(OUT, `${t.name}.${ext}`), done.buf);
        console.log(`${t.name}.${ext}  q=${done.q}  ${done.buf.length}B`);
      }
    }
    const lq = await render(page, { w: 32, h: 18 }, 'image/jpeg', 0.6);
    await fs.writeFile(path.join(OUT, 'hero-lqip.jpg'), lq);
    await fs.mkdir(path.dirname(LQIP_CSS), { recursive: true });
    await fs.writeFile(LQIP_CSS, `/* 生成文件：node scripts/build-hero-assets.mjs。32x18 模糊占位，内联避免首屏空白 */\n:root{--hero-lqip:url("data:image/jpeg;base64,${lq.toString('base64')}")}\n`);
    console.log('hero-lqip.jpg', lq.length + 'B');
  } finally { await browser.close(); }
}
async function palette() {
  const { browser, page } = await openBrowser();
  try {
    const rgbaB64 = await page.evaluate(() => {
      const img = window.__src;
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const { data } = g.getImageData(0, 0, c.width, c.height);
      const out = [];
      for (let y = 0; y < c.height; y += 8) for (let x = 0; x < c.width; x += 8) {
        const i = (y * c.width + x) * 4;
        out.push(data[i], data[i + 1], data[i + 2], 255);
      }
      let s = '';
      for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode.apply(null, out.slice(i, i + 8192));
      return btoa(s);
    });
    const raw = Buffer.from(rgbaB64, 'base64');
    const buckets = new Map();
    for (let i = 0; i < raw.length; i += 4) {
      const key = (raw[i] >> 5) << 6 | (raw[i + 1] >> 5) << 3 | (raw[i + 2] >> 5);
      const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      b.n++; b.r += raw[i]; b.g += raw[i + 1]; b.b += raw[i + 2];
      buckets.set(key, b);
    }
    const hex = v => Math.round(v).toString(16).padStart(2, '0');
    const top = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 12)
      .map(b => `#${hex(b.r / b.n)}${hex(b.g / b.n)}${hex(b.b / b.n)}`.toUpperCase() + `  n=${b.n}`);
    console.log('样本点数', raw.length / 4);
    console.log('桶均值（前 12）\n' + top.join('\n'));
    const fam = classifyFamilies(raw);
    console.log('家族占比 %', JSON.stringify(fam.pct));
  } finally { await browser.close(); }
}

const arg = process.argv[2];
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (arg === '--check') {
    const r = await checkHeroAssets();
    if (!r.ok) { console.error(r.errors.join('\n')); process.exit(1); }
    console.log('主视觉衍生图校验通过');
  } else if (arg === '--palette') await palette();
  else await generate();
}
