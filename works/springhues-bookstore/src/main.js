import * as THREE from '../vendor/three.module.min.js';
import { buildBookstore } from './bookstore.js';
import { buildSeasons } from './seasons.js';
import { buildVisitors } from './visitors.js';
import { loadStats } from './stats.js';

const $ = selector => document.querySelector(selector);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const stage = $('#stage');
const canvas = $('#world');
const status = $('#status');
const captions = {
  spring: ['01', '春日来信', '花瓣落在窗边<br>新故事正翻开第一页'],
  summer: ['02', '漫长夏日', '树影越过书页<br>把午后的时间留在这里'],
  autumn: ['03', '秋日书签', '捡起一片落叶<br>夹在还没读完的那一章'],
  winter: ['04', '雪夜灯火', '屋檐收下初雪<br>窗里的光替你留着']
};

const initialView = { azimuth: .74, polar: 1.12, zoom: 1 };
const state = { time: 'day', season: 'spring', door: false, reduced: reduced.matches, ready: false };
const desired = { ...initialView };
const view = { ...initialView };
let renderer, scene, camera, bookstore, seasons, visitors, root, shadow, key, ambient, rim;
let night = 0, opening = 0, entrance = 0, clock = 0, raf = 0, last = 0;
let inView = true, failed = false;
const target = new THREE.Vector3(0, 2.85, 0);
const pointers = new Map();
let previousPinch = 0;
let statsSnapshot = null, statsController = null, statsTimer = 0, lastStatsAttempt = 0;
let statsNeedsRefresh = false, pageLeaving = false;
let showVisitors = true;

const numberLabel = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('zh-CN') : '—';
const timeLabel = value => {
  if (typeof value !== 'string' || !value.trim()) return '未知时间';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date) : '未知时间';
};
function reflectStats() {
  const data = statsSnapshot;
  const count = data?.visitors ?? null;
  $('#visitorCount').textContent = numberLabel(count);
  $('#workCount').textContent = numberLabel(data?.catalog?.works);
  $('#archiveCount').textContent = numberLabel(data?.catalog?.archives);
  const periods = data?.periods;
  $('#periodStats').hidden = !periods;
  $('#weekCount').textContent = numberLabel(periods?.week);
  $('#monthCount').textContent = numberLabel(periods?.month);
  const stateName = data?.stale ? 'snapshot' : data?.status || 'unavailable';
  $('#dataState').dataset.state = stateName;
  $('#dataState span').textContent = data?.stale ? '刷新暂不可用 · 保留上次读取' : stateName === 'live' ? '已连接真实统计' : stateName === 'snapshot' ? '服务暂不可用 · 展示保存快照' : '统计暂不可用';
  if (count === null) $('#peopleMapping').textContent = '访客计数暂不可用 人物暂不显示';
  else if (count === 0) $('#peopleMapping').textContent = '当前计数为 0 书屋在等第一位访客';
  else if (!showVisitors) $('#peopleMapping').textContent = '人物已隐藏 真实统计仍保持更新';
  else if (count > 24) $('#peopleMapping').textContent = '以 24 位人物概括 ' + numberLabel(count) + ' 条访客计数';
  else $('#peopleMapping').textContent = numberLabel(count) + ' 位场景人物 对应 ' + numberLabel(count) + ' 条访客计数';
  $('#showVisitors').setAttribute('aria-pressed', String(showVisitors));
  $('#showVisitors').textContent = showVisitors ? '隐藏人物' : '显示人物';
  if (stateName === 'unavailable') $('#dataNote').textContent = '未取得有效访客计数 可稍后刷新重试';
  else if (data.source === 'static-snapshot') $('#dataNote').textContent = '快照读取于 ' + timeLabel(data.sourceUpdatedAt) + ' 北京时间';
  else $('#dataNote').textContent = '读取于 ' + timeLabel(data.fetchedAt) + ' 北京时间 · 每 5 分钟复查';
}
function scheduleStats() {
  clearTimeout(statsTimer);
  if (!document.hidden && !pageLeaving) statsTimer = setTimeout(refreshStats, 300000);
}
async function refreshStats() {
  if (statsController) return;
  const controller = new AbortController(); statsController = controller;
  statsNeedsRefresh = false;
  lastStatsAttempt = Date.now();
  $('#refreshStats').disabled = true; $('#refreshStats').setAttribute('aria-busy', 'true');
  try {
    const data = await loadStats({ signal: controller.signal });
    if (data.status === 'unavailable' && statsSnapshot?.visitors !== null && statsSnapshot?.visitors !== undefined) {
      statsSnapshot = { ...statsSnapshot, stale: true };
    } else statsSnapshot = data;
    visitors?.setCount(showVisitors ? statsSnapshot.visitors : null);
    reflectStats(); invalidate();
  } catch (error) {
    if (!controller.signal.aborted) {
      if (statsSnapshot) statsSnapshot = { ...statsSnapshot, stale: true };
      reflectStats();
    }
  } finally {
    if (controller.signal.aborted) statsNeedsRefresh = true;
    statsController = null;
    $('#refreshStats').disabled = false; $('#refreshStats').setAttribute('aria-busy', 'false');
    if (statsNeedsRefresh && !document.hidden && !pageLeaving) queueMicrotask(refreshStats);
    else scheduleStats();
  }
}
window.__BOOKSTORE_STATS = { refresh: refreshStats, get snapshot() { return statsSnapshot; } };

