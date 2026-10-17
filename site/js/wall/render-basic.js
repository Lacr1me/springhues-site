// 作品墙降级渲染：静态卡片 + 简易 <dialog> 详情，无共享元素转场 / 倾斜 / 视差。
// 载体模块也失败时，渲染最朴素的链接列表。预算 ≤ 5KB gzip。
import { app } from '../core/app.js';
import { h } from '../core/dom.js';
import { copyText } from '../core/copy.js';
import { toast } from '../ui/toast.js';

function linkNode(l) {
  const cursor = l.kind === 'download' ? 'download' : 'open';
  if (l.href === '#') return h('a', { href: '#', 'data-cursor': cursor, 'data-placeholder': '' }, l.label);
  const ext = /^https:/i.test(l.href);
  return h('a', { href: l.href, 'data-cursor': cursor, target: ext ? '_blank' : null, rel: ext ? 'noopener noreferrer' : null }, l.label);
}

export async function renderBasic({ data, archive }) {
  const wallEl = document.getElementById('worksWall');
  const byId = new Map(data.categories.map(c => [c.id, c]));
  let cards = null;
  try {
    const mod = await import('./cards.js');
    cards = mod.buildCards(data.works, data.categories);
    mod.applyShapes(cards, mod.currentColumns());
    matchMedia('(max-width: 1099px)').addEventListener('change', () => mod.applyShapes(cards, mod.currentColumns()));
    wallEl.replaceChildren(...cards.map(c => c.root));
  } catch (e) {
    console.error('[render-basic] 载体模块不可用，渲染朴素链接列表', e);
    wallEl.replaceChildren(...data.works.map(w => h('li', { class: 'slot', style: 'grid-column:1/-1' },
      h('a', { href: w.links.find(l => l.href !== '#')?.href || '#work=' + w.slug }, w.name + '：' + w.intro))));
  }
  wallEl.dataset.mode = 'basic';
  const staticLinks = document.querySelector('ul.static-links');
  if (staticLinks) staticLinks.hidden = true;

  const dlg = h('dialog', { class: 'basic-detail', 'aria-labelledby': 'basicTitle' });
  const close = h('button', { type: 'button' }, '关闭');
  close.addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('click', e => {
    if (e.target.closest && e.target.closest('a[data-placeholder]')) { e.preventDefault(); toast('占位链接，暂未提供'); }
  });
  document.body.appendChild(dlg);
  const open = slug => {
    const w = data.works.find(x => x.slug === slug);
    if (!w) { toast('没有找到这个作品'); return; }
    const links = w.links.map(linkNode);
    if (w.source) links.unshift(h('a', { href: w.source.base, 'data-latest': w.source.base === 'minsheng/' ? 'minsheng' : 'game' }, '阅读最新一期'));
    if (w.prompt && links.length) links[0].classList.add('is-primary');
    if (w.prompt) {
      const btn = h('button', { type: 'button', class: 'copy-prompt', 'data-cursor': 'copy' }, '复制提示词');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const res = await fetch(w.prompt, { cache: 'no-store' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          await copyText(await res.text());
          toast('提示词已复制');
        } catch (e) {
          console.error('[render-basic] 复制提示词失败', e);
          toast('复制失败，请稍后再试');
        } finally {
          btn.disabled = false;
        }
      });
      links.push(btn);
    }
    dlg.replaceChildren(h('h2', { id: 'basicTitle' }, w.name), h('p', {}, w.intro), h('p', {}, (byId.get(w.category)?.name || '') + (w.version ? ' · ' + w.version : '') + (w.model ? ' · ' + w.model : '')),
      h('div', { class: 'actions' }, ...links), h('form', { method: 'dialog' }, close));
    if (!dlg.open) dlg.showModal();
    archive && archive.applyLinks(document);
  };
  app.openWork = open;
  wallEl.addEventListener('click', e => {
    const hit = e.target.closest && e.target.closest('a.card-hit');
    if (!hit) return;
    e.preventDefault();
    open(hit.dataset.slug);
  });
  if (cards) {
    const chips = document.getElementById('filters');
    const cats = [{ id: 'all', name: '全部资源' }, ...data.categories];
    const empty = h('li', { class: 'wall-empty', hidden: true }, '这个分类还没有作品，之后会补上。');
    wallEl.append(empty);
    const syncEmpty = id => {
      const has = id === 'all' ? cards.length > 0 : data.works.some(w => w.category === id);
      empty.hidden = has;
    };
    chips.replaceChildren(...cats.map(c => {
      const b = h('button', { type: 'button', 'aria-pressed': String(c.id === 'all') }, c.name);
      b.addEventListener('click', () => {
        app.category = c.id;
        chips.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        cards.forEach(card => { card.root.hidden = !(c.id === 'all' || card.work.category === c.id); });
        syncEmpty(c.id);
      });
      return b;
    }));
    app.setCategory = id => { const b = [...chips.children].find((x, i) => cats[i].id === id); if (b) b.click(); };
  }
  archive && archive.applyLinks(document);
  return cards;
}
