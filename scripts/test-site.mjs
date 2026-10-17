import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { assertGameArchiveConsistency, assertManifestEdition, assertMinshengArchiveConsistency } from "./archive-consistency.mjs";
import { assertPublishTime as assertGamePublishTime, beijingDate, validateGame } from "./game-lib.mjs";
import { httpFallbackBase, tlsCertificateCode } from "./health-lib.mjs";
import { SOURCE_POLICY_VERSION, assertPublishTime as assertMinshengPublishTime, validateMinsheng, validateMinshengSourceAudit } from "./minsheng-lib.mjs";
import { requiredSourceLabels } from "./source-registry.mjs";

const root = process.cwd();
const civicManifest = await readJson("data/minsheng/index.json");
const gameManifest = await readJson("data/index.json");

for (const [name, manifest] of [["民生", civicManifest], ["游戏", gameManifest]]) {
  assert(manifest.timezone === "Asia/Shanghai", `${name}频道时区必须为 Asia/Shanghai`);
  // Legacy display metadata does not govern cron or production admission.
  assert(manifest.generateAt === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(manifest.generateAt), `${name} generateAt 若提供须为有效 HH:mm`);
  assert(manifest.publishAt === "11:00", `${name}频道必须在 11:00 发布`);
  assert(Array.isArray(manifest.editions) && manifest.editions.length > 0, `${name}频道必须至少有一期归档`);
  assert(new Set(manifest.editions.map((edition) => edition.date)).size === manifest.editions.length, `${name}归档日期不能重复`);
  assert(new Set(manifest.editions.map((edition) => edition.issue)).size === manifest.editions.length, `${name}归档期号不能重复`);
  assert(isSorted(manifest.editions), `${name}归档必须按日期倒序`);
  for (const edition of manifest.editions) {
    assert(edition.publishAt === `${edition.date}T11:00:00+08:00`, `${name} ${edition.date} 发布时间必须为北京时间11:00`);
    assert(new Date(edition.publishAt).getTime() <= Date.now(), `${name} ${edition.date} 尚未到发布时间，不得进入公开归档`);
    if (edition.backfilledAt) {
      assert(Number.isFinite(new Date(edition.backfilledAt).getTime()), `${name} ${edition.date} 补档时间无效`);
      assert(new Date(edition.backfilledAt) > new Date(edition.publishAt), `${name} ${edition.date} 补档时间必须晚于计划发布时间`);
    }
    await access(path.join(root, edition.file));
  }
}

const latestCivic = civicManifest.editions[0];
const civic = await readJson(latestCivic.file);
validateMinsheng(civic, { expectedDate: latestCivic.date });
assert(Object.values(civic.sections).flat().length === 35, "最新民生日报必须包含35条新闻");
assert(civic.topStoryIds.length === 3, "最新民生日报必须包含3条正文引用式头条");

const civicBriefs = [];
for (const edition of civicManifest.editions) {
  const brief = await readJson(edition.file);
  validateMinsheng(brief, { expectedDate: edition.date });
  assertManifestEdition(edition, brief, "民生日报");
  civicBriefs.push(brief);
}
for (const brief of civicBriefs) assertMinshengArchiveConsistency(brief, civicBriefs);
for (const edition of civicManifest.editions) {
  await assertPng(path.join(root, "downloads", "minsheng", `${edition.date}.png`), `民生日报 ${edition.date}`);
}

const latestGame = gameManifest.editions[0];
const game = await readJson(latestGame.file);
validateGame(game, { expectedDate: latestGame.date });
assert(latestGame.date <= beijingDate(), "最新游戏日报日期不得晚于北京时间当天");

const gameBriefs = [];
for (const edition of gameManifest.editions) {
  const brief = await readJson(edition.file);
  validateGame(brief, { expectedDate: edition.date });
  assertManifestEdition(edition, brief, "游戏日报");
  gameBriefs.push(brief);
}
for (const brief of gameBriefs) assertGameArchiveConsistency(brief, gameBriefs);
for (const edition of gameManifest.editions) {
  await assertPng(path.join(root, "downloads", "game", `${edition.date}.png`), `游戏日报 ${edition.date}`);
}

