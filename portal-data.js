/* Resource catalog and archive selection shared by the homepage and its checks. */
(() => {
  'use strict';
  const categoryLabels = Object.freeze({ tools: '软件工具', design: '网页设计', game: '游戏资源' });
  const covers = { tools: 'download', design: 'reading', game: 'blocks' };
  const statuses = { published: '已发布', developing: '制作中', example: '示例项目', draft: '草稿' };
  const validId = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64;
  const validDate = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  function resourceUrl(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value !== value.trim() || /[\u0000-\u0020\\]/.test(value)) throw new Error('资源链接格式不正确');
    if (!/^(?:https:\/\/|\/(?!\/)|\.\/)/i.test(value)) throw new Error('资源链接必须是 HTTPS 或站内路径');
    const relative = /^\.?\//.test(value) && !value.startsWith('//');
    const url = new URL(value, 'https://springhues.com/');
    if ((!relative && url.protocol !== 'https:') || url.username || url.password) throw new Error('资源外链只允许无账号信息的 HTTPS 地址');
    if (relative && url.origin !== 'https://springhues.com') throw new Error('相对资源链接不得跳转到其他网站');
    if (url.origin === 'https://springhues.com' && /^\/admin(?:\/|$)/i.test(url.pathname)) throw new Error('资源库不能公开后台入口');
    return relative ? url.pathname + url.search + url.hash : url.href;
  }
  function parseCatalog(payload, { now = Date.now(), includeUnpublished = false } = {}) {
    if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.resources)) throw new Error('资源清单格式不正确');
    if (payload.resources.length > 1000) throw new Error('资源清单过大');
    const seen = new Set();
    const text = (value, field, required = false, max = 4000) => {
      if (value == null && !required) return '';
      if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) throw new Error(field + '格式不正确');
      return value.trim();
    };
    const list = (value, field) => {
      if (value == null) return [];
      if (!Array.isArray(value) || value.length > 30) throw new Error(field + '必须是文本列表');
      return value.map(entry => text(entry, field, true, 500));
    };
    const resources = payload.resources.map(source => {
      if (!source || !validId(source.id) || seen.has(source.id)) throw new Error('资源 ID 无效或重复');
      seen.add(source.id);
      if (!Object.hasOwn(categoryLabels, source.category)) throw new Error('资源分类无效');
      if (!Object.hasOwn(statuses, source.status)) throw new Error('资源状态无效');
      const publishAt = source.publishAt || null;
      if (publishAt && (typeof publishAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(publishAt) || !validDate(publishAt.slice(0, 10)) || !Number.isFinite(Date.parse(publishAt)))) throw new Error('资源发布时间必须包含时区');
      if (source.updatedAt && !validDate(source.updatedAt)) throw new Error('资源更新日期无效');
      const downloadUrl = resourceUrl(source.downloadUrl);
      const sourceUrl = resourceUrl(source.sourceUrl);
      if (source.status === 'example' && downloadUrl) throw new Error('示例资源不能提供实际下载');
      const filename = text(source.filename, '下载文件名', false, 200);
      if (filename && /[\\/:*?"<>|\u0000-\u001f]/.test(filename)) throw new Error('下载文件名无效');
      return {
        id: source.id,
        title: text(source.title, '资源名称', true, 120),
        subtitle: text(source.subtitle, '副标题', false, 200),
        description: text(source.description, '资源介绍', true, 1500),
        category: source.category,
        categoryLabel: categoryLabels[source.category],
        cover: covers[source.category],
        status: source.status,
        statusLabel: statuses[source.status],
        example: source.status === 'example',
        version: text(source.version, '版本', false, 100),
        fileSize: text(source.fileSize, '文件大小', false, 100),
        platforms: list(source.platforms, '适用平台'),
        tags: list(source.tags, '标签'),
        features: list(source.features, '功能'),
        requirements: list(source.requirements, '适用条件'),
        statement: text(source.statement, '使用说明'),
        downloadLabel: text(source.downloadLabel, '下载按钮', false, 40) || '下载资源',
        sourceLabel: text(source.sourceLabel, '来源按钮', false, 40) || '项目主页',
        downloadUrl, sourceUrl, filename, publishAt,
        updatedAt: source.updatedAt || null
      };
    });
    return includeUnpublished ? resources : resources.filter(item => item.status !== 'draft' && (!item.publishAt || Date.parse(item.publishAt) <= now));
  }
  function publishedEditions(manifest, now = Date.now()) {
    if (!manifest || !Array.isArray(manifest.editions)) throw new Error('日报索引格式不正确');
    return manifest.editions.filter(edition =>
      edition && validDate(edition.date) &&
      edition.publishAt === edition.date + 'T11:00:00+08:00' &&
      Date.parse(edition.publishAt) <= now
    ).sort((a, b) => b.date.localeCompare(a.date));
  }
  function latestEdition(manifest, now = Date.now()) {
    return publishedEditions(manifest, now)[0] || null;
  }
  function matchesResource(item, query) {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const haystack = [item.title, item.subtitle, item.description, item.categoryLabel,
      ...item.platforms, ...item.tags, ...item.features].join(' ').toLocaleLowerCase();
    return terms.every(term => haystack.includes(term));
  }
  globalThis.SpringhuesPortalData = Object.freeze({ categoryLabels, validId, resourceUrl, parseCatalog, latestEdition, publishedEditions, matchesResource });
})();