function announce(text) { status.textContent = text; }
function reflectUI() {
  for (const b of document.querySelectorAll('[data-time]')) {
    const active = b.dataset.time === state.time;
    b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active));
  }
  for (const b of document.querySelectorAll('button[data-season]')) {
    const active = b.dataset.season === state.season;
    b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active));
  }
  $('#doorButton').setAttribute('aria-pressed', String(state.door));
  $('#doorButton span').textContent = state.door ? '轻轻关门' : '推门看看';
  $('#sceneTime').textContent = state.time === 'day' ? 'DAYLIGHT' : 'AFTER HOURS';
  const [n, title, description] = captions[state.season];
  $('.season-index').innerHTML = n + ' <i>/ 04</i>';
  $('#seasonTitle').textContent = title;
  $('#seasonDescription').innerHTML = description;
  document.documentElement.dataset.theme = state.time;
  document.documentElement.dataset.season = state.season;
  $('meta[name="theme-color"]').content = state.time === 'day' ? '#F4F6FF' : '#0D1850';
}

function setTime(value) {
  if (!['day', 'night'].includes(value) || !state.ready) return;
  state.time = value;
  reflectUI(); invalidate();
  announce(value === 'day' ? '日间，灯光熄灭' : '夜晚，书屋亮灯');
}
function setSeason(value) {
  if (!captions[value] || !state.ready) return;
  state.season = value;
  seasons.setSeason(value, { immediate: reduced.matches });
  reflectUI();
  if (!reduced.matches) {
    const caption = $('.season-caption');
    caption.getAnimations().forEach(a => a.cancel());
    caption.animate([{ opacity: .25, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 450, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  invalidate(); announce(captions[value][1]);
}
function toggleDoor() {
  if (!state.ready) return;
  state.door = !state.door; reflectUI(); invalidate();
  announce(state.door ? '书店的双扇门向外打开' : '书店门已关闭');
}
function reset() {
  Object.assign(desired, initialView); target.set(0, 2.85, 0);
  invalidate(); announce('视角已复位');
}
function zoom(factor) { desired.zoom = THREE.MathUtils.clamp(desired.zoom * factor, .68, 1.85); invalidate(); }

function cameraUpdate() {
  const radius = 22;
  camera.position.set(target.x + radius * Math.sin(view.polar) * Math.sin(view.azimuth), target.y + radius * Math.cos(view.polar), target.z + radius * Math.sin(view.polar) * Math.cos(view.azimuth));
  camera.lookAt(target);
  camera.zoom = view.zoom;
  camera.updateProjectionMatrix();
}
function resize() {
  if (!renderer || failed) return;
  const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight), aspect = w / h;
  const height = Math.max(10.7, 11.8 / aspect);
  camera.left = -height * aspect / 2; camera.right = height * aspect / 2;
  camera.top = height / 2; camera.bottom = -height / 2;
  camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
  invalidate();
}
const dayKey = new THREE.Color('#FFF8EC'), nightKey = new THREE.Color('#B5C7FF');
const daySky = new THREE.Color('#FAFCFF'), nightSky = new THREE.Color('#98ABD8');
function render(now) {
  raf = 0;
  if (!state.ready || failed) return;
  const dt = last ? Math.min(.05, (now - last) / 1000) : .016;
  last = now;
  const calm = reduced.matches;
  if (state.reduced !== calm) syncReducedMotion();
  if (!calm) clock += dt;
  const k = calm ? 1 : 1 - Math.exp(-dt * 8);
  view.azimuth += (desired.azimuth - view.azimuth) * k;
  view.polar += (desired.polar - view.polar) * k;
  view.zoom += (desired.zoom - view.zoom) * k;
  night += ((state.time === 'night' ? 1 : 0) - night) * (calm ? 1 : 1 - Math.exp(-dt * 4.2));
  visitors?.step(clock, calm ? 0 : dt);
  const desiredDoor = Math.max(state.door ? 1 : 0, showVisitors ? visitors?.doorOpen || 0 : 0);
  opening += (desiredDoor - opening) * k;
  entrance = calm ? 1 : Math.min(1, entrance + dt * 1.5);
  const entry = 1 - (1 - entrance) ** 3;
  root.scale.setScalar(.94 + entry * .06);
  root.position.y = -.15 * (1 - entry);
  ambient.color.copy(daySky).lerp(nightSky, night);
  ambient.intensity = THREE.MathUtils.lerp(2.0, .78, night);
  key.color.copy(dayKey).lerp(nightKey, night);
  key.intensity = THREE.MathUtils.lerp(3.0, 1.45, night);
  rim.intensity = THREE.MathUtils.lerp(.65, .85, night);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(1.06, 1.0, night);
  shadow.material.opacity = THREE.MathUtils.lerp(.075, .18, night);
  bookstore.setNight(night); bookstore.setDoor(opening); bookstore.step?.(clock, calm ? 0 : dt);
  seasons.setNight(night); seasons.step(clock, calm ? 0 : dt);
  cameraUpdate();
  renderer.render(scene, camera);
  if (!calm && !document.hidden && inView) raf = requestAnimationFrame(render);
}
function invalidate() {
  if (!raf && state.ready && !failed && !document.hidden) raf = requestAnimationFrame(render);
}

function syncReducedMotion() {
  state.reduced = reduced.matches;
  seasons?.setReducedMotion(state.reduced);
  seasons?.setSeason(state.season, { immediate: true });
  visitors?.setReducedMotion(state.reduced);
}

function failure(error) {
  failed = true; state.ready = false;
  if (raf) cancelAnimationFrame(raf); raf = 0;
  $('#loader').classList.add('done'); $('#fallback').hidden = false;
  for (const b of document.querySelectorAll('.control-dock button,.camera-tools button')) b.disabled = true;
  canvas.tabIndex = -1;
  document.documentElement.dataset.ready = 'failed';
  announce('三维画面暂不可用，可以重新加载');
  console.warn('Bookstore rendering unavailable:', error?.message || error);
}

async function init() {
  try {
    await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 1800))]);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-8, 8, 5, -5, .1, 100);
    ambient = new THREE.HemisphereLight('#FAFCFF', '#A3A7AF', 2); scene.add(ambient);
    key = new THREE.DirectionalLight('#FFF8EC', 3); key.position.set(-4, 18, 9); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -8; key.shadow.camera.right = 8; key.shadow.camera.top = 9; key.shadow.camera.bottom = -7;
    key.shadow.camera.near = 1; key.shadow.camera.far = 40; key.shadow.normalBias = .025; key.shadow.bias = -.00035;
    key.target.position.set(0, 2, 0); scene.add(key, key.target);
    rim = new THREE.DirectionalLight('#CCD8FF', .65); rim.position.set(7, 7, -6); scene.add(rim);
    root = new THREE.Group(); scene.add(root);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(8.6, .22, 7.4), new THREE.MeshStandardMaterial({ color: '#BFC2C2', roughness: .92 }));
    plinth.position.y = .01; plinth.castShadow = true; plinth.receiveShadow = true; root.add(plinth);
    const plinthEdges = new THREE.LineSegments(new THREE.EdgesGeometry(plinth.geometry), new THREE.LineBasicMaterial({ color: '#58606B', transparent: true, opacity: .32 })); plinth.add(plinthEdges);
    shadow = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: '#23315B', opacity: .16 }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.105; shadow.receiveShadow = true; scene.add(shadow);
    bookstore = buildBookstore({ reducedMotion: reduced.matches }); root.add(bookstore.group);
    seasons = buildSeasons({ roofY: bookstore.roof?.height || 6.2, reducedMotion: reduced.matches }); root.add(seasons.group);
    visitors = buildVisitors({ reducedMotion: reduced.matches, maxPeople: 24 }); root.add(visitors.group);
    visitors.setCount(showVisitors ? statsSnapshot?.visitors ?? null : null);
    seasons.setSeason('spring', { immediate: true });
    state.ready = true; reflectUI(); resize();
    $('#loader').classList.add('done');
    document.documentElement.dataset.ready = 'true';
    announce('四季书屋已打开');
    window.__BOOKSTORE = {
      state, setTime, setSeason, toggleDoor, reset,
      get view() { return { ...view }; }, get desired() { return { ...desired }; },
      get renderer() { return renderer; }, get scene() { return scene; }, get camera() { return camera; },
      get bookstore() { return bookstore; }, get seasons() { return seasons; },
      get visitors() { return visitors; }, get stats() { return statsSnapshot; },
      get frame() { return { night, opening, clock, raf }; }
    };
  } catch (error) { failure(error); }
}