const copiedGame = structuredClone(game);
copiedGame.date = nextIsoDate(game.date);
assertThrows(() => assertGameArchiveConsistency(copiedGame, gameBriefs), "复制上一期的游戏日报必须被拒绝");
const copiedCivic = structuredClone(civic);
copiedCivic.date = nextIsoDate(civic.date);
assertThrows(() => assertMinshengArchiveConsistency(copiedCivic, civicBriefs), "复制上一期的民生日报必须被拒绝");

assertThrows(() => assertGamePublishTime("2026-08-24", new Date("2026-08-24T10:59:59+08:00")), "游戏日报必须拒绝11:00前发布");
assertThrows(() => assertMinshengPublishTime("2026-08-24", new Date("2026-08-24T10:59:59+08:00")), "民生日报必须拒绝11:00前发布");
assertGamePublishTime("2026-08-24", new Date("2026-08-24T11:00:00+08:00"));
assertMinshengPublishTime("2026-08-24", new Date("2026-08-24T11:00:00+08:00"));

const certificateError = Object.assign(new Error("fetch failed"), {
  cause: Object.assign(new Error("hostname mismatch"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" })
});
assert(tlsCertificateCode(certificateError) === "ERR_TLS_CERT_ALTNAME_INVALID", "健康检查必须识别嵌套的 HTTPS 证书错误");
assert(tlsCertificateCode(Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } })) === null, "普通网络故障不得伪装成证书错误");
assert(httpFallbackBase("https://springhues.com/") === "http://springhues.com", "证书错误时只能降级到同一域名的 HTTP 地址");
assert(httpFallbackBase("http://springhues.com") === null, "HTTP 地址不得重复降级");

for (const mutate of [
  (brief) => brief.mods.pop(),
  (brief) => { brief.news[1].title = brief.news[0].title; },
  (brief) => { brief.features[0].url = "http://example.com/story"; },
  (brief) => { brief.deals[0].image = "../secret.png"; },
  (brief) => { brief.news[0].date = "2025-01-01"; },
  (brief) => { brief.news[0].date = "2026-08-21"; },
  (brief) => { brief.cutoff = "2026-08-22 10:50（北京时间）"; },
  (brief) => { brief.news[0].summary = '<img src=x onerror="alert(1)">'; }
]) {
  const invalid = structuredClone(game);
  mutate(invalid);
  assertThrows(() => validateGame(invalid), "不合规游戏日报必须被拒绝");
}

const invalidCivic = structuredClone(civic);
invalidCivic.metrics = invalidCivic.metrics.filter((metric) => metric.kind !== "gold");
assertThrows(() => validateMinsheng(invalidCivic), "缺少必需指标的民生日报必须被拒绝");

const sourcePolicyBrief = makeSourcePolicyBrief(civic);
validateMinsheng(sourcePolicyBrief, { expectedDate: "2026-08-25" });
validateMinshengSourceAudit(sourcePolicyBrief, makeSourceAudit(sourcePolicyBrief));

const missingSourcePolicy = structuredClone(sourcePolicyBrief);
delete missingSourcePolicy.sourcePolicyVersion;
assertThrows(() => validateMinsheng(missingSourcePolicy), "2026-08-25起必须使用来源策略v2");

const missingSourceOrigin = structuredClone(sourcePolicyBrief);
delete missingSourceOrigin.sections.ai[0].sourceOrigin;
assertThrows(() => validateMinsheng(missingSourceOrigin), "来源策略v2必须拒绝缺少来源归属的新闻");

const companyDisguisedAsChinaMedia = structuredClone(sourcePolicyBrief);
companyDisguisedAsChinaMedia.sections.ai[0].source = "OpenAI";
companyDisguisedAsChinaMedia.sections.ai[0].url = "https://openai.com/news/example";
assertThrows(() => validateMinsheng(companyDisguisedAsChinaMedia), "AI公司官网不得伪装成国内权威媒体");

