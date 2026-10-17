import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CONTENT_CANDIDATE_TARGETS, acquireRunLease, appendResearchLedger as recordRaw, assertGameDealCoverage, assertReadyProof, createReadyProof, freezeSteamDiscovery as freezeRaw, initializeRunState as initRaw, mergeSourceAudits as mergeRaw, reconcileRunState as reconcileRaw, releaseRunLease, researchCompleteness } from "./daily-operations.mjs";
import { archiveSeedRoot, evidenceFor, makeReadyFixture, materializeArchiveSeed } from './state-evidence-fixtures.mjs';
import { runDailyHealth } from "./check-daily-health.mjs";
import { validateGame } from "./game-lib.mjs";
import { validateMinshengSourceAudit } from "./minsheng-lib.mjs";
import { SOURCE_REGISTRY, canonicalSourceId, channelSections, requiredSourceIds, requiredSourceLabels } from "./source-registry.mjs";

const projectRoot = process.cwd();
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "daily-operations-"));

// Each legacy test operation obtains its own explicit fixture lease. No production paths.
const fixtureLeases = new Map();
async function fixtureLease(root, date, runId = 'fixture', now = new Date(date+'T07:00:00+08:00')) {
  const key = root + '/' + date;
  const old = fixtureLeases.get(key);
  if (old && old !== runId) await releaseRunLease(root,{date,runId:old,now});
  const lease = await acquireRunLease(root,{date,runId,now});
  assert(lease.acquired,'fixture lease must be acquired');
  fixtureLeases.set(key,runId);
  return {date,runId,now};
}
async function initializeRunState(root, options) { return initRaw(root,{...options,...await fixtureLease(root,options.date,options.runId)}); }
async function appendResearchLedger(root, options) {
  const lease = await fixtureLease(root,options.date,options.runId);
  const omit = options.channel==='game' && ['packs','mods'].includes(options.section) && options.evidenceComplete !== true;
  const candidateEvidence = omit ? [] : (options.candidateIds || []).map(id=>evidenceFor(id,options.date));
  return recordRaw(root,{...options,candidateEvidence,...lease});
}
async function freezeSteamDiscovery(root, options) { return freezeRaw(root,{...options,...await fixtureLease(root,options.date,options.runId)}); }
async function mergeSourceAudits(root, date) { return mergeRaw(root,date,await fixtureLease(root,date)); }
async function reconcileRunState(root,date) { return reconcileRaw(root,date,await fixtureLease(root,date)); }


try {
  await testSourceAliasesAndAudit();
  await testResumableLedger();
  await testSemanticCandidateCompleteness();
  await testAuditMerge();
  await testRunLease();
  await testReadyProof();
  await testGameRules();
  await testSteamAllVerifiedCoverage();
  await testHealthKeepsChecking();
  await testTlsDegradedSuccess();
  await import("./test-prune-archive.mjs");
  console.log("日报运行状态、来源门禁、游戏规则和健康检查测试通过。");
} finally {
  console.log(`保留隔离测试夹具：${tempRoot}`);
}

