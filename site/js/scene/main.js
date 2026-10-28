// 场景页：三维微缩街景的渲染循环、昼夜与季节切换、真实数字。
import { createExperience } from './three-scene.js';
import { loadStats } from './stats.js';

const stage = document.querySelector('[data-scene-stage]');
const canvas = document.querySelector('[data-scene-canvas]');
const dayNight = Array.from(document.querySelectorAll('[data-daynight]'));
const seasonButtons = Array.from(document.querySelectorAll('[data-season]'));
const note = document.querySelector('[data-scene-note]');

if (stage && canvas && canvas.getContext) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let experience = null;

  try {
    experience = createExperience({ canvas, stage });
  } catch (error) {
    if (note) note.textContent = '当前浏览器无法显示三维场景，数据仍然可用。';
  }

  if (experience) {
    const state = {
      theme: document.documentElement.getAttribute('data-theme') === 'night' ? 'night' : 'day',
      season: 'spring'
    };

    function syncTheme(next) {
      state.theme = next;
      experience.setTheme(next);
      for (const button of dayNight) {
        button.setAttribute('aria-pressed', String(button.dataset.daynight === next));
      }
    }

    syncTheme(state.theme);

    // 页面里的昼夜按钮复用站点的主题开关，页首图标与场景保持一致。
    for (const button of dayNight) {
      button.addEventListener('click', () => {
        const wanted = button.dataset.daynight === 'night' ? 'night' : 'day';
        const current = document.documentElement.getAttribute('data-theme') === 'night' ? 'night' : 'day';
        if (wanted === current) return;
        const shellButton = document.querySelector('.sd-actions .sd-act');
        if (shellButton) {
          shellButton.click();
        } else {
          document.documentElement.setAttribute('data-theme', wanted);
        }
      });
    }

    const themeObserver = new MutationObserver(() => {
      const next = document.documentElement.getAttribute('data-theme') === 'night' ? 'night' : 'day';
      if (next !== state.theme) syncTheme(next);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    for (const button of seasonButtons) {
      button.addEventListener('click', () => {
        state.season = button.dataset.season;
        experience.setSeason(state.season);
        for (const item of seasonButtons) {
          item.setAttribute('aria-pressed', String(item === button));
        }
      });
    }

    let raf = 0;
    let last = 0;
    let visible = true;

    function frame(now) {
      if (!last) last = now;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      experience.step(dt);
      experience.renderer.render(experience.scene, experience.camera);
      if (visible && !reduced.matches) raf = requestAnimationFrame(frame);
      else raf = 0;
    }

    function start() {
      if (raf || reduced.matches) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    function drawOnce() {
      experience.step(0.016);
      experience.renderer.render(experience.scene, experience.camera);
    }

    reduced.addEventListener('change', () => {
      if (reduced.matches) {
        stop();
        drawOnce();
      } else {
        start();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
      else if (visible) start();
    });

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        if (visible) start();
        else stop();
      }, { threshold: 0.02 });
      io.observe(stage);
    }

    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(() => {
        experience.resize();
        if (reduced.matches) drawOnce();
      });
      ro.observe(stage);
    }

    if (reduced.matches) drawOnce();
    else start();
  }

  loadStats().then((result) => {
    // 街上的人数 = 独立访客数（上限 30，至少 1）
    if (experience && typeof experience.setPeople === 'function') {
      const visitors = Number.isFinite(result.visitors) ? result.visitors : 1;
      experience.setPeople(Math.max(1, visitors));
    }
    if (!note) return;
    if (result.counter && result.live) {
      note.textContent = '数据实时读取，匿名统计，不使用 Cookie。';
    } else if (result.counter) {
      const at = result.snapshotAt ? new Date(result.snapshotAt) : null;
      const stamp = at && !Number.isNaN(at.getTime())
        ? ' 快照更新于 ' + at.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '。'
        : '';
      note.textContent = '匿名统计，不使用 Cookie。' + stamp;
    } else {
      note.textContent = '访问统计暂未接通，数字暂不显示。';
    }
  });
}