const externalStory = structuredClone(sourcePolicyBrief);
externalStory.sections.ai[0].source = "OpenAI";
externalStory.sections.ai[0].sourceOrigin = "external";
externalStory.sections.ai[0].url = "https://openai.com/news/example";
externalStory.sources.push("OpenAI");
validateMinsheng(externalStory);
const externalStoryAudit = makeSourceAudit(externalStory);
validateMinshengSourceAudit(externalStory, externalStoryAudit);

const externalOveruseAudit = structuredClone(externalStoryAudit);
externalOveruseAudit.categories.ai.usableChinaCandidates += 1;
assertThrows(() => validateMinshengSourceAudit(externalStory, externalOveruseAudit), "仍有国内候选时不得超额使用外网来源");

const incompleteAttemptAudit = structuredClone(externalStoryAudit);
incompleteAttemptAudit.categories.ai.attemptedChinaSources = incompleteAttemptAudit.categories.ai.attemptedChinaSources.filter((source) => source !== "中国科技网");
assertThrows(() => validateMinshengSourceAudit(externalStory, incompleteAttemptAudit), "外网补足前必须记录完整的国内来源尝试");

const domesticStoryMarkedExternal = structuredClone(sourcePolicyBrief);
domesticStoryMarkedExternal.sections.international[0].sourceOrigin = "external";
assertThrows(() => validateMinsheng(domesticStoryMarkedExternal), "国内权威媒体主链接不得标记为外网");

const manuallyMarkedStory = structuredClone(externalStory);
manuallyMarkedStory.sections.ai[0].source = "OpenAI（来自于外网）";
assertThrows(() => validateMinsheng(manuallyMarkedStory), "外网标记必须由页面生成，不能手写到来源字段");

const externalMetric = structuredClone(sourcePolicyBrief);
externalMetric.metrics[2].source = "ICE";
externalMetric.metrics[2].sourceUrl = "https://www.ice.com/products/219/Brent-Crude-Futures";
externalMetric.metrics[2].sourceOrigin = "external";
externalMetric.metricSources = [...new Set(externalMetric.metrics.map((metric) => metric.source))];
validateMinsheng(externalMetric);
validateMinshengSourceAudit(externalMetric, makeSourceAudit(externalMetric));

const clsMetric = structuredClone(sourcePolicyBrief);
clsMetric.metrics[2].source = "财联社";
clsMetric.metrics[2].sourceUrl = "https://www.cls.cn/detail/2495271";
clsMetric.metrics[2].sourceOrigin = "china";
clsMetric.metricSources = [...new Set(clsMetric.metrics.map((metric) => metric.source))];
validateMinsheng(clsMetric);
validateMinshengSourceAudit(clsMetric, makeSourceAudit(clsMetric));
const clsMarkedExternal = structuredClone(clsMetric);
clsMarkedExternal.metrics[2].sourceOrigin = "external";
assertThrows(() => validateMinsheng(clsMarkedExternal), "财联社数据不得误标为外网");
const fakeClsMetric = structuredClone(clsMetric);
fakeClsMetric.metrics[2].sourceUrl = "https://cls.cn.example.org/detail/2495271";
assertThrows(() => validateMinsheng(fakeClsMetric), "相似域名不得冒充国内财经来源");

const incompleteExternalMetric = structuredClone(externalMetric);
delete incompleteExternalMetric.metrics[2].sourceOrigin;
assertThrows(() => validateMinsheng(incompleteExternalMetric), "外网数据必须声明来源归属");