async function testSourceAliasesAndAudit() {
  assert(canonicalSourceId("新华社／新华网") === "xinhua", "新华社／新华网必须归一为新华网");
  assert(canonicalSourceId("科技日报／中国科技网") === "stdaily", "科技日报／中国科技网必须归一为中国科技网");
  const brief = {
    date: "2026-08-25",
    sourcePolicyVersion: 2,
    sections: {
      domestic: Array.from({ length: 10 }, () => ({ sourceOrigin: "china" })),
      international: Array.from({ length: 10 }, () => ({ sourceOrigin: "china" })),
      tech: Array.from({ length: 10 }, () => ({ sourceOrigin: "china" })),
      ai: Array.from({ length: 5 }, () => ({ sourceOrigin: "china" }))
    },
    metrics: Array.from({ length: 6 }, () => ({ sourceOrigin: "china" }))
  };
  const entry = (channel, section, count) => ({
    attemptedChinaSources: requiredSourceLabels(channel, section),
    usableChinaCandidates: count,
    rejectedChinaCandidates: 0,
    rejectionReasons: [],
    shortageReason: "",
    finalChinaCount: count,
    finalExternalCount: 0
  });
  const audit = {
    date: brief.date,
    sourcePolicyVersion: 2,
    categories: {
      domestic: entry("minsheng", "domestic", 10),
      international: entry("minsheng", "international", 10),
      tech: entry("minsheng", "tech", 10),
      ai: entry("minsheng", "ai", 5)
    },
    metrics: entry("minsheng", "metrics", 6)
  };
  audit.categories.domestic.attemptedChinaSources[0] = "新华社／新华网";
  audit.categories.tech.attemptedChinaSources[0] = "科技日报／中国科技网";
  validateMinshengSourceAudit(brief, audit);
  audit.categories.ai.attemptedChinaSources = audit.categories.ai.attemptedChinaSources.filter((source) => canonicalSourceId(source) !== "stdaily");
  assertThrows(() => validateMinshengSourceAudit(brief, audit), "未尝试的标准来源必须继续阻止发布");
}

async function testResumableLedger() {
  const root = path.join(tempRoot, "ledger");
  const date = "2026-08-25";
  await initializeRunState(root, { date, runId: "0930", kind: "main", minshengIssue: 4, gameIssue: 4 });
  await recordRequiredSources(root, date, "0930", "minsheng", { leaveLastStarted: true });
  let status = await researchCompleteness(root, date, "minsheng");
  assert(!status.complete, "存在 started 来源时检索不得被判定完成");
  const section = channelSections("minsheng").at(-1);
  const sourceId = requiredSourceIds("minsheng", section).at(-1);
  await appendResearchLedger(root, { date, runId: "1110", channel: "minsheng", section, sourceId, status: "accepted", availableCount: 1 });
  status = await researchCompleteness(root, date, "minsheng");
  assert(status.complete, "11:10补齐最后来源后应复用账本完成门禁");

  const gameRoot = path.join(tempRoot, "unavailable");
  await initializeRunState(gameRoot, { date, runId: "0930", kind: "main" });
  await recordRequiredSources(gameRoot, date, "0930", "game", { unavailableOnce: true });
  status = await researchCompleteness(gameRoot, date, "game");
  assert(!status.complete, "单次网站不可用不得被当成已穷尽");
  const firstSection = channelSections("game")[0];
  const firstSource = requiredSourceIds("game", firstSection)[0];
  await appendResearchLedger(gameRoot, { date, runId: "1110", channel: "game", section: firstSection, sourceId: firstSource, status: "unavailable", reasons: "第二次访问仍不可用" });
  status = await researchCompleteness(gameRoot, date, "game");
  assert(status.complete, "同一来源两次不可用且其他来源完成后才能判定穷尽");
}

async function recordRequiredSources(root, date, runId, channel, options = {}) {
  const pairs = channelSections(channel).flatMap((section) => requiredSourceIds(channel, section).map((sourceId) => ({ section, sourceId })));
  const seededSections = new Set();
  for (const [index, pair] of pairs.entries()) {
    const isLast = index === pairs.length - 1;
    const unavailable = options.unavailableOnce && index === 0;
    const target = CONTENT_CANDIDATE_TARGETS[channel][pair.section];
    const shouldSeed = !seededSections.has(pair.section) && !unavailable;
    const candidateCount = shouldSeed ? Math.min(target, options.candidateLimit ?? target) : 0;
    const candidateIds = Array.from({ length: candidateCount }, (_, candidateIndex) => `${channel}-${pair.section}-${candidateIndex + 1}`);
    if (shouldSeed) seededSections.add(pair.section);
    await appendResearchLedger(root, {
      date,
      runId,
      channel,
      ...pair,
      status: isLast && options.leaveLastStarted ? "started" : unavailable ? "unavailable" : "accepted",
      availableCount: unavailable ? 0 : Math.max(1, candidateIds.length),
      candidateIds,
      coverageComplete: channel === "game" && pair.section === "deals" && !unavailable,
      evidenceComplete: channel === "game" && ["packs", "mods"].includes(pair.section) && !options.omitEvidence && candidateIds.length >= target,
      reasons: unavailable ? "首次访问不可用" : ""
    });
  }
}

