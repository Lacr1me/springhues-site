(() => {
  'use strict';
  const { parseCatalog, latestEdition, matchesResource, validId } = window.SpringhuesPortalData;
  let resources = [];
  let resourceMap = new Map();
  let catalogStatus = 'loading';
  let catalogRequest = null;
  const favoriteKey = 'springhues.resources.favorites.v1';
  const channelConfig = {
    civic: { manifest: 'data/minsheng/index.json', fallback: '民生与科技每日35条精选', link: 'minsheng/' },
    game: { manifest: 'data/index.json', fallback: '今日游戏与方块世界', link: 'game/' }
  };
  const channelRequests = new Map();
  let archivesCheckedAt = 0;
  const views = ['library', 'saved', 'journal', 'about'];
  const categories = ['all', 'tools', 'design', 'game'];
  const viewNames = { library: '资源库', saved: '我的收藏', journal: '每日简报', about: '关于这里' };
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let favoriteIds = readFavorites();
  let state = readRoute();
  let searchTimer, toastTimer, toastHideTimer, activeTransition;
  let renderRevision = 0;
  let returnFocusId = null;
  const search = $('#workSearch');
  const library = $('#libraryView');
  const details = $('#detailView');
  const grid = $('#projectGrid');
  const toast = $('#toast');

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }
  const icon = name => '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  function readFavorites() {
    try {
      const parsed = JSON.parse(localStorage.getItem(favoriteKey) || '[]');
      return new Set(Array.isArray(parsed) ? parsed.filter(validId) : []);
    } catch (_) {
      return new Set();
    }
  }
  function readRoute() {
    const query = new URL(location.href).searchParams;
    let view = query.get('view');
    if (!views.includes(view)) view = query.get('saved') === '1' ? 'saved' : 'library';
    return {
      view,
      category: categories.includes(query.get('category')) ? query.get('category') : 'all',
      query: (query.get('q') || '').slice(0, 100),
      work: query.get('work') ? (validId(query.get('work')) ? query.get('work') : '__invalid__') : null
    };
  }
  function routeUrl(next) {
    const url = new URL(location.href);
    ['view', 'saved', 'category', 'q', 'work'].forEach(key => url.searchParams.delete(key));
    url.hash = '';
    if (next.view !== 'library') url.searchParams.set('view', next.view);
    if (next.category !== 'all') url.searchParams.set('category', next.category);
    if (next.query) url.searchParams.set('q', next.query);
    if (next.work) url.searchParams.set('work', next.work);
    return url;
  }
  function saveScroll() {
    history.replaceState({ ...history.state, shelf: true, scrollY: window.scrollY }, '', location.href);
  }
  function headingForView() {
    if (state.work) return '#detailTitle';
    return { library: '#libraryTitle', saved: '#libraryTitle', journal: '#journalTitle', about: '#aboutTitle' }[state.view];
  }
  function focusTarget(target) {
    const element = typeof target === 'string' ? $(target) : target;
    if (element) element.focus({ preventScroll: true });
  }
  async function updateScreen(options = {}) {
    const revision = ++renderRevision;
    if (activeTransition) activeTransition.skipTransition();
    const update = () => {
      render();
      if (typeof options.scroll === 'number') window.scrollTo({ top: options.scroll, behavior: 'instant' });
    };
    if (options.animate !== false && !reducedMotion.matches && document.startViewTransition) {
      const transition = document.startViewTransition(update);
      activeTransition = transition;
      transition.ready.catch(() => {});
      transition.finished.catch(() => {});
      try { await transition.updateCallbackDone; } catch (_) { /* A newer view may have superseded this one. */ }
      transition.finished.catch(() => {}).finally(() => {
        if (activeTransition === transition) activeTransition = null;
      });
    } else {
      update();
      if (options.animate !== false && !reducedMotion.matches) {
        $('#viewContent').animate([{ opacity: .4, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 190, easing: 'ease-out' });
      }
    }
    if (revision !== renderRevision) return;
    if (options.focus) focusTarget(options.focus === true ? headingForView() : options.focus);
  }
  function navigate(patch, options = {}) {
    clearTimeout(searchTimer);
    saveScroll();
    state = { ...state, query: search.value.slice(0, 100), ...patch };
    const entry = {
      shelf: true,
      scrollY: typeof options.scroll === 'number' ? options.scroll : 0,
      detailEntry: Boolean(options.detailEntry),
      returnId: options.returnId || null
    };
    if (options.replace) history.replaceState(entry, '', routeUrl(state));
    else history.pushState(entry, '', routeUrl(state));
    return updateScreen({
      scroll: typeof options.scroll === 'number' ? options.scroll : 0,
      focus: options.focus,
      animate: options.animate
    });
  }
  function filteredResources() {
    return resources.filter(item => {
      if (state.view === 'saved' && !favoriteIds.has(item.id)) return false;
      if (state.category !== 'all' && item.category !== state.category) return false;
      return matchesResource(item, state.query);
    });
  }
  function linkAttributes(url, filename = '') {
    const parsed = new URL(url, location.href);
    const external = parsed.origin !== location.origin;
    return ' href="' + escapeHtml(url) + '"' +
      (external ? ' target="_blank" rel="noopener noreferrer"' : '') +
      (!external && filename ? ' download="' + escapeHtml(filename) + '"' : '');
  }
  function downloadAction(item, style) {
    if (!item.downloadUrl) return '<button class="button ' + style + '" type="button" disabled aria-label="暂未提供下载文件">' + icon('down') + '下载待提供</button>';
    return '<a class="button ' + style + ' resource-download"' + linkAttributes(item.downloadUrl, item.filename) + '>' + icon('down') + escapeHtml(item.downloadLabel) + '</a>';
  }
  function cardMarkup(item, order) {
    const id = escapeHtml(item.id);
    const saved = favoriteIds.has(item.id);
    const cover = {
      download: { word: 'DL', caption: 'DESKTOP TOOLS', icon: 'down' },
      reading: { word: 'Web', caption: 'WEB & DESIGN', icon: 'book' },
      blocks: { word: 'MC', caption: 'GAME RESOURCES', icon: 'blocks' }
    }[item.cover];
    const href = escapeHtml(routeUrl({ ...state, work: item.id }).href);
    return '<article class="resource-card" data-card="' + id + '" style="--order:' + order + ';view-transition-name:card-' + id + '">' +
      '<div class="resource-cover cover-' + escapeHtml(item.cover) + '" aria-hidden="true">' +
        '<span class="cover-label">' + escapeHtml(item.categoryLabel) + '</span>' +
        '<span class="cover-symbol">' + cover.word + '</span>' +
        '<span class="cover-caption">' + cover.caption + '</span>' +
        '<svg class="icon cover-icon"><use href="#i-' + cover.icon + '"/></svg>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="card-meta"><span>' + escapeHtml(item.categoryLabel) + '</span><span class="status-pill">' + escapeHtml(item.statusLabel) + '</span></div>' +
        '<h2 class="resource-title"><a class="project-open" data-work="' + id + '" href="' + href + '">' + escapeHtml(item.title) + '</a></h2>' +
        '<p class="card-description">' + escapeHtml(item.description) + '</p>' +
        '<dl class="quick-facts"><div><dt>展示平台</dt><dd>' + escapeHtml(item.platforms.join(' / ') || '待说明') + '</dd></div>' +
          '<div><dt>项目状态</dt><dd>' + escapeHtml(item.version || item.statusLabel) + '</dd></div>' +
          '<div><dt>下载文件</dt><dd>' + escapeHtml(item.fileSize || (item.downloadUrl ? '可下载' : '待提供')) + '</dd></div></dl>' +
        '<div class="card-features">' + item.features.map(feature => '<span>' + icon('check') + escapeHtml(feature) + '</span>').join('') + '</div>' +
        '<div class="card-actions"><a class="button primary project-open" data-work="' + id + '" href="' + href + '">查看详情' + icon('arrow') + '</a>' +
          downloadAction(item, 'secondary') +
          '<button class="icon-button bookmark-button" type="button" data-save="' + id + '" aria-pressed="' + saved + '" aria-label="' + (saved ? '取消收藏 ' : '收藏 ') + escapeHtml(item.title) + '" title="' + (saved ? '取消收藏' : '收藏') + '">' + icon('bookmark') + '</button></div>' +
      '</div></article>';
  }
  function renderLibrary() {
    const items = catalogStatus === 'ready' ? filteredResources() : [];
    $('#introBanner').hidden = state.view === 'saved';
    $('#libraryTitle').textContent = viewNames[state.view] || viewNames.library;
    $('#resultCount').textContent = catalogStatus === 'ready' ? items.length + ' 个条目' : '';
    $('#catalogNote').textContent = resources.some(item => item.example) && catalogStatus === 'ready' ? '含明确标注的示例项目' : '';
    grid.innerHTML = items.map(cardMarkup).join('');
    grid.setAttribute('aria-busy', String(catalogStatus === 'loading'));
    $('#catalogLoading').hidden = catalogStatus !== 'loading';
    const empty = items.length === 0 && catalogStatus !== 'loading';
    $('#emptyState').hidden = !empty;
    $('#retryCatalog').hidden = catalogStatus !== 'error';
    $('#clearFilters').hidden = catalogStatus === 'error';
    if (!empty) return;
    const filtered = state.query.trim() || state.category !== 'all';
    const noSavedItems = state.view === 'saved' && !resources.some(item => favoriteIds.has(item.id));
    if (catalogStatus === 'error') {
      $('#emptyTitle').textContent = '资源暂时没读到';
      $('#emptyDescription').textContent = '请检查网络连接，然后重新读取';
    } else if (noSavedItems) {
      $('#emptyTitle').textContent = '还没有收藏的资源';
      $('#emptyDescription').textContent = '在资源卡片上点一下书签，就能把它留在这里';
      $('#clearFilters').textContent = '去资源库看看';
      $('#clearFilters').dataset.action = 'library';
    } else if (resources.length === 0 && !filtered) {
      $('#emptyTitle').textContent = '作品正在整理';
      $('#emptyDescription').textContent = '新的作品会陆续放在这里，也可以先读一份每日简报';
      $('#clearFilters').textContent = '看看每日简报';
      $('#clearFilters').dataset.action = 'journal';
    } else {
      $('#emptyTitle').textContent = '没有找到匹配的资源';
      $('#emptyDescription').textContent = '换个关键词，或清除分类后再看看';
      $('#clearFilters').textContent = '清除筛选';
      $('#clearFilters').dataset.action = 'clear';
    }
  }
  function renderDetail() {
    const item = resourceMap.get(state.work);
    const backLabel = state.view === 'saved' ? '返回我的收藏' : '返回资源库';
    if (catalogStatus !== 'ready') {
      details.innerHTML = '<button class="back-button" type="button" data-back>' + icon('back') + backLabel + '</button>' +
        '<div class="empty-state detail-pending"><h1 id="detailTitle" tabindex="-1">' + (catalogStatus === 'loading' ? '正在读取资源…' : '资源暂时没读到') + '</h1>' +
        '<p>' + (catalogStatus === 'loading' ? '稍等片刻' : '请检查网络连接，然后重新读取') + '</p>' +
        (catalogStatus === 'error' ? '<button class="button secondary" type="button" data-retry-catalog>重新读取</button>' : '') + '</div>';
      return;
    }
    if (!item) {
      details.innerHTML = '<button class="back-button" type="button" data-back>' + icon('back') + backLabel + '</button>' +
        '<div class="empty-state" style="margin-top:24px"><h1 id="detailTitle" tabindex="-1">没有找到这个资源</h1><p>这个链接可能已经失效，可以回到资源库继续浏览</p>' +
        '<button class="button secondary" type="button" data-back>返回资源库</button></div>';
      return;
    }
    const saved = favoriteIds.has(item.id);
    details.innerHTML = '<button class="back-button" type="button" data-back>' + icon('back') + backLabel + '</button>' +
      '<div class="detail-heading"><div class="card-meta"><span>' + escapeHtml(item.categoryLabel) + '</span><span class="status-pill">' + escapeHtml(item.statusLabel) + '</span></div>' +
        '<h1 id="detailTitle" tabindex="-1">' + escapeHtml(item.title) + '</h1>' +
        '<p>' + escapeHtml(item.description) + '</p><div class="detail-tags">' + item.tags.map(tag => '<span>' + escapeHtml(tag) + '</span>').join('') + '</div></div>' +
      '<div class="detail-layout"><div class="detail-content">' +
        '<nav class="detail-nav" aria-label="详情目录"><a href="#features">功能概览</a><a href="#requirements">适用条件</a><a href="#content">内容说明</a></nav>' +
        '<section class="detail-section" id="features"><h2>功能概览</h2><div class="feature-rows">' +
          (item.features.length ? item.features.map(feature => '<div class="feature-row">' + icon('check') + '<span>' + escapeHtml(feature) + '</span></div>').join('') : '<p>功能说明待补充</p>') + '</div></section>' +
        '<section class="detail-section" id="requirements"><h2>适用条件</h2><ul>' +
          (item.requirements.length ? item.requirements.map(requirement => '<li>' + escapeHtml(requirement) + '</li>').join('') : '<li>适用条件待补充</li>') + '</ul></section>' +
        '<section class="detail-section" id="content"><h2>内容说明</h2><p>' + escapeHtml(item.statement || '暂无补充说明') + '</p></section>' +
      '</div><aside class="download-sidebar" aria-label="资源文件信息">' +
        '<div class="download-icon">' + icon('file') + '</div><h2>资源文件</h2><p class="file-note">' + (item.downloadUrl ? '下载前请先阅读适用条件与使用说明' : '文件尚未提供，后续更新会显示在这里') + '</p>' +
        '<dl class="file-facts"><div><dt>展示平台</dt><dd>' + escapeHtml(item.platforms.join(' / ') || '待说明') + '</dd></div>' +
          '<div><dt>项目状态</dt><dd>' + escapeHtml(item.version || item.statusLabel) + '</dd></div><div><dt>文件信息</dt><dd>' + escapeHtml(item.fileSize || (item.downloadUrl ? '以下载文件为准' : '暂未提供')) + '</dd></div></dl>' +
        downloadAction(item, 'primary') +
        (item.sourceUrl ? '<a class="button secondary resource-source"' + linkAttributes(item.sourceUrl) + '>' + escapeHtml(item.sourceLabel) + icon('arrow') + '</a>' : '') +
        '<div class="detail-save-actions"><button class="button secondary bookmark-button" type="button" data-save="' + escapeHtml(item.id) + '" aria-pressed="' + saved + '" aria-label="' + (saved ? '取消收藏 ' : '收藏 ') + escapeHtml(item.title) + '">' + icon('bookmark') + '<span>' + (saved ? '已收藏' : '收藏') + '</span></button>' +
          '<button class="button secondary" type="button" data-copy>' + icon('copy') + '复制链接</button></div>' +
        '<label id="copyFallback" class="copy-fallback" hidden for="manualCopyLink">浏览器暂不能自动复制，可选中下面的链接<input id="manualCopyLink" type="text" readonly></label>' +
      '</aside></div>';
  }
  function paintNavigation() {
    $$('.main-nav [data-view]').forEach(button => {
      const selected = button.dataset.view === state.view;
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    $$('.filter').forEach(button => {
      const selected = button.dataset.category === state.category;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const collection = state.view === 'saved' ? resources.filter(item => favoriteIds.has(item.id)) : resources;
    $$('[data-count]').forEach(count => {
      count.textContent = catalogStatus === 'ready' ? collection.filter(item => count.dataset.count === 'all' || item.category === count.dataset.count).length : '—';
    });
    $('#libraryCount').textContent = catalogStatus === 'ready' ? resources.length : '—';
    $('#favoriteCount').textContent = catalogStatus === 'ready' ? resources.filter(item => favoriteIds.has(item.id)).length : '—';
    $('#categorySection').hidden = !state.work && !['library', 'saved'].includes(state.view);
    $('#breadcrumbView').textContent = state.work ? '资源详情' : viewNames[state.view];
    $('#clearSearch').hidden = !search.value;
    $('#searchShortcut').hidden = Boolean(search.value);
    $$('a[data-view]').forEach(link => {
      link.href = routeUrl({ ...state, view: link.dataset.view, work: null }).href;
    });
  }
  function paintSaveButtons() {
    $$('[data-save]').forEach(button => {
      const id = button.dataset.save;
      const saved = favoriteIds.has(id);
      const item = resourceMap.get(id);
      button.setAttribute('aria-pressed', String(saved));
      button.setAttribute('aria-label', (saved ? '取消收藏 ' : '收藏 ') + item.title);
      button.title = saved ? '取消收藏' : '收藏';
      const label = button.querySelector('span');
      if (label) label.textContent = saved ? '已收藏' : '收藏';
    });
  }
  function render() {
    if (search.value !== state.query) search.value = state.query;
    const isDetail = Boolean(state.work);
    library.hidden = isDetail || !['library', 'saved'].includes(state.view);
    details.hidden = !isDetail;
    $('#journalView').hidden = isDetail || state.view !== 'journal';
    $('#aboutView').hidden = isDetail || state.view !== 'about';
    paintNavigation();
    if (isDetail) renderDetail();
    else if (!library.hidden) renderLibrary();
    const title = isDetail ? (resourceMap.get(state.work)?.title || (catalogStatus === 'loading' ? '资源详情' : '资源未找到')) : viewNames[state.view];
    document.title = title + ' · Springhues';
  }
  function showToast(message, error = false) {
    clearTimeout(toastTimer);
    clearTimeout(toastHideTimer);
    toast.classList.remove('exiting');
    toast.classList.toggle('error', error);
    toast.querySelector('span').textContent = message;
    toast.querySelector('use').setAttribute('href', error ? '#i-message' : '#i-check');
    toast.hidden = false;
    toastTimer = setTimeout(() => {
      toast.classList.add('exiting');
      toastHideTimer = setTimeout(() => { toast.hidden = true; }, reducedMotion.matches ? 0 : 180);
    }, 2800);
  }
  async function toggleFavorite(id) {
    if (!resourceMap.has(id)) return;
    const next = new Set(favoriteIds);
    const adding = !next.has(id);
    if (adding) next.add(id); else next.delete(id);
    try {
      localStorage.setItem(favoriteKey, JSON.stringify([...next]));
    } catch (_) {
      showToast('浏览器未能保存收藏，请检查本地存储权限', true);
      return;
    }
    favoriteIds = next;
    if (state.view === 'saved' && !state.work) {
      const currentScroll = window.scrollY;
      await updateScreen({ scroll: currentScroll, animate: true });
      focusTarget(grid.querySelector('[data-save]') || '#libraryTitle');
    } else {
      paintNavigation();
      paintSaveButtons();
    }
    showToast(adding ? '已加入收藏' : '已取消收藏');
  }
  function openDetail(id) {
    returnFocusId = id;
    navigate({ work: id }, { detailEntry: true, returnId: id, focus: true });
  }
  function closeDetail() {
    returnFocusId = state.work;
    if (history.state?.detailEntry) {
      history.back();
    } else {
      navigate({ work: null, view: state.view === 'saved' ? 'saved' : 'library' }, {
        replace: true, focus: '#libraryTitle'
      });
    }
  }
  async function copyLink() {
    const current = location.href;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(current);
      showToast('当前资源链接已复制');
    } catch (_) {
      const input = $('#manualCopyLink');
      $('#copyFallback').hidden = false;
      input.value = current;
      input.focus({ preventScroll: true });
      input.select();
      showToast('已选中链接，可手动复制');
    }
  }
  function updateSearch() {
    const query = search.value.slice(0, 100);
    navigate({ query, work: null, view: state.view === 'saved' ? 'saved' : 'library' }, {
      replace: true, scroll: 0, animate: true
    });
  }
  document.addEventListener('click', event => {
    const element = event.target.closest('a,button');
    if (!element || element.disabled) return;
    if (element.tagName === 'A' && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
    if (element.matches('[data-work]')) {
      event.preventDefault();
      openDetail(element.dataset.work);
    } else if (element.matches('[data-view]')) {
      event.preventDefault();
      const view = element.dataset.view;
      if (state.view === view && !state.work) return;
      navigate({ view, work: null }, { focus: true });
      if (view === 'journal' && Date.now() - archivesCheckedAt > 60000) refreshArchives();
    } else if (element.matches('[data-category]')) {
      event.preventDefault();
      if (state.category === element.dataset.category && !state.work) return;
      navigate({ view: state.view === 'saved' ? 'saved' : 'library', category: element.dataset.category, work: null }, { focus: '#libraryTitle' });
    } else if (element.matches('[data-save]')) {
      toggleFavorite(element.dataset.save);
    } else if (element.matches('[data-back]')) {
      closeDetail();
    } else if (element.matches('[data-retry-catalog]')) {
      hydrateCatalog();
    } else if (element.matches('[data-retry-channel]')) {
      hydrateChannel(element.dataset.retryChannel);
    } else if (element.matches('[data-copy]')) {
      copyLink();
    } else if (element.matches('.detail-nav a')) {
      event.preventDefault();
      const target = $(element.getAttribute('href'));
      if (target) {
        target.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
        const heading = target.querySelector('h2');
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
  });
  search.addEventListener('compositionstart', () => { clearTimeout(searchTimer); });
  search.addEventListener('compositionend', () => { clearTimeout(searchTimer); searchTimer = setTimeout(updateSearch, 140); });
  search.addEventListener('input', event => {
    clearTimeout(searchTimer);
    state.query = search.value.slice(0, 100);
    if (event.isComposing) return;
    $('#clearSearch').hidden = !search.value;
    $('#searchShortcut').hidden = Boolean(search.value);
    searchTimer = setTimeout(updateSearch, 140);
  });
  search.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      clearTimeout(searchTimer);
      updateSearch();
    }
  });
  $('#clearSearch').addEventListener('click', () => {
    search.value = '';
    updateSearch();
    search.focus();
  });
  $('#clearFilters').addEventListener('click', event => {
    navigate({
      work: null,
      category: 'all',
      query: '',
      view: ['library', 'journal'].includes(event.currentTarget.dataset.action) ? event.currentTarget.dataset.action : state.view
    }, { focus: '#libraryTitle' });
  });
  $('#retryCatalog').addEventListener('click', hydrateCatalog);
  document.addEventListener('keydown', event => {
    if (event.isComposing) return;
    const editable = event.target.matches('input,textarea,select,[contenteditable="true"]');
    if (event.key === '/' && !editable && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      search.focus();
    }
    if (event.key === 'Escape') {
      if (state.work && !editable) {
        event.preventDefault();
        closeDetail();
      } else if (event.target === search && search.value) {
        event.preventDefault();
        search.value = '';
        updateSearch();
        search.focus();
      }
    }
  });
  addEventListener('popstate', event => {
    clearTimeout(searchTimer);
    state = readRoute();
    const focusId = returnFocusId;
    updateScreen({ scroll: event.state?.scrollY || 0, animate: true }).then(() => {
      if (!state.work && focusId) {
        const itemLink = grid.querySelector('.resource-title [data-work="' + focusId + '"]');
        focusTarget(itemLink || headingForView());
        returnFocusId = null;
      } else {
        focusTarget(headingForView());
      }
    });
  });
  addEventListener('storage', event => {
    if (event.key !== favoriteKey && event.key !== null) return;
    favoriteIds = readFavorites();
    if (state.view === 'saved' && !state.work) updateScreen({ scroll: window.scrollY, animate: true });
    else {
      paintNavigation();
      paintSaveButtons();
    }
  });
  async function fetchJson(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error('读取失败');
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
  async function hydrateCatalog() {
    if (catalogRequest) return catalogRequest;
    catalogStatus = 'loading';
    await updateScreen({ animate: false });
    catalogRequest = (async () => {
      try {
        const payload = await fetchJson('data/resources.json');
        resources = parseCatalog(payload);
        resourceMap = new Map(resources.map(item => [item.id, item]));
        catalogStatus = 'ready';
      } catch (_) {
        catalogStatus = 'error';
      } finally {
        catalogRequest = null;
        await updateScreen({ animate: true });
      }
    })();
    return catalogRequest;
  }
  async function hydrateChannel(name) {
    const config = channelConfig[name];
    if (!config || channelRequests.has(name)) return channelRequests.get(name);
    const card = $('#' + name + 'Card');
    const date = $('#' + name + 'Date');
    const headline = $('#' + name + 'Headline');
    const meta = $('#' + name + 'Meta');
    const link = $('#' + name + 'Link');
    const retry = $('[data-retry-channel="' + name + '"]');
    card.setAttribute('aria-busy', 'true');
    retry.hidden = true;
    const request = (async () => {
      try {
        const edition = latestEdition(await fetchJson(config.manifest));
        if (!edition) {
          date.textContent = '暂无已发布期次';
          date.removeAttribute('datetime');
          headline.textContent = '第一份简报准备好后会显示在这里';
          meta.textContent = '北京时间 11:00 发布';
          link.href = config.link;
          link.textContent = '进入频道';
          return;
        }
        date.textContent = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(edition.date + 'T00:00:00+08:00'));
        date.dateTime = edition.date;
        headline.textContent = edition.headline || edition.title || config.fallback;
        meta.textContent = (Number.isInteger(edition.issue) && edition.issue > 0 ? '第 ' + edition.issue + ' 期 · ' : '') + '北京时间 11:00 发布';
        link.href = config.link + '?date=' + encodeURIComponent(edition.date);
        link.innerHTML = '阅读最新一期' + icon('arrow');
      } catch (_) {
        date.textContent = '暂时无法读取';
        date.removeAttribute('datetime');
        headline.textContent = '可重试，或直接进入频道查看归档';
        meta.textContent = '请检查网络连接';
        link.href = config.link;
        link.textContent = '进入频道';
        retry.hidden = false;
      } finally {
        card.setAttribute('aria-busy', 'false');
        channelRequests.delete(name);
      }
    })();
    channelRequests.set(name, request);
    return request;
  }
  function refreshArchives() {
    archivesCheckedAt = Date.now();
    return Promise.allSettled(Object.keys(channelConfig).map(hydrateChannel));
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - archivesCheckedAt > 60000) refreshArchives();
  });
  addEventListener('pagehide', saveScroll);
  history.scrollRestoration = 'manual';
  history.replaceState({ ...history.state, shelf: true, scrollY: history.state?.scrollY || 0 }, '', location.href);
  render();
  hydrateCatalog();
  refreshArchives();
})();