const civicHtml = await readFile(path.join(root, "minsheng", "index.html"), "utf8");
assert(!/天气|weather/i.test(civicHtml), "民生日报页面不得包含天气区域");
for (const id of ["domesticStories", "internationalStories", "techStories", "aiStories", "archiveDate"]) {
  assert(civicHtml.includes(`id="${id}"`), `页面缺少 ${id}`);
}
assert(civicHtml.includes('href="mobile-fix.css'), "民生日报必须加载移动端布局修复样式");
assert(civicHtml.includes('href="aligned-layout.css') && civicHtml.includes("简简单单，读懂世界"), "民生日报必须加载正式对齐样式与新版副标语");
assert(civicHtml.includes('<span class="calendar" aria-hidden="true"><img src="../brand-assets/springhues-logo.png"'), "民生日报日期区必须使用个人 Logo");
assert(civicHtml.includes('id="downloadPng"') && civicHtml.includes("下载当天 PNG 原图"), "民生日报底部必须提供 PNG 原图下载按钮");
const mobileCss = await readFile(path.join(root, "minsheng", "mobile-fix.css"), "utf8");
assert(/position:\s*static/.test(mobileCss), "移动端栏目标题必须参与正常文档流，避免覆盖首条新闻");
const alignedCss = await readFile(path.join(root, "minsheng", "aligned-layout.css"), "utf8");
assert(alignedCss.includes("--panel-border: #242424") && alignedCss.includes("@media (max-width: 1180px)"), "民生日报对齐样式必须包含黑色边框与响应式回退");
const alignedCivicApp = await readFile(path.join(root, "minsheng", "app.js"), "utf8");
assert(alignedCivicApp.includes("function alignStoryRows()") && alignedCivicApp.includes("scheduleStoryAlignment();"), "民生日报必须在渲染后动态同步新闻行高");