async function testSemanticCandidateCompleteness() {
  const date = "2026-08-26";
  const shallowRoot = path.join(tempRoot, "semantic-shortfall");
  await initializeRunState(shallowRoot, { date, runId: "0730", kind: "main" });
  await recordRequiredSources(shallowRoot, date, "0730", "minsheng", { candidateLimit: 1 });
  let status = await researchCompleteness(shallowRoot, date, "minsheng");
  assert(!status.complete && status.sections.domestic.shortfall === 9, "来源均有终态但候选数量不足时必须继续失败");
  await appendResearchLedger(shallowRoot, {
    date,
    runId: "0830",
    channel: "minsheng",
    section: "domestic",
    sourceId: "external-news-authority",
    tier: "fallback",
    status: "accepted",
    availableCount: 9,
    candidateIds: Array.from({ length: 9 }, (_, index) => `external-domestic-${index + 1}`),
    reasons: "国内必查来源已穷尽后补精确差额"
  });
  status = await researchCompleteness(shallowRoot, date, "minsheng");
  assert(status.sections.domestic.complete && status.sections.domestic.candidateCount === 10, "允许的外网权威回退候选必须能补精确差额");
  const reconciled = await reconcileRunState(shallowRoot, date);
  assert(reconciled.state.channels.minsheng.status === "researching" && !reconciled.state.channels.minsheng.missingSections.includes("domestic"), "reconcile必须从真实语义缺口更新状态并清除已补足栏目");

  const evidenceRoot = path.join(tempRoot, "semantic-evidence");
  await initializeRunState(evidenceRoot, { date, runId: "0830", kind: "main" });
  await recordRequiredSources(evidenceRoot, date, "0830", "game", { omitEvidence: true });
  status = await researchCompleteness(evidenceRoot, date, "game");
  assert(!status.complete && !status.sections.packs.evidenceComplete && !status.sections.mods.evidenceComplete, "整合包和Mod只有名称清单时不得伪装成证据闭环");
  for (const section of ["packs", "mods"]) {
    const target = CONTENT_CANDIDATE_TARGETS.game[section];
    await appendResearchLedger(evidenceRoot, {
      date,
      runId: "0930",
      channel: "game",
      section,
      sourceId: requiredSourceIds("game", section)[0],
      status: "accepted",
      availableCount: target,
      candidateIds: Array.from({ length: target }, (_, index) => `verified-${section}-${index + 1}`),
      revokedCandidateIds: Array.from({ length: target }, (_, index) => `game-${section}-${index + 1}`),
      reasons: ['replace unverified fixture candidates'],
      evidenceComplete: true
    });
  }
  status = await researchCompleteness(evidenceRoot, date, "game");
  assert(status.complete, "逐项证据和数量都闭环后游戏研究才可完成");
}