for (const b of document.querySelectorAll('[data-time]')) b.addEventListener('click', () => setTime(b.dataset.time));
for (const b of document.querySelectorAll('button[data-season]')) b.addEventListener('click', () => setSeason(b.dataset.season));
$('#doorButton').addEventListener('click', toggleDoor);
$('#zoomIn').addEventListener('click', () => zoom(1.16));
$('#zoomOut').addEventListener('click', () => zoom(1 / 1.16));
$('#resetView').addEventListener('click', reset);
$('#retry').addEventListener('click', () => location.reload());
$('#refreshStats').addEventListener('click', refreshStats);
$('#showVisitors').addEventListener('click', () => {
  showVisitors = !showVisitors;
  visitors?.setCount(showVisitors ? statsSnapshot?.visitors ?? null : null);
  reflectStats(); invalidate();
});
if (!document.fullscreenEnabled) $('#fullscreen').hidden = true;
$('#fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { announce('当前浏览器未允许全屏'); }
});
document.addEventListener('fullscreenchange', () => {
  $('#fullscreen').setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '全屏查看'); resize();
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  if (!state.ready) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId); previousPinch = 0;
});
canvas.addEventListener('pointermove', e => {
  const before = pointers.get(e.pointerId);
  if (!before || !state.ready) return;
  const dx = e.clientX - before.x, dy = e.clientY - before.y;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]; const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (previousPinch > 0) zoom(distance / previousPinch);
    previousPinch = distance;
  } else {
    desired.azimuth -= dx * .006;
    desired.polar = THREE.MathUtils.clamp(desired.polar - dy * .004, .52, 1.47);
  }
  invalidate();
});
const release = e => { pointers.delete(e.pointerId); previousPinch = 0; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); };
canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
canvas.addEventListener('lostpointercapture', e => { pointers.delete(e.pointerId); previousPinch = 0; });
canvas.addEventListener('wheel', e => { if (!state.ready) return; e.preventDefault(); zoom(Math.exp(-e.deltaY * .001)); }, { passive: false });
canvas.addEventListener('keydown', e => {
  if (!state.ready) return;
  let handled = true;
  if (e.key === 'ArrowLeft') desired.azimuth += .16;
  else if (e.key === 'ArrowRight') desired.azimuth -= .16;
  else if (e.key === 'ArrowUp') desired.polar = Math.max(.52, desired.polar - .1);
  else if (e.key === 'ArrowDown') desired.polar = Math.min(1.47, desired.polar + .1);
  else if (['+', '='].includes(e.key)) zoom(1.12);
  else if (e.key === '-') zoom(1 / 1.12);
  else if (['r', 'R', 'Home'].includes(e.key)) reset();
  else if (['d', 'D'].includes(e.key)) toggleDoor();
  else handled = false;
  if (handled) { e.preventDefault(); invalidate(); }
});
new ResizeObserver(resize).observe(stage);
new IntersectionObserver(entries => { inView = entries[0].isIntersecting; if (inView) { last = 0; invalidate(); } else if (raf) { cancelAnimationFrame(raf); raf = 0; } }, { threshold: .01 }).observe(stage);
document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else { last = 0; invalidate(); } });
reduced.addEventListener('change', () => {
  if (raf) cancelAnimationFrame(raf); raf = 0; last = 0;
  syncReducedMotion(); invalidate();
});
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); failure(new Error('WebGL context lost')); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(statsTimer); statsController?.abort(); }
  else if (!statsController && (statsNeedsRefresh || statsSnapshot?.visitors == null || Date.now() - lastStatsAttempt > 300000)) refreshStats();
  else scheduleStats();
});
window.addEventListener('pagehide', () => { pageLeaving = true; clearTimeout(statsTimer); statsController?.abort(); });
window.addEventListener('pageshow', e => { pageLeaving = false; if (e.persisted) refreshStats(); });
// Use the site's existing anonymous counter only on the published site.
// Local previews, downloaded copies, and integration tests do not record visits.
if (location.protocol === 'https:' && ['springhues.com', 'www.springhues.com'].includes(location.hostname)) {
  const tracker = document.createElement('script');
  tracker.async = true; tracker.dataset.goatcounter = 'https://springhues.goatcounter.com/count';
  tracker.src = 'https://gc.zgo.at/count.js'; document.head.append(tracker);
}
init();
refreshStats();