const gameHtml = await readFile(path.join(root, "game", "index.html"), "utf8");
const portalHtml = await readFile(path.join(root, "index.html"), "utf8");
for (const id of ["worksWall", "civicLink", "gameLink"]) {
  assert(portalHtml.includes(`id="${id}"`), `个人首页缺少资源或日报入口 ${id}`);
}
assert(portalHtml.includes('href="minsheng/"') && portalHtml.includes('href="game/"'), "首页须保留可直接访问的双频道链接");
assert(portalHtml.includes('src="brand-assets/springhues-logo.png"') && !portalHtml.includes("character-hero"), "个人首页使用指定 Logo，不展示 OC 图片");
assert(portalHtml.includes('site/css/tokens.css') && portalHtml.includes('portal-data.js') && !/href=["'](?:\.\/)?admin\//.test(portalHtml), "新首页须引用 SHARD 样式与日报索引脚本，且不公开后台入口");
await import("../portal-data.js");
globalThis.SpringhuesPortalData.parseCatalog(await readJson("data/resources.json"), { includeUnpublished: true });
await import("./test-portal-data.mjs");
assert(gameHtml.includes('<a href="./">首页</a>') && civicHtml.includes('<a href="../">首页</a>'), "双频道导航入口必须统一命名为首页");
assert(!gameHtml.includes("双频道首页") && !civicHtml.includes("双频道首页"), "频道导航不得继续显示双频道首页旧名称");
for (const sharedHeaderClass of ["site-bar", "mini-brand", "archive-trigger"]) {
  assert(civicHtml.includes(`class="${sharedHeaderClass}`) && gameHtml.includes(`class="${sharedHeaderClass}`), `双频道页头必须共用 ${sharedHeaderClass} 结构`);
}
assert(gameHtml.includes('<a class="active" href="game/">游戏日报</a>'), "游戏日报页头必须标记游戏频道为当前频道");
assert(gameHtml.includes('id="navDate"'), "游戏日报统一页头必须显示当前期次日期");
assert(gameHtml.includes('id="archiveDate"') && gameHtml.includes("按日期选择"), "游戏日报归档弹窗必须提供日期选择器");
assert(gameHtml.includes('id="downloadPng"') && gameHtml.includes("下载当天 PNG 原图"), "游戏日报底部必须提供 PNG 原图下载按钮");
assert(gameHtml.includes('id="dealSummary"') && gameHtml.includes('id="dealList" tabindex="0"') && gameHtml.includes('id="dealScrollThumb"'), "Steam 优惠必须提供数量摘要、可键盘滚动的列表和可见滚动指示器");
assert(gameHtml.includes("<b>05</b> Steam 今日优惠") && gameHtml.includes('class="section-no dark">06</span>'), "Steam 与趋势板块必须使用当前 05/06 编号");
assert(gameHtml.includes('class="hero-logo-stage"') && gameHtml.includes('src="brand-assets/springhues-logo.png"'), "游戏日报首屏必须展示 Springhues Logo");
assert(!gameHtml.includes('class="ticker"'), "游戏日报不得保留黑色滚动栏目条");
assert(!gameHtml.includes('id="headlines"'), "游戏日报不得恢复今日头条板块");
const platformOrder = ["store.steampowered.com", "store.epicgames.com", "www.mcmod.cn", "www.minebbs.com"];
let previousPlatformIndex = -1;
for (const platform of platformOrder) {
  const platformIndex = gameHtml.indexOf(platform);
  assert(platformIndex > previousPlatformIndex, `游戏平台快捷入口缺失或顺序错误：${platform}`);
  previousPlatformIndex = platformIndex;
}
assert(gameHtml.includes("<b>01</b> 中国玩家关注") && gameHtml.includes("<b>02</b> Minecraft 热门整合包"), "游戏日报正文板块必须从 01 开始编号");
assert(/<[^>]+id="features"[^>]+class="[^"]*feature-grid[^"]*"[^>]*>/.test(gameHtml) && !/<[^>]+id="features"[^>]+hidden/.test(gameHtml), "游戏日报必须可见渲染两张焦点卡片");
assert(!gameHtml.includes(">报</span>") && !civicHtml.includes(">报</span>"), "双频道页头不得继续显示旧的报字标识");
assert(gameHtml.includes("brand-assets/springhues-logo.png") && civicHtml.includes("../brand-assets/springhues-logo.png"), "双频道页头必须使用唯一的 Springhues 正式 Logo");
await access(path.join(root, "brand-assets", "springhues-logo.png"));

const gameApp = await readFile(path.join(root, "app.js"), "utf8");
const civicApp = await readFile(path.join(root, "minsheng", "app.js"), "utf8");
assert(gameApp.includes("历史补档"), "游戏日报必须诚实标记后补的历史期次");
assert(!/\.innerHTML\s*=/.test(gameApp), "游戏页面不得使用 innerHTML 拼接日报数据");
assert(gameApp.includes("textContent") && gameApp.includes("replaceChildren"), "游戏页面必须使用安全 DOM API 渲染");
assert(gameApp.includes('parsed.protocol !== "https:"'), "游戏页面必须限制外链为 HTTPS");
assert(gameApp.includes("safeImage(item.image, item.name)"), "Minecraft 整合包必须渲染经过安全路径校验的封面");
for (const [name, app] of [["游戏", gameApp], ["民生", civicApp]]) {
  assert(app.includes('element("a", "archive-item")') || app.includes('document.createElement("a")'), `${name}归档必须使用可直接访问的日期链接`);
  assert(app.includes('url.searchParams.set("date", date)'), `${name}归档链接必须携带所选日期`);
  assert(app.includes('dataUrl.searchParams.set("edition", edition.date)'), `${name}日报数据请求必须按期次刷新缓存`);
  assert(app.includes('date !== edition.date'), `${name}日报必须拒绝正文日期与索引不匹配`);
  assert(app.includes("downloadPng.download"), `${name}日报必须按所选期次设置 PNG 下载文件名`);
}
assert(gameApp.includes("downloads/game/${encodeURIComponent(brief.date)}.png"), "游戏日报下载按钮必须跟随所选归档日期");
assert(gameApp.includes("edition.headline || edition.title"), "游戏日报归档列表必须显示每期具体头条");
assert(gameApp.includes('$("#archiveDate").min') && gameApp.includes('$("#archiveDate").max'), "游戏日报日期选择器必须限制在公开归档范围");
assert(gameApp.includes('addEventListener("change", (event) => navigateToDate(event.target.value))'), "游戏日报日期选择器必须支持按日期跳转");
assert(civicApp.includes("downloads/minsheng/${encodeURIComponent(brief.date)}.png"), "民生日报下载按钮必须跟随所选归档日期");
assert(civicApp.includes("（来自于外网）") && civicApp.includes("formatSource"), "民生日报必须统一渲染外网来源标记");
assert(gameHtml.includes("app.js?v=20261017-unified"), "游戏日报脚本必须使用统一主题缓存版本");
assert(civicHtml.includes("app.js?v=20261017-unified"), "民生日报脚本必须使用统一主题缓存版本");
const gameCss = await readFile(path.join(root, "styles.css"), "utf8");
assert(gameCss.includes(".deal-list") && gameCss.includes("overflow-y:auto"), "Steam 优惠必须在固定板块内纵向滚动");
assert(gameCss.includes(".png-capture .deal-row:nth-child(n+7)"), "PNG 截图必须只展示前 6 款 Steam 优惠");

for (const file of ["index.html", "game/index.html", "minsheng/index.html", "portal.js", "minsheng/app.js", "scripts/game-lib.mjs"]) {
  await access(path.join(root, file));
}
await import("./test-home.mjs");
console.log(`站点测试通过：动态校验 ${latestCivic.date} 民生日报与 ${latestGame.date} 游戏日报，发布时间、完整结构和安全渲染均有效。`);

async function readJson(file) { return JSON.parse(await readFile(path.join(root, file), "utf8")); }
async function assertPng(file, label) {
  const buffer = await readFile(file);
  assert(buffer.length > 24, `${label} PNG 文件不能为空`);
  assert(buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${label} 必须是有效 PNG`);
  assert(buffer.readUInt32BE(16) === 3840, `${label} PNG 宽度必须为 3840px`);
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function nextIsoDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
function makeSourcePolicyBrief(brief) {
  const candidate = structuredClone(brief);
  delete candidate.backfilledAt;
  candidate.date = "2026-08-25";
  candidate.sourcePolicyVersion = SOURCE_POLICY_VERSION;
  candidate.cutoff = "2026-08-25 10:45（北京时间）";
  candidate.productionTime = "2026-08-25 10:50（北京时间）";
  candidate.metricsCutoff = "2026-08-25 10:40（北京时间）";
  for (const [category, stories] of Object.entries(candidate.sections)) {
    stories.forEach((story, index) => {
      story.source = index % 3 === 0 ? "新华社" : index % 3 === 1 ? "科技日报" : "央视新闻";
      story.sourceOrigin = "china";
      story.url = `https://www.news.cn/${category}/source-policy-${index + 1}.html`;
      story.publishedAt = "2026-08-24 09:00";
    });
  }
  candidate.sources = ["新华社", "科技日报", "央视新闻"];
  const metricSources = {
    gold: ["上海黄金交易所", "https://www.sge.com.cn/"],
    domestic_oil: ["国家发展改革委", "https://www.ndrc.gov.cn/"],
    international_oil: ["第一财经", "https://www.yicai.com/"],
    international_oil_wti: ["第一财经", "https://www.yicai.com/"],
    usd_cny: ["中国外汇交易中心", "https://www.chinamoney.com.cn/chinese/bkccpr/"],
    eur_cny: ["中国外汇交易中心", "https://www.chinamoney.com.cn/chinese/bkccpr/"],
    jpy_cny: ["中国外汇交易中心", "https://www.chinamoney.com.cn/chinese/bkccpr/"]
  };
  for (const metric of candidate.metrics) {
    const [source, sourceUrl] = metricSources[metric.kind];
    metric.note = "8月25日最近有效数据";
    metric.source = source;
    metric.sourceUrl = sourceUrl;
    metric.sourceOrigin = "china";
  }
  candidate.metricSources = [...new Set(candidate.metrics.map((metric) => metric.source))];
  return candidate;
}
function makeSourceAudit(brief) {
  const entry = (items, section) => {
    const finalChinaCount = items.filter((item) => item.sourceOrigin === "china").length;
    const finalExternalCount = items.filter((item) => item.sourceOrigin === "external").length;
    return {
      attemptedChinaSources: requiredSourceLabels("minsheng", section),
      usableChinaCandidates: finalChinaCount,
      rejectedChinaCandidates: finalExternalCount ? 1 : 0,
      rejectionReasons: finalExternalCount ? ["候选超出时效或与既有新闻重复"] : [],
      shortageReason: finalExternalCount ? "已穷尽国内来源，符合时效和去重要求的候选不足" : "",
      finalChinaCount,
      finalExternalCount
    };
  };
  return {
    date: brief.date,
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    categories: {
      domestic: entry(brief.sections.domestic, "domestic"),
      international: entry(brief.sections.international, "international"),
      tech: entry(brief.sections.tech, "tech"),
      ai: entry(brief.sections.ai, "ai")
    },
    metrics: entry(brief.metrics, "metrics")
  };
}
function assertThrows(callback, message) {
  let rejected = false;
  try { callback(); } catch { rejected = true; }
  assert(rejected, message);
}
function isSorted(editions) { return editions.every((edition, index) => index === 0 || editions[index - 1].date >= edition.date); }
// 日报页与后台仍用旧外壳（日报导出器消费它们），留言/隐私页换成 SHARD 外壳。
for (const [entry,page] of [["game/index.html","game"],["minsheng/index.html","minsheng"],["admin/messages/index.html","admin"]]) {
  const html = await readFile(path.join(root,entry),"utf8");
  assert(html.includes('data-site-page="'+page+'"') && html.includes('site-shell.js?v=20261017-unified'), entry+" 缺少统一导航与主题入口");
}
const { SHARD_VERSION } = await import("./check-shard-style.mjs");
for (const [entry,page] of [["messages/index.html","messages"],["privacy/index.html","privacy"]]) {
  const html = await readFile(path.join(root,entry),"utf8");
  assert(html.includes('data-site-page="'+page+'"') && html.includes(`site/js/shell/shell.js?v=${SHARD_VERSION}`) && html.includes(`site/css/shard-theme.css?v=${SHARD_VERSION}`) && html.includes(`site/boot.js?v=${SHARD_VERSION}`), entry+" 缺少 SHARD 外壳入口");
  assert(!/site-shell\.js|brand\.css|portal\.css|site-rail/.test(html), entry+" 不得再引用旧外壳（侧栏 / 月影主题）");
  assert(!/href=["'](?:\.\.?\/)?admin\//.test(html), entry+" 不得链接后台");
}
for (const part of ["site/boot.js", "shard-theme.css", "wipe.css", "pages-daily.css", "site/js/shell/shell.js"]) {
  assert(gameHtml.includes(`${part}`) && civicHtml.includes(`${part}`), `日报页须引用 SHARD 外壳：${part}`);
}
assert(gameHtml.includes(`site/boot.js?v=${SHARD_VERSION}`) && civicHtml.includes(`../site/boot.js?v=${SHARD_VERSION}`), "日报页外壳引用须带 SHARD_VERSION 戳");
assert(gameHtml.includes('class="header-message-link" href="messages/"') && civicHtml.includes('class="header-message-link" href="../messages/"'), "日报页头留言入口保持不变");
assert(civicHtml.includes('aligned-layout.css?v=20260825-aligned-layout') && civicHtml.includes('mobile-fix.css?v=20260824-download-png'), "民生日报须保留 aligned-layout.css 与 mobile-fix.css 引用");
assert(!(await readFile(path.join(root,"admin/messages/index.html"),"utf8")).includes("shard"), "后台页不得引入 SHARD 外壳");
// 日报页隔离：被导出器消费的文件里不得出现 SHARD 外壳（导出视觉不变）。
for (const f of ["brand.css", "styles.css", "site-shell.js", "app.js", "minsheng/styles.css", "minsheng/mobile-fix.css", "minsheng/aligned-layout.css", "minsheng/message-link.css", "minsheng/app.js"]) {
  const text = await readFile(path.join(root,f),"utf8");
  assert(!/shard-|\.sd-|shard-live/.test(text), `${f} 被日报导出器消费，不得含 SHARD 外壳样式或类名`);
}
// 日报线上层只能走 html.shard-live 门控（导出运行时不带该类）。
const dailyLayer = await readFile(path.join(root,"site/css/pages-daily.css"),"utf8");
assert(!/\.story\b|\.metric\b/.test(dailyLayer.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\.story-(?:number|summary|meta)/g, "").replace(/\.metric-icon|\.metrics-cutoff/g, "")), "pages-daily 不得触碰 .story / .metric 的盒模型（保证桌面逐行对齐与移动端高度重置）");