async function testAuditMerge() {
  const root = path.join(tempRoot, "audit");
  const directory = path.join(root, "artifacts", "operations");
  await mkdir(directory, { recursive: true });
  const makeEntry = (section, finalChinaCount) => ({
    attemptedChinaSources: requiredSourceLabels("minsheng", section),
    usableChinaCandidates: finalChinaCount,
    rejectedChinaCandidates: 1,
    rejectionReasons: ["第一轮尚未完成逐条核验"],
    shortageReason: "",
    finalChinaCount,
    finalExternalCount: 0
  });
  const makeAudit = (status, counts) => ({
    date: "2026-08-25",
    sourcePolicyVersion: 2,
    status,
    categories: Object.fromEntries(["domestic", "international", "tech", "ai"].map((section) => [section, makeEntry(section, counts[section])])),
    metrics: makeEntry("metrics", counts.metrics)
  });
  await writeFile(path.join(directory, "2026-08-25-0930-source-audit.json"), JSON.stringify(makeAudit("in-progress", { domestic: 3, international: 2, tech: 1, ai: 1, metrics: 2 })), "utf8");
  await writeFile(path.join(directory, "2026-08-25-1110-source-audit.json"), JSON.stringify(makeAudit("complete", { domestic: 10, international: 10, tech: 10, ai: 5, metrics: 6 })), "utf8");
  const merged = await mergeSourceAudits(root, "2026-08-25");
  assert(merged.runs.length === 2, "来源审计必须保留两次运行记录");
  assert(merged.status === "complete" && merged.categories.domestic.finalChinaCount === 10, "合并审计必须采用最后一次最终计数");
  assert(merged.categories.domestic.attemptedChinaSources[0] === "新华网", "合并审计必须写标准来源名称");
  const revised = makeAudit("complete", { domestic: 10, international: 10, tech: 8, ai: 5, metrics: 6 });
  revised.categories.tech.finalExternalCount = 2;
  revised.categories.tech.rejectionReasons = ["复核撤销两条过期国内候选"];
  revised.categories.tech.shortageReason = "国内候选复核后仅8条，原始机构来源补2条";
  await writeFile(path.join(directory, "2026-08-25-1130-source-audit.json"), JSON.stringify(revised), "utf8");
  const corrected = await mergeSourceAudits(root, "2026-08-25");
  assert(corrected.categories.tech.usableChinaCandidates === 8, "撤销候选后可用数必须采用最新快照，不能保留历史峰值");
  assert(corrected.categories.tech.finalExternalCount === 2 && corrected.runs.length === 3, "补差额时保留新计数和历史审计轨迹");
}

async function testRunLease() {
  const root = path.join(tempRoot, "lease");
  const date = "2026-08-25";
  const first = await acquireRunLease(root, { date, runId: "0830", ttlSeconds: 300 });
  assert(first.acquired, "首次运行必须取得租约");
  const repeated = await acquireRunLease(root, { date, runId: "0830", ttlSeconds: 300 });
  assert(repeated.acquired && repeated.reused, "同一运行重试必须幂等复用租约");
  const blocked = await acquireRunLease(root, { date, runId: "0930", ttlSeconds: 300 });
  assert(!blocked.acquired && blocked.reason === "active-lease", "有效租约必须阻止重叠运行");
  await assertRejects(() => releaseRunLease(root, { date, runId: "0930" }), "其他运行不得释放有效租约");
  const released = await releaseRunLease(root, { date, runId: "0830" });
  assert(released.released, "持有者必须能释放租约");
  assert((await acquireRunLease(root, { date, runId: "0930", ttlSeconds: 300 })).acquired, "租约释放后后续运行必须可接力");
}

async function testReadyProof() {
  const fixture = await makeReadyFixture(path.join(tempRoot, 'ready'), 'game', projectRoot);
  const { root, date, candidate, now } = fixture;
  await createReadyProof(root, fixture);
  await assertReadyProof(root, date, "game", { now });
  await writeFile(candidate, JSON.stringify({ date, issue: 5 }), "utf8");
  await assertRejects(() => assertReadyProof(root, date, "game", { now }), "就绪后修改候选必须阻止发布");
}

async function testGameRules() {
  const original = JSON.parse(await readFile(path.join(archiveSeedRoot, "data", "2026-08-24.json"), "utf8"));
  const candidate = structuredClone(original);
  candidate.date = "2026-08-25";
  candidate.issue = 4;
  candidate.cutoff = "2026-08-25 10:45（北京时间）";
  candidate.dataWindow = "2026-08-24 00:00 — 2026-08-25 10:45";
  for (const item of [...candidate.features, ...candidate.news]) item.date = "2026-08-24";
  for (const pack of candidate.packs) {
    pack.heatEvidenceAt = "2026-08-25";
    pack.heatSignals = "MC百科当日指数与国内社区讨论";
  }
  validateGame(candidate);
  const fourDeals = structuredClone(candidate);
  fourDeals.deals = fourDeals.deals.slice(0, 4);
  assertThrows(() => validateGame(fourDeals), "4条Steam优惠必须被统一校验器拒绝");
  const sixDeals = structuredClone(candidate);
  sixDeals.deals = sixDeals.deals.slice(0, 6);
  validateGame(sixDeals);
  const moreThanTwentyFour = structuredClone(candidate);
  const extra = structuredClone(moreThanTwentyFour.deals[0]);
  extra.name = "无上限覆盖测试游戏";
  extra.url = "https://store.steampowered.com/app/99999999/?l=schinese";
  extra.image = "game-brief-assets/2026-08-25-steam-extra.jpg";
  moreThanTwentyFour.deals.push(extra);
  validateGame(moreThanTwentyFour);
  const staleHeat = structuredClone(candidate);
  staleHeat.packs[0].heatEvidenceAt = "2026-08-23";
  assertThrows(() => validateGame(staleHeat), "整合包必须提供当天或前一天的社区热度证据");
}

async function testSteamAllVerifiedCoverage() {
  const root = path.join(tempRoot, "steam-coverage");
  const date = "2026-08-27";
  const brief = JSON.parse(await readFile(path.join(archiveSeedRoot, "data", "2026-08-25.json"), "utf8"));
  brief.date = date;
  const appIds = brief.deals.map((deal) => /\/app\/(\d+)/.exec(deal.url)[1]);
  const lowIds = brief.deals.filter((deal) => deal.label.includes("史低")).map((deal) => /\/app\/(\d+)/.exec(deal.url)[1]);
  await initializeRunState(root, { date, runId: "0930", kind: "main" });
  await appendResearchLedger(root, { date, runId: "0930", channel: "game", section: "deals", sourceId: "steam-cn", status: "accepted", availableCount: appIds.length, candidateIds: appIds });
  await appendResearchLedger(root, { date, runId: "0930", channel: "game", section: "deals", sourceId: "steam-price-history", status: "accepted", availableCount: lowIds.length, candidateIds: lowIds });
  await assertRejects(() => assertGameDealCoverage(root, date, brief), "没有 coverageComplete 证据时不得把部分优惠当成全量");

  await appendResearchLedger(root, { date, runId: "1030", channel: "game", section: "deals", sourceId: "steam-cn", status: "accepted", availableCount: appIds.length, candidateIds: appIds, coverageComplete: true });
  await appendResearchLedger(root, { date, runId: "1030", channel: "game", section: "deals", sourceId: "steam-price-history", status: "accepted", availableCount: lowIds.length, candidateIds: lowIds, coverageComplete: true });
  await assertRejects(() => assertGameDealCoverage(root, date, brief), "新策略日期没有冻结发现面时必须拒绝发布");
  await freezeSteamDiscovery(root, {
    date,
    runId: "0830",
    sourceUrl: "https://store.steampowered.com/search/?specials=1&cc=cn&l=schinese",
    appIds
  });
  const coverage = await assertGameDealCoverage(root, date, brief);
  assert(coverage.selectedCount === appIds.length, "完整账本中的全部合格优惠必须通过");
  await assertRejects(() => freezeSteamDiscovery(root, {
    date,
    runId: "1030",
    sourceUrl: "https://store.steampowered.com/search/?specials=1&cc=cn&l=schinese",
    appIds: [...appIds.slice(1), "99999999"]
  }), "冻结后的Steam发现面不得被动态刷新结果覆盖");

  await appendResearchLedger(root, { date, runId: "1110", channel: "game", section: "deals", sourceId: "steam-cn", status: "accepted", availableCount: appIds.length + 1, candidateIds: [...appIds, "99999999"], coverageComplete: true });
  await assertRejects(() => assertGameDealCoverage(root, date, brief), "账本比网页多一项时必须拒绝截断发布");
}

async function testHealthKeepsChecking() {
  const root = path.join(tempRoot, "health-missing");
  await mkdir(path.join(root, "data", "minsheng"), { recursive: true });
  await mkdir(path.join(root, "downloads", "game"), { recursive: true });
  await mkdir(path.join(root, "downloads", "minsheng"), { recursive: true });
  await writeFile(path.join(root, "data", "index.json"), JSON.stringify({ editions: [] }), "utf8");
  await writeFile(path.join(root, "data", "minsheng", "index.json"), JSON.stringify({ editions: [] }), "utf8");
  const png = fakePng();
  await writeFile(path.join(root, "downloads", "game", "2026-08-25.png"), png);
  await writeFile(path.join(root, "downloads", "minsheng", "2026-08-25.png"), png);
  const requested = [];
  const fakeFetch = async (url) => {
    requested.push(url);
    if (url.includes("/data/")) return jsonResponse({ editions: [] }, url);
    if (url.includes("/downloads/")) return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
    return new Response("ok", { status: 200 });
  };
  const result = await runDailyHealth({ root, date: "2026-08-25", liveBase: "https://example.test", fetchImpl: fakeFetch });
  assert(!result.healthy, "当天正文缺失时健康状态必须失败");
  assert(result.local.game.png.valid && result.live.game.png.valid, "正文缺失时仍必须独立验证PNG");
  assert((result.live.game.reachability || result.live.game.deployment).valid && (result.live.minsheng.reachability || result.live.minsheng.deployment).valid, "正文缺失时仍必须独立验证频道页面可达性");
  assert(requested.some((url) => url.includes("downloads/game/2026-08-25.png")) && requested.some((url) => url.includes("downloads/minsheng/2026-08-25.png")), "两个线上PNG都必须实际请求");
  assert(result.transport.effective === "https", "HTTPS可达但内容缺失时transport不得为null");
}

async function testTlsDegradedSuccess() {
  const seedRoot = await materializeArchiveSeed(path.join(tempRoot, 'tls-seed'));
  const pngPaths = {
    "/downloads/game/2026-08-24.png": "downloads/game/2026-08-24.png",
    "/downloads/minsheng/2026-08-24.png": "downloads/minsheng/2026-08-24.png"
  };
  const fakeFetch = async (value) => {
    const url = new URL(value);
    if (url.protocol === "https:") {
      throw Object.assign(new Error("fetch failed"), { cause: Object.assign(new Error("certificate mismatch"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }) });
    }
    if (url.pathname === "/" || url.pathname === "/game/" || url.pathname === "/minsheng/") return new Response("ok", { status: 200 });
    const relative = url.pathname.replace(/^\//, "");
    if (pngPaths[url.pathname]) {
      const buffer = await readFile(path.join(seedRoot, pngPaths[url.pathname]));
      return new Response(buffer, { status: 200, headers: { "content-type": "image/png" } });
    }
    const buffer = await readFile(path.join(seedRoot, relative));
    return new Response(buffer, { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await runDailyHealth({ root: seedRoot, date: "2026-08-24", liveBase: "https://example.test", fetchImpl: fakeFetch,
    targetCommit: 'a'.repeat(40),
    deploymentProof: { source: 'github-pages-api', checkedAt: new Date().toISOString(), headSha: 'a'.repeat(40), conclusion: 'success', siteUrl: 'https://example.test', evidenceUrl: 'https://api.github.com/repos/test/fixture/pages/builds/1' },
    pageProbe: async ({ url, date, channel, checkedAt }) => ({ method: 'browser', url, checkedAt, displayedDate: date, selectedDate: date, downloadUrl: `http://example.test/downloads/${channel}/${date}.png` })
  });
  assert(result.healthy && result.degraded, "TLS异常但同域HTTP内容完整时必须视为降级成功");
  assert(result.warnings.length === 1 && result.reasonCodes.includes("TLS_CERTIFICATE_DEGRADED"), "TLS降级必须只有一条去重警告和稳定原因码");
  assert(result.transport.effective === "http-fallback", "TLS降级必须明确记录HTTP只读复核");
}

function fakePng() {
  const buffer = Buffer.alloc(25);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer, 0);
  buffer.writeUInt32BE(3840, 16);
  return buffer;
}

function jsonResponse(value, url) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json", "x-url": url } });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertThrows(callback, message) {
  let threw = false;
  try { callback(); } catch { threw = true; }
  assert(threw, message);
}

async function assertRejects(callback, message) {
  let threw = false;
  try { await callback(); } catch { threw = true; }
  assert(threw, message);
}
