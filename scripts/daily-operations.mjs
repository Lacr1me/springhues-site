import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { AsyncLocalStorage } from 'node:async_hooks';
const mutationContext = new AsyncLocalStorage();
import { GAME_DEAL_COVERAGE_EFFECTIVE_DATE, beijingDate, steamAppIdFromUrl } from "./game-lib.mjs";
import { SOURCE_REGISTRY, allowedSourceIds, canonicalSourceId, canonicalSourceLabel, channelSections, requiredSourceIds } from "./source-registry.mjs";

export const LEDGER_STATUSES = new Set(["started", ...SOURCE_REGISTRY.terminalStatuses]);
export const CONTENT_CANDIDATE_TARGETS = Object.freeze({
  minsheng: Object.freeze({ domestic: 10, international: 10, tech: 10, ai: 5, metrics: 6 }),
  game: Object.freeze({ features: 2, news: 10, packs: 10, mods: 6, deals: 6, trends: 4 })
});
export const EVIDENCE_COMPLETE_SECTIONS = Object.freeze(new Set(["game/packs", "game/mods"]));
export const STEAM_DISCOVERY_FREEZE_EFFECTIVE_DATE = "2026-08-27";
const STEAM_LATE_AUTHORIZATIONS = Object.freeze({
  '2026-09-21': '允许',
  '2026-10-01': '允许今天一次晚采（推荐）',
  '2026-10-05': '我让你补齐',
  '2026-10-13': '你来执行吧'
});

export function operationPaths(root, date) {
  assertDate(date);
  const directory = path.resolve(root, "artifacts", "operations");
  return {
    directory,
    state: path.join(directory, `${date}-run-state.json`),
    ledger: path.join(directory, `${date}-research-ledger.jsonl`),
    audit: path.join(directory, `${date}-source-audit.json`),
    lease: path.join(directory, `${date}-run-lease.json`),
    readiness: path.join(directory, `${date}-readiness.json`),
    steamDiscovery: path.join(directory, `${date}-steam-discovery-frozen.json`)
  };
}

async function freezeSteamDiscoveryUnlocked(root, options = {}) {
  if (options.frozenAt !== undefined) throw operationError('FREEZE_LATE', '不能指定冻结时间；frozenAt 必须由实际运行时生成');
  const date = options.date || beijingDate();
  const runId = requiredText(options.runId, "runId");
  const paths = operationPaths(root, date);
  const sourceUrl = requiredText(options.sourceUrl, "sourceUrl");
  const initialState = await readJsonIfExists(paths.state);
  if (!initialState || initialState.date !== date) throw operationError('STATE_CONFLICT', '冻结必须绑定同日已初始化状态');
  if (!isHttps(sourceUrl)) throw new Error("Steam发现面 URL 必须使用 HTTPS");
  const appIds = normalizeSteamIds(options.appIds);
  const extraAppIds = normalizeSteamIds(options.extraAppIds || []);
  const allIds = new Set([...appIds, ...extraAppIds]);
  if (appIds.size < CONTENT_CANDIDATE_TARGETS.game.deals) {
    throw new Error(`Steam官方首个结果页至少需要 ${CONTENT_CANDIDATE_TARGETS.game.deals} 个不同 appId`);
  }
  const snapshot = {
    schemaVersion: 1,
    date,
    runId,
    frozenAt: clockNow(options).toISOString(),
    sourceUrl,
    appIds: [...appIds],
    extraAppIds: [...extraAppIds],
    discoveredCount: allIds.size,
    frozen: true
  };
  await mkdir(paths.directory, { recursive: true });
  const existing = await readJsonIfExists(paths.steamDiscovery);
  if (existing) {
    await inspectSteamDiscovery(root, date);
    if (!sameSet(new Set([...existing.appIds, ...(existing.extraAppIds || [])]), allIds)) {
      throw new Error(`${date} Steam发现面已经冻结，禁止用刷新后的动态列表覆盖`);
    }
    return existing;
  }
  if (options.lateAuthorizationFile) {
    if (beijingDate(clockNow(options)) !== date) throw operationError('FREEZE_AUTH_INVALID', '晚采授权只能在授权当天创建冻结');
    const expected = path.join(paths.directory, `${date}-steam-late-authorization.json`);
    if (path.resolve(root, options.lateAuthorizationFile) !== expected) throw operationError('FREEZE_AUTH_INVALID', '晚采授权必须使用同日规范证据路径');
    const bytes = await readFile(expected);
    const authorization = JSON.parse(bytes);
    assertSteamLateAuthorization(authorization, snapshot);
    snapshot.lateAuthorization = { file: path.relative(root, expected).replaceAll('\\', '/'), sha256: sha256(bytes), approvalRecordedAt: authorization.approvalRecordedAt, collectedAt: authorization.collectedAt };
  }
  assertValidSteamDiscovery(snapshot, date);
  await writeJson(paths.steamDiscovery, snapshot);
  const state = await readJsonIfExists(paths.state);
  if (state) {
    state.steamDiscovery = {
      file: path.relative(root, paths.steamDiscovery).replaceAll("\\", "/"),
      sha256: sha256(Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8")),
      discoveredCount: snapshot.discoveredCount,
      frozenAt: snapshot.frozenAt,
      ...(snapshot.lateAuthorization ? { lateAuthorization: snapshot.lateAuthorization } : {}),
      runId
    };
    state.lastCheckpointAt = new Date().toISOString();
    await writeJson(paths.state, state);
  }
  return snapshot;
}

async function acquireRunLeaseUnlocked(root, options = {}) {
  const date = options.date || beijingDate();
  const runId = requiredText(options.runId, "runId");
  const ttlSeconds = Number(options.ttlSeconds ?? 3300);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 7200) throw new Error("租约时长必须为60—7200秒");
  const paths = operationPaths(root, date);
  await mkdir(paths.directory, { recursive: true });
  const now = clockNow(options).getTime();
  const lease = {
    schemaVersion: 1,
    date,
    runId,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlSeconds * 1000).toISOString()
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(paths.lease, "wx");
      try { await handle.writeFile(`${JSON.stringify(lease, null, 2)}\n`, "utf8"); }
      finally { await handle.close(); }
      return { acquired: true, lease };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await readLeaseIfExists(paths.lease);
      if (existing?.runId === runId && Date.parse(existing.expiresAt) > now) {
        await writeJson(paths.lease, lease);
        return { acquired: true, reused: true, renewed: true, lease };
      }
      if (!existing || Date.parse(existing.expiresAt) <= now) {
        await unlink(paths.lease).catch((unlinkError) => { if (unlinkError.code !== "ENOENT") throw unlinkError; });
        continue;
      }
      return { acquired: false, reason: "active-lease", lease: existing };
    }
  }
  return { acquired: false, reason: "lease-race" };
}

async function releaseRunLeaseUnlocked(root, options = {}) {
  const date = options.date || beijingDate();
  const runId = requiredText(options.runId, "runId");
  const paths = operationPaths(root, date);
  const existing = await readLeaseIfExists(paths.lease);
  if (!existing) return { released: false, reason: "missing" };
  if (existing.runId !== runId && Date.parse(existing.expiresAt) > clockNow(options).getTime()) {
    throw new Error(`运行 ${runId} 不能释放 ${existing.runId} 的有效租约`);
  }
  await unlink(paths.lease).catch((error) => { if (error.code !== "ENOENT") throw error; });
  return { released: true, lease: existing };
}

async function createReadyProofUnlocked(root, options = {}) {
  const date = options.date || beijingDate();
  const channel = requiredChannel(options.channel);
  const paths = operationPaths(root, date);
  const initialState = await readJsonIfExists(paths.state);
  if (!initialState || initialState.date !== date) throw operationError('STATE_CONFLICT', 'mark-ready 需要同日已初始化状态');
  if (initialState.channels?.[channel]?.published || ['publishing', 'published'].includes(initialState.channels?.[channel]?.status)) throw operationError('STATE_CONFLICT', '已发布或发布中的频道不能重新 mark-ready');
  const { assertChannelPreflight } = await import('./daily-preflight.mjs');
  const preflight = await assertChannelPreflight(root, { ...options, date, channel, requireReady: false });
  const expected = expectedArtifactPaths(root, date, channel);
  const candidate = requireExactPath(options.candidate, expected.candidate, "候选JSON");
  const publicPng = requireExactPath(options.publicPng, expected.publicPng, "公开PNG");
  const renderDirectory = path.resolve(root, "artifacts", "operations", `${date}-render`);
  const html = requireInsidePath(options.html, renderDirectory, "渲染HTML");
  const renderPng = requireInsidePath(options.png, renderDirectory, "渲染PNG");
  const [candidateBuffer, htmlBuffer, renderPngBuffer, publicPngBuffer] = await Promise.all([
    readFile(candidate), readFile(html), readFile(renderPng), readFile(publicPng)
  ]);
  const brief = JSON.parse(candidateBuffer.toString("utf8"));
  if (brief.date !== date) throw new Error(`${channel}候选日期 ${brief.date} 与 ${date} 不一致`);
  const dealCoverage = channel === "game" ? await assertGameDealCoverage(root, date, brief) : null;
  validatePng3840(renderPngBuffer, "渲染PNG");
  validatePng3840(publicPngBuffer, "公开PNG");
  const renderPngSha256 = sha256(renderPngBuffer);
  const publicPngSha256 = sha256(publicPngBuffer);
  if (renderPngSha256 !== publicPngSha256) throw new Error(`${channel}公开PNG与统一渲染PNG不一致`);
  const htmlText = htmlBuffer.toString("utf8");
  const expectedHref = channel === "game" ? `downloads/game/${date}.png` : `../downloads/minsheng/${date}.png`;
  if (!htmlText.includes(date) || !htmlText.includes(expectedHref)) throw new Error(`${channel}渲染HTML的日期或下载链接不一致`);
  const readiness = await readJsonIfExists(paths.readiness) || { schemaVersion: 1, date, channels: {} };
  if (readiness.date !== date) throw new Error(`就绪证明日期 ${readiness.date} 与 ${date} 不一致`);
  readiness.channels[channel] = {
    apiVersion: STATE_EVIDENCE_API_VERSION,
    issue: brief.issue,
    preflight,
    candidate: path.relative(root, candidate).replaceAll("\\", "/"),
    candidateSha256: sha256(candidateBuffer),
    html: path.relative(root, html).replaceAll("\\", "/"),
    htmlSha256: sha256(htmlBuffer),
    renderPng: path.relative(root, renderPng).replaceAll("\\", "/"),
    publicPng: path.relative(root, publicPng).replaceAll("\\", "/"),
    pngSha256: renderPngSha256,
    width: 3840,
    ...(dealCoverage ? { dealCoverage } : {}),
    verifiedAt: clockNow(options).toISOString()
  };
  await writeJson(paths.readiness, readiness);
  await checkpointRunStateUnlocked(root, date, { channel, status: "ready", published: false, missingSections: [], now: options.now });
  return readiness.channels[channel];
}

export async function assertReadyProof(root, date, channel, options = {}) {
  const { assertChannelPreflight } = await import('./daily-preflight.mjs');
  const result = await assertChannelPreflight(root, { ...options, date, channel, requireReady: true });
  return result.proof;
}

export async function inspectReadyArtifacts(root, date, channel, options = {}) {
  requiredChannel(channel);
  const paths = operationPaths(root, date);
  const [state, readiness] = await Promise.all([readJsonIfExists(paths.state), readJsonIfExists(paths.readiness)]);
  const proof = readiness?.channels?.[channel];
  if (!proof || readiness.date !== date) throw operationError('PROOF_MISSING', `${date} ${channel} 缺少同日就绪证明`);
  if (proof.apiVersion !== STATE_EVIDENCE_API_VERSION || !proof.preflight?.ok) throw operationError('PROOF_MISSING', '旧证明缺少集中预检及视觉证据，不能自动升级');
  const expected = expectedArtifactPaths(root, date, channel);
  const files = {
    candidate: requireExactPath(path.resolve(root, options.candidate || (options.recovery ? archiveContentPath(root, date, channel) : proof.candidate)), options.recovery ? archiveContentPath(root, date, channel) : expected.candidate, "候选JSON"),
    publicPng: requireExactPath(path.resolve(root, proof.publicPng), expected.publicPng, "公开PNG"),
    html: requireInsidePath(path.resolve(root, proof.html), path.resolve(root, "artifacts", "operations", `${date}-render`), "渲染HTML"),
    renderPng: requireInsidePath(path.resolve(root, proof.renderPng), path.resolve(root, "artifacts", "operations", `${date}-render`), "渲染PNG")
  };
  const [candidateBuffer, htmlBuffer, renderPngBuffer, publicPngBuffer] = await Promise.all([
    readFile(files.candidate), readFile(files.html), readFile(files.renderPng), readFile(files.publicPng)
  ]);
  const brief = JSON.parse(candidateBuffer.toString("utf8"));
  if (brief.date !== date || brief.issue !== proof.issue || (state?.channels?.[channel]?.issue != null && state.channels[channel].issue !== brief.issue)) throw operationError('STATE_CONFLICT', '正文日期/期号与证明或状态冲突');
  validatePng3840(renderPngBuffer, "渲染PNG");
  validatePng3840(publicPngBuffer, "公开PNG");
  if (sha256(candidateBuffer) !== proof.candidateSha256 || sha256(htmlBuffer) !== proof.htmlSha256) throw operationError('PROOF_CHANGED', `${channel}候选或HTML在就绪后被修改`);
  if (sha256(renderPngBuffer) !== proof.pngSha256 || sha256(publicPngBuffer) !== proof.pngSha256) throw operationError('PROOF_CHANGED', `${channel}PNG在就绪后被修改`);
  return proof;
}

async function initializeRunStateUnlocked(root, options = {}) {
  const date = options.date || beijingDate();
  const paths = operationPaths(root, date);
  await mkdir(paths.directory, { recursive: true });
  const existing = await readJsonIfExists(paths.state);
  const now = clockNow(options).toISOString();
  const runId = options.runId || `${date}-${now.slice(11, 16).replace(":", "")}-${options.kind || "main"}`;
  const state = existing || {
    schemaVersion: 1,
    date,
    stage: "research",
    createdAt: now,
    channels: {
      minsheng: { issue: options.minshengIssue ?? null, status: "pending", missingSections: channelSections("minsheng"), published: false },
      game: { issue: options.gameIssue ?? null, status: "pending", missingSections: channelSections("game"), published: false }
    },
    runs: []
  };
  if (state.date !== date) throw new Error(`运行状态日期 ${state.date} 与 ${date} 不一致`);
  state.runs ??= [];
  if (!state.runs.some((run) => run.id === runId)) {
    state.runs.push({ id: runId, kind: options.kind || "main", startedAt: now, status: "running" });
  }
  state.lastCheckpointAt = now;
  await writeJson(paths.state, state);
  return state;
}

async function checkpointRunStateUnlocked(root, date, update = {}) {
  const paths = operationPaths(root, date);
  const state = await readJsonIfExists(paths.state);
  if (!state) throw new Error(`${date} 运行状态不存在，请先执行 init`);
  if (state.date !== date) throw operationError('STATE_CONFLICT', '状态日期冲突');
  validateCheckpoint(update);
  await assertExecutionExit(root, date, state, update);
  if (['publishing','published'].includes(update.status) || update.published === true) {
    const { assertPublishTime } = await import('./game-lib.mjs');
    assertPublishTime(date, clockNow(update));
  }
  if (update.status === 'publishing') await assertReadyProof(root, date, update.channel, { now: update.now });
  if (update.status === 'ready') await assertReadyProof(root, date, update.channel, { now: update.now });
  if (update.status === 'published' || update.published === true) {
    const archived = await inspectLocalArchive(root, date, update.channel, { now: update.now });
    if (!archived.valid) throw operationError('STATE_CONFLICT', '正式归档证据无效', archived);
  }
  if (update.stage) state.stage = update.stage;
  if (update.channel) {
    if (!state.channels?.[update.channel]) throw new Error(`未知频道：${update.channel}`);
    const channel = state.channels[update.channel];
    if (channel.published && (update.published === false || (update.status && update.status !== 'published'))) throw operationError('STATE_CONFLICT', '禁止降级已发布频道');
    if (update.status) channel.status = update.status;
    if (update.published !== undefined) channel.published = Boolean(update.published);
    if (update.issue !== undefined) channel.issue = update.issue;
    if (update.missingSections) channel.missingSections = [...new Set(update.missingSections)];
    if (update.mirrorStatus) channel.mirrorStatus = update.mirrorStatus;
  }
  if (update.runId) {
    const run = state.runs?.find((item) => item.id === update.runId);
    if (!run && (update.runStatus || update.exitReason)) throw operationError('STATE_CONFLICT', `运行 ${update.runId} 不存在`);
    if (update.runStatus) run.status = update.runStatus;
    if (["complete", "failed"].includes(update.runStatus)) run.finishedAt = clockNow(update).toISOString();
    if (update.exitReason) run.exitReason = update.exitReason;
    if (update.budget) run.budget = update.budget;
  }
  state.stage = deriveStage(state);
  state.lastCheckpointAt = clockNow(update).toISOString();
  await writeJson(paths.state, state);
  return state;
}

async function assertExecutionExit(root, date, state, update) {
  const run = state.runs?.find(item => item.id === update.runId);
  if (update.exitReason === 'CONFIGURED_BUDGET') {
    const policyPath = path.join(root, 'config', 'daily-execution-policy.json');
    const policy = await readJsonIfExists(policyPath);
    if (policy?.schemaVersion !== 1 || !Number.isFinite(policy.configuredBudgetMinutes) || policy.configuredBudgetMinutes <= 0) {
      throw operationError('BUDGET_UNCONFIGURED', '未配置执行预算；租约 TTL 和历史默认25分钟不能作为停工期限');
    }
    const expected = Date.parse(run?.startedAt) + policy.configuredBudgetMinutes * 60_000;
    if (update.budget?.policyFile !== 'config/daily-execution-policy.json' || !Number.isFinite(expected) || Date.parse(update.budget.deadlineAt) !== expected) {
      throw operationError('BUDGET_IDENTITY_INVALID', '预算须绑定实际配置文件及本轮开始时间，不能按租约截止时间生成');
    }
    if (clockNow(update).getTime() < expected) throw operationError('BUDGET_NOT_REACHED', '配置预算尚未到期，继续处理可执行步骤');
  }
  if (run?.kind === 'recovery' && update.runStatus === 'complete' && clockNow(update).getTime() >= Date.parse(`${date}T11:31:00+08:00`)) {
    const view = await queryRunState(root, date, { channel: update.channel, now: clockNow(update) });
    if (!Object.values(view.channels).every(channel => channel.online.valid)) {
      throw operationError('RECOVERY_INCOMPLETE', '最后发布补跑尚未线上健康，不能正常完成并静默退出；继续修复，真实阻断须标记failed并报告');
    }
  }
}

async function appendResearchLedgerUnlocked(root, rawEntry) {
  const date = rawEntry.date || beijingDate();
  const paths = operationPaths(root, date);
  const sourceId = canonicalSourceId(rawEntry.sourceId || rawEntry.source);
  if (!sourceId) throw new Error(`来源不在注册表中：${rawEntry.sourceId || rawEntry.source}`);
  if (!allowedSourceIds(rawEntry.channel, rawEntry.section).includes(sourceId)) {
    throw new Error(`来源 ${sourceId} 不属于 ${rawEntry.channel}/${rawEntry.section}`);
  }
  if (!LEDGER_STATUSES.has(rawEntry.status)) throw new Error(`无效检索状态：${rawEntry.status}`);
  if (rawEntry.url && !isHttps(rawEntry.url)) throw new Error("检索账本 URL 必须使用 HTTPS");
  const entry = {
    schemaVersion: 2,
    date,
    runId: requiredText(rawEntry.runId, "runId"),
    channel: rawEntry.channel,
    section: rawEntry.section,
    sourceId,
    source: SOURCE_REGISTRY.sources[sourceId].label,
    tier: rawEntry.tier || "primary",
    url: rawEntry.url || "",
    attemptedAt: rawEntry.attemptedAt || clockNow(rawEntry).toISOString(),
    status: rawEntry.status,
    availableCount: nonNegativeInteger(rawEntry.availableCount),
    rejectedCount: nonNegativeInteger(rawEntry.rejectedCount),
    coverageComplete: Boolean(rawEntry.coverageComplete),
    evidenceComplete: Boolean(rawEntry.evidenceComplete),
    reasons: normalizeReasons(rawEntry.reasons),
    candidateIds: normalizeStringList(rawEntry.candidateIds),
    revokedCandidateIds: normalizeStringList(rawEntry.revokedCandidateIds),
    candidateEvidence: rawEntry.candidateEvidence || []
  };
  if (!Array.isArray(entry.candidateEvidence)) throw operationError('EVIDENCE_INVALID', 'candidateEvidence 必须为数组');
  if (entry.revokedCandidateIds.length && !entry.reasons.length) throw operationError('EVIDENCE_INVALID', '撤销候选必须记录原因');
  if (entry.revokedCandidateIds.some(id => entry.candidateIds.includes(id))) throw operationError('EVIDENCE_INVALID', '同一记录不能接受并撤销同一候选');
  for (const evidence of entry.candidateEvidence) validateCandidateEvidence(evidence, date, entry);
  const { attemptedAt, ...semantic } = entry;
  entry.eventId = rawEntry.eventId || sha256(Buffer.from(JSON.stringify(entry.status === 'unavailable' ? { ...semantic, attemptedAt: rawEntry.attemptedAt || rawEntry.runId } : semantic)));
  const previous = (await readResearchLedger(root, date)).find(item => item.eventId === entry.eventId);
  if (previous) {
    const { eventId, attemptedAt: oldTime, ...oldSemantic } = previous;
    if (JSON.stringify(oldSemantic) !== JSON.stringify(semantic)) throw operationError('LEDGER_CONFLICT', '相同 eventId 对应不同内容');
    return previous;
  }
  await mkdir(paths.directory, { recursive: true });
  await mutationContext.getStore()?.checkLease();
  await appendFile(paths.ledger, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function readResearchLedger(root, date) {
  const { ledger } = operationPaths(root, date);
  const text = await readFile(ledger, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { const entry = JSON.parse(line); if (entry.date !== date) throw new Error('date mismatch'); return entry; }
    catch { throw new Error(`检索账本第 ${index + 1} 行不是有效 JSON`); }
  });
}

export async function assertGameDealCoverage(root, date, brief) {
  if (date < GAME_DEAL_COVERAGE_EFFECTIVE_DATE) return { mode: "legacy", selectedCount: brief?.deals?.length || 0 };
  if (!brief || brief.date !== date || !Array.isArray(brief.deals)) throw new Error(`${date} 游戏日报缺少可核验的 Steam 优惠候选`);
  const selectedIds = new Set();
  for (const [index, deal] of brief.deals.entries()) {
    const appId = steamAppIdFromUrl(deal.url);
    if (!appId) throw new Error(`Steam 优惠第${index + 1}条不是官方 app 商品页：${deal.url || "缺少URL"}`);
    if (selectedIds.has(appId)) throw new Error(`Steam 优惠重复 appId：${appId}`);
    selectedIds.add(appId);
  }

  const ledger = await readResearchLedger(root, date);
  const entries = ledger.filter((entry) => entry.date === date && entry.channel === "game" && entry.section === "deals");
  const steam = latestTerminalEntry(entries, "steam-cn");
  if (!steam || steam.status !== "accepted" || steam.coverageComplete !== true) {
    throw new Error(`${date} Steam国区检索未留下 coverageComplete=true 的完整终态记录，拒绝截断网页优惠`);
  }
  const eligibleIds = normalizedSteamCandidateIds(steam.candidateIds);
  const active = currentCandidates(entries.filter(entry => canonicalSourceId(entry.sourceId || entry.source) === 'steam-cn'));
  if (!sameSet(eligibleIds, new Set([...active.keys()]))) throw operationError('STEAM_COVERAGE_INVALID', 'Steam 当前有效集合与最后覆盖清单不一致');
  if (eligibleIds.size !== steam.availableCount) {
    throw new Error(`${date} Steam国区账本 availableCount=${steam.availableCount} 与合格 appId 数量 ${eligibleIds.size} 不一致`);
  }
  if (!sameSet(selectedIds, eligibleIds)) {
    throw new Error(`${date} 网页 Steam 优惠 ${selectedIds.size} 款与账本全部合格优惠 ${eligibleIds.size} 款不一致，禁止只取前若干条`);
  }

  if (date >= STEAM_DISCOVERY_FREEZE_EFFECTIVE_DATE) {
    const paths = operationPaths(root, date);
    const snapshot = await inspectSteamDiscovery(root, date);
    const frozenIds = new Set([...snapshot.appIds, ...(snapshot.extraAppIds || [])]);
    for (const appId of eligibleIds) {
      if (!frozenIds.has(appId)) throw new Error(`${date} Steam appId ${appId} 不在当天冻结发现面中`);
    }
    const decisions = new Map();
    for (const entry of entries.filter(item => canonicalSourceId(item.sourceId || item.source) === 'steam-cn')) {
      for (const evidence of entry.candidateEvidence || []) decisions.set(evidence.id, evidence);
    }
    for (const appId of frozenIds) {
      const evidence = decisions.get(appId);
      if (!evidence) throw operationError('STEAM_COVERAGE_INVALID', `冻结 appId ${appId} 缺少接受或淘汰证据`);
      validateCandidateEvidence(evidence, date);
      if (evidence.backfillProof) {
        const files = [[evidence.backfillProof.sourcePath, evidence.backfillProof.sourceSha256], [evidence.backfillProof.discoveryPath, evidence.backfillProof.discoverySha256]];
        if (evidence.backfillProof.crosscheckPath) files.push([evidence.backfillProof.crosscheckPath, evidence.backfillProof.crosscheckSha256]);
        for (const [file, expected] of files) {
          const base = path.resolve(root, 'artifacts', 'operations');
          const target = path.resolve(root, file);
          if (!target.startsWith(base + path.sep) || sha256(await readFile(target)) !== expected) {
            throw operationError('STEAM_COVERAGE_INVALID', `appId ${appId} 历史补证文件或哈希不符`);
          }
        }
      }
      if (eligibleIds.has(appId) !== (evidence.decision === 'accepted')) throw operationError('STEAM_COVERAGE_INVALID', `appId ${appId} 的证据决定与当前集合冲突`);
    }
  }

  const lowIds = new Set(brief.deals.filter((deal) => String(deal.label).includes("史低")).map((deal) => steamAppIdFromUrl(deal.url)));
  const history = latestTerminalEntry(entries, "steam-price-history");
  if (!history) throw new Error(`${date} 缺少 Steam 价格历史终态记录`);
  const verifiedLowIds = normalizedSteamCandidateIds(history.candidateIds);
  if (history.status === "accepted" && verifiedLowIds.size !== history.availableCount) {
    throw new Error(`${date} Steam价格历史账本 availableCount=${history.availableCount} 与已核验 appId 数量 ${verifiedLowIds.size} 不一致`);
  }
  for (const appId of lowIds) {
    if (!verifiedLowIds.has(appId)) throw new Error(`${date} Steam appId ${appId} 标记为史低但不在价格历史核验清单中`);
  }
  if (lowIds.size && (history.status !== "accepted" || history.coverageComplete !== true)) {
    throw new Error(`${date} 存在史低标签，但价格历史核验未完整结束`);
  }
  return {
    mode: "all-verified",
    selectedCount: selectedIds.size,
    rejectedCount: steam.rejectedCount,
    verifiedLowCount: lowIds.size,
    steamRunId: steam.runId,
    historyRunId: history.runId
  };
}

export async function researchCompleteness(root, date, channel) {
  requiredChannel(channel);
  const ledger = await readResearchLedger(root, date);
  const sections = {};
  let complete = true;
  for (const section of channelSections(channel)) {
    const required = requiredSourceIds(channel, section);
    const missing = [];
    const incomplete = [];
    for (const sourceId of required) {
      const attempts = ledger.filter((entry) => entry.date === date && entry.channel === channel && entry.section === section && canonicalSourceId(entry.sourceId || entry.source) === sourceId);
      const terminal = attempts.filter((entry) => SOURCE_REGISTRY.terminalStatuses.includes(entry.status));
      if (!attempts.length) missing.push(sourceId);
      else if (!terminal.length || attempts.at(-1).status === 'started') incomplete.push(sourceId);
      else if (terminal.at(-1).status === "unavailable" && terminal.filter((entry) => entry.status === "unavailable").length < SOURCE_REGISTRY.minimumUnavailableAttempts) incomplete.push(sourceId);
      else if (date >= GAME_DEAL_COVERAGE_EFFECTIVE_DATE && channel === "game" && section === "deals" && terminal.at(-1).status === "accepted" && terminal.at(-1).coverageComplete !== true) incomplete.push(sourceId);
    }
    const entries = ledger.filter((entry) => entry.date === date && entry.channel === channel && entry.section === section);
    const current = currentCandidates(entries);
    const candidateIds = new Set(current.keys());
    const target = CONTENT_CANDIDATE_TARGETS[channel]?.[section] || 0;
    const originalVerificationPendingIds = [...current].filter(([, item]) => item.evidence?.facts?.originalVerificationPending === true).map(([id]) => id);
    const evidenceCandidateIds = new Set([...current].filter(([, item]) => {
      try { validateCandidateEvidence(item.evidence, date, {channel, section}); return item.evidence.decision === 'accepted' && item.evidence.facts?.originalVerificationPending !== true; } catch { return false; }
    }).map(([id]) => id));
    const evidenceComplete = candidateIds.size > 0 && evidenceCandidateIds.size === candidateIds.size;
    const candidateCountComplete = candidateIds.size >= target;
    let frozenDiscoveryComplete = true;
    let frozenDiscoveryError = null;
    let frozenCoverageComplete = true;
    let frozenCoverageError = null;
    let unresolvedAppIds = [];
    if (channel === 'game' && section === 'deals' && date >= STEAM_DISCOVERY_FREEZE_EFFECTIVE_DATE) {
      try {
        const snapshot = await inspectSteamDiscovery(root, date);
        const steamEntries = entries.filter(entry => canonicalSourceId(entry.sourceId || entry.source) === 'steam-cn');
        const steamCandidates = currentCandidates(steamEntries);
        const decisions = new Map(steamEntries.flatMap(entry => (entry.candidateEvidence || []).map(evidence => [evidence.id, evidence])));
        unresolvedAppIds = [...snapshot.appIds, ...(snapshot.extraAppIds || [])].filter(id => {
          const evidence = decisions.get(id);
          try {
            validateCandidateEvidence(evidence, date, { channel, section });
            return steamCandidates.has(id) !== (evidence.decision === 'accepted');
          } catch { return true; }
        });
        try {
          // Use the same ledger/freeze/file checks as publication, even before a candidate exists.
          await assertGameDealCoverage(root, date, {
            date, deals: [...steamCandidates.keys()].map(id => ({ url: `https://store.steampowered.com/app/${id}/` }))
          });
        } catch (error) {
          frozenCoverageComplete = false;
          frozenCoverageError = { code: error.code || 'STEAM_COVERAGE_INVALID', message: error.message };
        }
      }
      catch (error) {
        frozenDiscoveryComplete = false;
        frozenDiscoveryError = { code: error.code || 'FREEZE_INVALID', message: error.message };
        frozenCoverageComplete = false;
        frozenCoverageError = frozenDiscoveryError;
      }
    }
    const sectionComplete = !missing.length && !incomplete.length && candidateCountComplete && evidenceComplete && frozenDiscoveryComplete && frozenCoverageComplete;
    sections[section] = {
      complete: sectionComplete,
      missing: missing.map((id) => SOURCE_REGISTRY.sources[id].label),
      incomplete: incomplete.map((id) => SOURCE_REGISTRY.sources[id].label),
      candidateCount: candidateIds.size,
      candidateIds: [...candidateIds],
      evidenceMissingIds: [...candidateIds].filter(id => !evidenceCandidateIds.has(id)),
      originalVerificationPendingIds,
      target,
      shortfall: Math.max(0, target - candidateIds.size),
      evidenceComplete,
      frozenDiscoveryComplete,
      frozenDiscoveryError,
      ...(channel === 'game' && section === 'deals' && date >= STEAM_DISCOVERY_FREEZE_EFFECTIVE_DATE ? {
        frozenCoverageComplete, frozenCoverageError, unresolvedAppIds
      } : {})
    };
    complete &&= sectionComplete;
  }
  return { date, channel, complete, sections };
}

async function reconcileRunStateUnlocked(root, date, options = {}) {
  const paths = operationPaths(root, date);
  const state = await readJsonIfExists(paths.state);
  if (!state) throw new Error(`${date} 运行状态不存在，请先执行 init`);
  if (state.date !== date) throw operationError('STATE_CONFLICT', '状态日期冲突');
  const view = await queryRunState(root, date, options);
  const results = {};
  const conflicts = [];
  state.channels ??= {};
  for (const [channelName, evidence] of Object.entries(view.channels)) {
    const channel = state.channels[channelName] || { issue: null, status: 'pending', published: false };
    if ((channel.published || channel.status === 'published') && !evidence.archive.valid) {
      conflicts.push({ channel: channelName, code: 'STATE_CONFLICT', message: 'published 标签缺少有效归档证据', reasons: evidence.archive.reasons });
      continue;
    }
    if (evidence.archive.valid) {
      state.channels[channelName] = { ...channel, issue: evidence.archive.issue, status: 'published', published: true, missingSections: [] };
      results[channelName] = evidence;
      continue;
    }
    if (evidence.archive.exists) { conflicts.push({ channel: channelName, code: 'STATE_CONFLICT', message: '存在未完整归档或冲突，请由发布事务恢复', reasons: evidence.archive.reasons }); continue; }
    if (evidence.readiness.valid) { state.channels[channelName] = { ...channel, status: 'ready', published: false, missingSections: [] }; results[channelName] = evidence; continue; }
    if (channel.status === 'ready' || channel.status === 'publishing') { conflicts.push({ channel: channelName, code: 'STATE_CONFLICT', message: '现有就绪/发布标签证据失效，保留原证据', reasons: evidence.readiness.reasons }); continue; }
    const status = evidence.research;
    const missingSections = Object.entries(status.sections).filter(([, value]) => !value.complete).map(([name]) => name);
    channel.missingSections = missingSections;
    channel.status = status.complete ? "researched" : "researching";
    state.channels[channelName] = channel;
    results[channelName] = status;
  }
  if (conflicts.length) return { ok: false, code: 'STATE_CONFLICT', conflicts, results, state: await readJsonIfExists(paths.state) };
  state.stage = deriveStage(state);
  state.lastCheckpointAt = clockNow(options).toISOString();
  await writeJson(paths.state, state);
  return { ok: true, state, results, conflicts };
}

export async function assertResearchComplete(root, date, channel) {
  const status = await researchCompleteness(root, date, channel);
  if (!status.complete) {
    const details = Object.entries(status.sections)
      .filter(([, section]) => !section.complete)
      .map(([name, section]) => {
        const blockers = [
          `未尝试 ${section.missing.join("、") || "无"}`,
          `未完成 ${section.incomplete.join("、") || "无"}`,
          `候选 ${section.candidateCount}/${section.target}`
        ];
        if (section.frozenCoverageComplete === false) blockers.push(`Steam冻结覆盖未闭环：${section.unresolvedAppIds?.join('、') || section.frozenCoverageError?.message}`);
        if (!section.evidenceComplete) blockers.push("逐项证据未闭环");
        if (!section.frozenDiscoveryComplete) blockers.push("Steam发现面未冻结");
        return `${name}: ${blockers.join("; ")}`;
      });
    throw new Error(`${date} ${channel} 检索账本未完成：\n- ${details.join("\n- ")}`);
  }
  const entries = (await readResearchLedger(root, date)).filter(entry => entry.channel === channel);
  for (const entry of entries) for (const evidence of entry.candidateEvidence || []) {
    if (evidence.historicalSourceProof || evidence.retainedResearchProof) await assertRetainedSourceEvidence(root, evidence, date, entry);
  }
  return status;
}

export async function assertRetainedSourceEvidence(root, evidence, date, context = {}) {
  validateCandidateEvidence(evidence, date, context);
  const proof = evidence.historicalSourceProof || evidence.retainedResearchProof;
  if (!proof) return;
  const base = path.resolve(root, 'artifacts', 'operations');
  const file = path.resolve(root, proof.sourcePath);
  if (!file.startsWith(base + path.sep) || sha256(await readFile(file)) !== proof.sourceSha256) {
    throw operationError('EVIDENCE_CHANGED', '历史原文补核文件或哈希发生变化');
  }
}

async function mergeSourceAuditsUnlocked(root, date) {
  const paths = operationPaths(root, date);
  const names = await readdir(paths.directory).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const pattern = new RegExp(`^${date}-(\\d{4}|[A-Za-z0-9_-]+)-source-audit\\.json$`);
  const files = names.filter((name) => pattern.test(name)).sort();
  if (!files.length) {
    const existing = await readJsonIfExists(paths.audit);
    if (existing) return existing;
    throw new Error(`${date} 没有可合并的分次来源审计`);
  }
  const audits = await Promise.all(files.map((name) => readJsonIfExists(path.join(paths.directory, name))));
  const latest = audits.at(-1);
  const categories = {};
  for (const section of channelSections("minsheng").filter((name) => name !== "metrics")) {
    categories[section] = mergeAuditEntries(audits.map((audit) => audit?.categories?.[section]).filter(Boolean));
  }
  const merged = {
    date,
    sourcePolicyVersion: 2,
    status: latest?.status || "in-progress",
    runs: files.map((file, index) => ({ file, status: audits[index]?.status || "unknown" })),
    categories,
    metrics: mergeAuditEntries(audits.map((audit) => audit?.metrics).filter(Boolean))
  };
  await writeJson(paths.audit, merged);
  return merged;
}

function mergeAuditEntries(entries) {
  if (!entries.length) return null;
  const latest = entries.at(-1);
  return {
    attemptedChinaSources: [...new Set(entries.flatMap((entry) => entry.attemptedChinaSources || []).map(canonicalSourceLabel))],
    usableChinaCandidates: latest.usableChinaCandidates,
    rejectedChinaCandidates: Math.max(0, ...entries.map((entry) => Number.isInteger(entry.rejectedChinaCandidates) ? entry.rejectedChinaCandidates : 0)),
    rejectionReasons: [...new Set(entries.flatMap((entry) => entry.rejectionReasons || []).filter(Boolean))],
    shortageReason: [...entries].reverse().find((entry) => String(entry.shortageReason || "").trim())?.shortageReason || "",
    finalChinaCount: latest.finalChinaCount,
    finalExternalCount: latest.finalExternalCount
  };
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readLeaseIfExists(file) {
  try {
    const text = await readFile(file, "utf8");
    if (!text.trim()) throw operationError('LEASE_INVALID', '租约文件为空，保留以供诊断');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(file, value) {
  await mutationContext.getStore()?.checkLease();
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await mutationContext.getStore()?.checkLease();
  await rename(temporary, file);
}

function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw new Error("日期必须为 YYYY-MM-DD");
}

function requiredText(value, field) {
  if (!String(value || "").trim()) throw new Error(`${field} 不能为空`);
  return String(value).trim();
}

function requiredChannel(value) {
  if (!["game", "minsheng"].includes(value)) throw new Error(`未知频道：${value}`);
  return value;
}

function expectedArtifactPaths(root, date, channel) {
  return {
    candidate: path.resolve(root, "data", ".pending", ...(channel === "minsheng" ? ["minsheng", `${date}.json`] : [`${date}.json`])),
    publicPng: path.resolve(root, "downloads", channel, `${date}.png`)
  };
}

function requireExactPath(value, expected, label) {
  const resolved = path.resolve(requiredText(value, label));
  if (resolved !== path.resolve(expected)) throw new Error(`${label}必须为 ${expected}`);
  return resolved;
}

function requireInsidePath(value, directory, label) {
  const resolved = path.resolve(requiredText(value, label));
  const relative = path.relative(path.resolve(directory), resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label}必须位于 ${directory} 内`);
  return resolved;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function validatePng3840(buffer, label) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length <= 24 || !buffer.subarray(0, 8).equals(signature)) throw new Error(`${label}不是有效PNG`);
  if (buffer.readUInt32BE(16) !== 3840) throw new Error(`${label}宽度必须为3840px`);
}

function nonNegativeInteger(value) {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0) throw new Error("候选数量必须为非负整数");
  return number;
}

function normalizeReasons(value) {
  if (Array.isArray(value)) return normalizeStringList(value);
  return value ? [String(value).trim()].filter(Boolean) : [];
}

function normalizeStringList(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : String(value).split("|");
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeSteamIds(values) {
  return normalizedSteamCandidateIds(normalizeStringList(values));
}

function assertValidSteamDiscovery(snapshot, date) {
  if (!snapshot || snapshot.date !== date || snapshot.frozen !== true) throw new Error(`${date} 缺少已冻结的 Steam 发现面`);
  if (!isHttps(snapshot.sourceUrl)) throw new Error(`${date} Steam冻结发现面缺少 HTTPS 来源`);
  const frozenAt = Date.parse(snapshot.frozenAt);
  const midnight = Date.parse(`${date}T00:00:00+08:00`);
  if (!Number.isFinite(frozenAt) || frozenAt < midnight || frozenAt >= midnight + 86400000 || (frozenAt > Date.parse(`${date}T08:00:00+08:00`) && !(STEAM_LATE_AUTHORIZATIONS[date] && snapshot.lateAuthorization))) throw operationError('FREEZE_LATE', `${date} 冻结时间不是当天 08:00 前，且无匹配的一次性晚采授权`);
  if (!Array.isArray(snapshot.appIds) || !Array.isArray(snapshot.extraAppIds || []) || [...snapshot.appIds, ...(snapshot.extraAppIds || [])].some(id => !/^\d{3,}$/.test(String(id)))) throw operationError('FREEZE_INVALID', '冻结 appId 身份无效');
  const appIds = normalizeSteamIds(snapshot.appIds);
  const extraAppIds = normalizeSteamIds(snapshot.extraAppIds || []);
  const discoveredCount = new Set([...appIds, ...extraAppIds]).size;
  if (appIds.size < CONTENT_CANDIDATE_TARGETS.game.deals || snapshot.discoveredCount !== discoveredCount) {
    throw new Error(`${date} Steam冻结发现面计数无效`);
  }
  return snapshot;
}

function assertSteamLateAuthorization(authorization, snapshot) {
  const fail = () => { throw operationError('FREEZE_AUTH_INVALID', '一次性晚采授权的日期、用户原话、时间顺序或发现面身份不匹配'); };
  const approvalText = STEAM_LATE_AUTHORIZATIONS[snapshot.date];
  if (!approvalText || authorization?.schemaVersion !== 1 || authorization.date !== snapshot.date || authorization.runId !== snapshot.runId || authorization.scope !== 'steam-late-discovery-once' || authorization.approvalText !== approvalText || !String(authorization.approvalReference || '').trim()) fail();
  if (snapshot.date === '2026-10-01' && !String(authorization.approvalReference).includes('01a0f4d0-e4a3-7cf1-b58a-fb16f4f704e9')) fail();
  const times = [authorization.approvalRecordedAt, authorization.collectedAt, snapshot.frozenAt].map(value => Date.parse(value));
  if (times.some(time => !Number.isFinite(time) || beijingDate(new Date(time)) !== snapshot.date) || times[0] > times[1] || times[1] > times[2]) fail();
  if (authorization.sourceUrl !== snapshot.sourceUrl || !Array.isArray(authorization.appIds) || !Array.isArray(authorization.extraAppIds) || !sameSet(new Set(authorization.appIds.map(String)), new Set(snapshot.appIds.map(String))) || !sameSet(new Set(authorization.extraAppIds.map(String)), new Set(snapshot.extraAppIds.map(String)))) fail();
}

function latestTerminalEntry(entries, sourceId) {
  return entries.filter((entry) => canonicalSourceId(entry.sourceId || entry.source) === sourceId && SOURCE_REGISTRY.terminalStatuses.includes(entry.status)).at(-1) || null;
}

function normalizedSteamCandidateIds(values) {
  const ids = new Set();
  for (const value of normalizeStringList(values)) {
    const match = /(?:^|\D)(\d{3,})(?:\D|$)/.exec(value);
    if (!match) throw new Error(`Steam 检索账本候选ID无效：${value}`);
    ids.add(match[1]);
  }
  return ids;
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function isHttps(value) {
  try { return new URL(value).protocol === "https:"; }
  catch { return false; }
}

export const STATE_EVIDENCE_API_VERSION = 'state-evidence/v1';
export const EXIT_REASONS = new Set(['READY_WAITING_PUBLISH', 'ONLINE_HEALTHY', 'CONFIGURED_BUDGET', 'ENVIRONMENT_LIMIT', 'HANDOFF_BOUNDARY', 'SOURCE_EXHAUSTED', 'PERMISSION_REQUIRED', 'LEASE_LOST', 'REPAIRABLE_ERROR', 'HARD_BLOCKER']);
const PUBLICATION_STEPS = ['prepared', 'content-written', 'index-written', 'embedded-written', 'complete'];

function clockNow(options = {}) {
  const now = new Date(options.now ?? Date.now());
  if (!Number.isFinite(now.getTime())) throw operationError('INVALID_TIME', '无效时钟');
  return now;
}
function operationError(code, message, details) { return Object.assign(new Error(message), { code, details }); }
function deriveStage(state) {
  const channels = ['game', 'minsheng'].map(name => state.channels?.[name]);
  if (channels.every(item => item?.published)) return 'published';
  if (channels.some(item => item?.status === 'publishing')) return 'publish';
  if (channels.some(item => item?.status === 'ready')) return 'ready';
  if (channels.every(item => ['researched', 'ready', 'published'].includes(item?.status))) return 'candidate';
  return 'research';
}
function validateCheckpoint(update) {
  const enums = { stage: ['research','candidate','ready','publish','published'], status: ['pending','researching','researched','ready','publishing','published'], runStatus: ['running','complete','failed'], mirrorStatus: ['pending','complete','conflict'] };
  for (const [key, values] of Object.entries(enums)) if (update[key] !== undefined && !values.includes(update[key])) throw operationError('INVALID_CHECKPOINT', `无效 ${key}: ${update[key]}`);
  if (update.channel !== undefined) requiredChannel(update.channel);
  if (update.exitReason && !EXIT_REASONS.has(update.exitReason)) throw operationError('INVALID_CHECKPOINT', '无效退出原因');
  if (update.exitReason && !update.runId) throw operationError('INVALID_CHECKPOINT', '退出原因必须绑定 runId');
  if (update.published === true && update.status && update.status !== 'published') throw operationError('INVALID_CHECKPOINT', 'published 与 status 冲突');
  if ((update.status || update.published !== undefined || update.issue !== undefined || update.mirrorStatus) && !update.channel) throw operationError('INVALID_CHECKPOINT', '频道更新必须指定 channel');
  if (update.budget && !update.runId) throw operationError('INVALID_CHECKPOINT', '预算必须绑定 runId');
  if (update.exitReason === 'REPAIRABLE_ERROR' && update.runStatus === 'complete') throw operationError('INVALID_CHECKPOINT', '尚有可修复错误不能作为正常完成的原因');
  if (update.published !== undefined && typeof update.published !== 'boolean') throw operationError('INVALID_CHECKPOINT', 'published 必须为布尔值');
  if (update.issue !== undefined && (!Number.isInteger(update.issue) || update.issue < 1)) throw operationError('INVALID_CHECKPOINT', 'issue 必须为正整数');
  if (update.missingSections && (!update.channel || !Array.isArray(update.missingSections) || update.missingSections.some(s => !channelSections(update.channel).includes(s)))) throw operationError('INVALID_CHECKPOINT', 'missingSections 无效');
  if (update.budget) {
    const b = update.budget;
    if (!['configured','environment','handoff'].includes(b.kind) || !Number.isFinite(Date.parse(b.deadlineAt)) || !String(b.basis || '').trim()) throw operationError('INVALID_CHECKPOINT', '预算须注明 kind/deadlineAt/basis');
  }
  const budgetKinds = { CONFIGURED_BUDGET: 'configured', ENVIRONMENT_LIMIT: 'environment', HANDOFF_BOUNDARY: 'handoff' };
  if (budgetKinds[update.exitReason] && update.budget?.kind !== budgetKinds[update.exitReason]) throw operationError('INVALID_CHECKPOINT', '预算退出原因必须附带对应种类的边界证据');
}
export async function assertRunLease(root, date, options = {}) {
  const lease = await readLeaseIfExists(operationPaths(root, date).lease);
  if (!lease) throw operationError('LEASE_REQUIRED', `${date} 写入需要有效租约`);
  if (lease.date !== date || !lease.runId || !Number.isFinite(Date.parse(lease.expiresAt))) throw operationError('LEASE_INVALID', '租约字段损坏');
  if (Date.parse(lease.expiresAt) <= clockNow(options).getTime()) throw operationError('LEASE_EXPIRED', '租约已过期');
  if (options.runId && lease.runId !== options.runId) throw operationError('LEASE_MISMATCH', `当前租约属于 ${lease.runId}`);
  return lease;
}
async function guardedMutation(root, date, options, callback, requireLease = true) {
  const paths = operationPaths(root, date);
  // Check before mkdir so a refused write does not initialize production state.
  if (requireLease) await assertRunLease(root, date, options);
  await mkdir(paths.directory, { recursive: true });
  const lockPath = path.join(paths.directory, `${date}-state-write.lock`);
  let handle;
  try { handle = await open(lockPath, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw operationError('STATE_BUSY', '另一个状态写入正在执行或遗留锁需诊断'); throw error; }
  try {
    await handle.writeFile(JSON.stringify({ runId: options.runId || null, at: clockNow(options).toISOString() }));
    if (requireLease) await assertRunLease(root, date, options);
    return await mutationContext.run({ checkLease: async () => { if (requireLease) await assertRunLease(root, date, options); } }, callback);
  } finally { await handle.close(); await unlink(lockPath); }
}
export function acquireRunLease(root, options = {}) { return guardedMutation(root, options.date || beijingDate(), options, () => acquireRunLeaseUnlocked(root, options), false); }
export function releaseRunLease(root, options = {}) { return guardedMutation(root, options.date || beijingDate(), options, () => releaseRunLeaseUnlocked(root, options), false); }
export function initializeRunState(root, options = {}) { return guardedMutation(root, options.date || beijingDate(), options, () => initializeRunStateUnlocked(root, options)); }
export function checkpointRunState(root, date, options = {}) { return guardedMutation(root, date, options, () => checkpointRunStateUnlocked(root, date, options)); }
export function appendResearchLedger(root, options) { return guardedMutation(root, options.date || beijingDate(), options, () => appendResearchLedgerUnlocked(root, options)); }
export function freezeSteamDiscovery(root, options = {}) { return guardedMutation(root, options.date || beijingDate(), options, () => freezeSteamDiscoveryUnlocked(root, options)); }
export function createReadyProof(root, options = {}) { return guardedMutation(root, options.date || beijingDate(), options, () => createReadyProofUnlocked(root, options)); }
export function reconcileRunState(root, date, options = {}) { return guardedMutation(root, date, options, () => reconcileRunStateUnlocked(root, date, options)); }
export function mergeSourceAudits(root, date, options = {}) { return guardedMutation(root, date, options, () => mergeSourceAuditsUnlocked(root, date)); }
export function correctUnpublishedIssue(root, options) {
  const {date, channel, issue} = options;
  return guardedMutation(root, date, options, async () => {
    requiredChannel(channel);
    const paths = operationPaths(root, date), state = await readJsonIfExists(paths.state);
    const current = state?.channels?.[channel];
    const pending = expectedArtifactPaths(root, date, channel).candidate;
    const readiness = await readJsonIfExists(paths.readiness);
    if (!current || current.published || ['ready','publishing','published'].includes(current.status) || readiness?.channels?.[channel] || await readJsonIfExists(pending) || await readJsonIfExists(archiveContentPath(root, date, channel))) {
      throw operationError('ISSUE_LOCKED', '仅未生成候选或就绪证明、未归档的频道可纠正期号');
    }
    const manifest = await readJsonIfExists(path.join(root, 'data', ...(channel === 'minsheng' ? ['minsheng'] : []), 'index.json'));
    const editions = manifest?.editions;
    if (!Array.isArray(editions) || editions.some(item => !Number.isInteger(item.issue) || item.issue < 1)) throw operationError('ISSUE_INVALID', '期号纠正需要有效正式索引');
    const next = Math.max(0, ...editions.map(item => item.issue)) + 1;
    if (!Number.isInteger(issue) || issue !== next) throw operationError('ISSUE_INVALID', '期号必须是正式索引最大期号加一');
    const previousIssue = current.issue;current.issue = issue;
    state.issueCorrections ??= [];
    state.issueCorrections.push({channel, previousIssue, issue, runId: options.runId, correctedAt: clockNow(options).toISOString(), basis: 'next-issued-index'});
    state.lastCheckpointAt = clockNow(options).toISOString();await writeJson(paths.state, state);return state;
  });
}

function validateCandidateEvidence(evidence, date, context = {}) {
  const checkedAt = Date.parse(evidence?.checkedAt);
  const sameDay = Number.isFinite(checkedAt) && beijingDate(new Date(checkedAt)) === date;
  const proof = evidence?.backfillProof;
  let historical = false;
  if (proof && !sameDay) {
    const sourceTime = Date.parse(proof.sourceObservedAt);
    const frozenTime = Date.parse(proof.frozenAt);
    historical = Number.isFinite(checkedAt) && beijingDate(new Date(checkedAt)) > date &&
      proof.editionDate === date && ['same-sale-crosscheck', 'historical-evidence-insufficient'].includes(proof.method) &&
      Number.isFinite(sourceTime) && sourceTime <= Date.parse(`${date}T23:59:59+08:00`) &&
      Number.isFinite(frozenTime) && beijingDate(new Date(frozenTime)) === date &&
      typeof proof.sourcePath === 'string' && typeof proof.discoveryPath === 'string' &&
      /^[a-f0-9]{64}$/.test(proof.sourceSha256) && /^[a-f0-9]{64}$/.test(proof.discoverySha256) &&
      (evidence.decision !== 'accepted' || proof.method === 'same-sale-crosscheck');
  }
  const retained = evidence?.historicalSourceProof;
  const sourcePublishedAt = Date.parse(retained?.sourcePublishedAt);
  const historicalSource = retained && Number.isFinite(checkedAt) && checkedAt <= Date.now() + 60_000 &&
    beijingDate(new Date(checkedAt)) > date && retained.editionDate === date &&
    Date.parse(retained.capturedAt) === checkedAt && Number.isFinite(sourcePublishedAt) &&
    sourcePublishedAt <= Date.parse(`${date}T23:59:59+08:00`) &&
    sourcePublishedAt >= Date.parse(`${date}T00:00:00+08:00`) - (context.channel === 'game' && context.section === 'mods' ? 30 : 7) * 86400000 &&
    retained.sourceUrl === evidence.url && typeof retained.sourcePath === 'string' && /^[a-f0-9]{64}$/.test(retained.sourceSha256);
  const researchProof = evidence?.retainedResearchProof;
  const observedAt = Date.parse(researchProof?.sourceObservedAt);
  const retainedResearch = researchProof && context.channel === 'game' && ['features','packs','trends'].includes(context.section) &&
    researchProof.channel === context.channel && researchProof.section === context.section && researchProof.editionDate === date &&
    Number.isFinite(checkedAt) && checkedAt <= Date.now() + 60_000 && beijingDate(new Date(checkedAt)) > date && Date.parse(researchProof.capturedAt) === checkedAt &&
    Number.isFinite(observedAt) && observedAt >= Date.parse(`${date}T00:00:00+08:00`) - 86400000 && observedAt <= Date.parse(`${date}T23:59:59+08:00`) &&
    (context.section !== 'packs' || String(evidence.facts?.heatEvidenceAt || '').slice(0,10) === beijingDate(new Date(observedAt))) &&
    typeof researchProof.sourcePath === 'string' && /^[a-f0-9]{64}$/.test(researchProof.sourceSha256);
  if (!evidence || !String(evidence.id || '').trim() || !['accepted', 'rejected'].includes(evidence.decision) || !isHttps(evidence.url) || !Number.isFinite(checkedAt) || !(sameDay || historical || historicalSource || retainedResearch) || !String(evidence.basis || '').trim()) throw operationError('EVIDENCE_INVALID', '逐项证据须包含 id/decision/HTTPS url/同日 checkedAt/basis；历史补证须保留真实复核时间及原始文件哈希');
  if (evidence.decision === 'accepted' && (!evidence.facts || typeof evidence.facts !== 'object' || Array.isArray(evidence.facts) || !Object.keys(evidence.facts).length)) throw operationError('EVIDENCE_INVALID', '接受候选须记录 facts；结构通过不代表来源事实已核实');
}
function currentCandidates(entries) {
  const current = new Map();
  for (const entry of entries) {
    for (const id of normalizeStringList(entry.revokedCandidateIds)) current.delete(id);
    if (entry.status === 'accepted') for (const id of normalizeStringList(entry.candidateIds)) {
      current.set(id, { sourceId: canonicalSourceId(entry.sourceId || entry.source), evidence: (entry.candidateEvidence || []).find(item => item.id === id) || current.get(id)?.evidence || null });
    }
    for (const evidence of entry.candidateEvidence || []) {
      if (evidence.decision === 'rejected') current.delete(evidence.id);
      else if (current.has(evidence.id)) current.set(evidence.id, { ...current.get(evidence.id), evidence });
    }
  }
  return current;
}
export async function inspectSteamDiscovery(root, date) {
  const paths = operationPaths(root, date);
  const snapshot = await readJsonIfExists(paths.steamDiscovery);
  assertValidSteamDiscovery(snapshot, date);
  const state = await readJsonIfExists(paths.state);
  const identity = state?.steamDiscovery;
  if (state?.date !== date || !identity?.sha256) throw operationError('FREEZE_UNBOUND', '冻结文件缺少状态中的同日哈希绑定');
  if (path.resolve(root, identity.file || '') !== paths.steamDiscovery || sha256(await readFile(paths.steamDiscovery)) !== identity.sha256 || identity.runId !== snapshot.runId || identity.frozenAt !== snapshot.frozenAt || identity.discoveredCount !== snapshot.discoveredCount) throw operationError('FREEZE_CHANGED', '冻结文件与状态身份/哈希不匹配，保留原证据');
  if (snapshot.lateAuthorization) {
    const binding = snapshot.lateAuthorization;
    const expected = path.join(paths.directory, `${date}-steam-late-authorization.json`);
    if (path.resolve(root, binding.file || '') !== expected || JSON.stringify(identity.lateAuthorization) !== JSON.stringify(binding)) throw operationError('FREEZE_AUTH_CHANGED', '晚采授权与状态身份不匹配');
    const bytes = await readFile(expected);
    if (sha256(bytes) !== binding.sha256) throw operationError('FREEZE_AUTH_CHANGED', '晚采授权证据哈希已变化');
    const authorization = JSON.parse(bytes);
    assertSteamLateAuthorization(authorization, snapshot);
    if (binding.approvalRecordedAt !== authorization.approvalRecordedAt || binding.collectedAt !== authorization.collectedAt) throw operationError('FREEZE_AUTH_CHANGED', '晚采授权时间身份不匹配');
  }
  return snapshot;
}
export function archiveContentPath(root, date, channel) {
  requiredChannel(channel); assertDate(date);
  return path.resolve(root, 'data', ...(channel === 'minsheng' ? ['minsheng'] : []), `${date}.json`);
}
export async function inspectLocalArchive(root, date, channel, options = {}) {
  const target = archiveContentPath(root, date, channel);
  const result = { exists: false, valid: false, reasons: [] };
  try {
    const data = await readFile(target);
    result.exists = true;
    const brief = JSON.parse(data);
    const manifest = await readJsonIfExists(path.join(path.dirname(target), 'index.json'));
    const editions = manifest?.editions?.filter(item => item.date === date) || [];
    if (editions.length !== 1) throw operationError('ARCHIVE_INCOMPLETE', '正式正文没有唯一匹配索引');
    const { assertManifestEdition } = await import('./archive-consistency.mjs');
    assertManifestEdition(editions[0], brief, channel === 'game' ? '游戏日报' : '民生日报');
    const { assertChannelPreflight } = await import('./daily-preflight.mjs');
    const preflight = await assertChannelPreflight(root, { date, channel, candidate: target, recovery: true, requireReady: true, now: options.now });
    result.valid = true; result.issue = brief.issue; result.candidateSha256 = sha256(data); result.pngSha256 = preflight.identity.pngSha256;
  } catch (error) { result.reasons.push({ code: error.code || 'ARCHIVE_INVALID', message: error.message }); }
  return result;
}
export async function queryRunState(root, date, options = {}) {
  const paths = operationPaths(root, date);
  const result = { apiVersion: STATE_EVIDENCE_API_VERSION, date, checkedAt: clockNow(options).toISOString(), paths, lease: null, channels: {}, reasons: [] };
  let state = null;
  try { state = await readJsonIfExists(paths.state); if (state && state.date !== date) throw operationError('STATE_CONFLICT', '状态日期与请求不符'); }
  catch (error) { result.reasons.push({ code: error.code || 'STATE_INVALID', message: error.message }); state = null; }
  try { const lease = await readLeaseIfExists(paths.lease); result.lease = lease ? { ...lease, active: lease.date === date && Date.parse(lease.expiresAt) > clockNow(options).getTime() } : null; }
  catch (error) { result.reasons.push({ code: error.code || 'LEASE_INVALID', message: error.message }); }
  for (const channel of options.channel ? [requiredChannel(options.channel)] : ['minsheng','game']) {
    let research;
    try { research = await researchCompleteness(root, date, channel); }
    catch (error) { research = { date, channel, complete: false, sections: {}, reasons: [{ code: error.code || 'LEDGER_INVALID', message: error.message }] }; }
    const archive = await inspectLocalArchive(root, date, channel, options);
    const readiness = { valid: false, reasons: [] };
    try {
      const proof = await assertReadyProof(root, date, channel, { now: options.now, ...(archive.exists ? { candidate: archiveContentPath(root, date, channel), recovery: true } : {}) });
      readiness.valid = true; readiness.proof = proof; readiness.verifiedAt = proof.verifiedAt;
    } catch (error) { readiness.reasons.push({ code: error.code || 'PROOF_INVALID', message: error.message }); }
    const online = { valid: false, reasons: [] };
    try {
      const observations = await Promise.all([`${date}-${channel}-health.json`, `${date}-health.json`].map(name => readJsonIfExists(path.join(paths.directory, name))));
      const health = observations.filter(item => item?.date === date && item.channels?.[channel]).sort((a,b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0];
      const item = health?.channels?.[channel];
      const checkedAt = health?.checkedAt;
      const age = clockNow(options).getTime() - Date.parse(checkedAt);
      // Only evidence that binds both target hashes can confirm an online edition.
      online.recorded = Boolean(item); online.checkedAt = checkedAt || null;
      online.valid = Boolean(archive.valid && health?.date === date && age >= 0 && age <= 15 * 60 * 1000 && item?.live?.valid && item.live.content?.sha256 === archive.candidateSha256 && item.live.png?.sha256 === archive.pngSha256 && item.live.page?.valid && item.live.deployment?.valid);
      if (!online.valid) online.reasons.push({ code: 'ONLINE_UNVERIFIED', message: '缺少15分钟内匹配目标 JSON/PNG 哈希、页面与部署的线上证据；旧健康标签不能代替' });
    } catch (error) { online.reasons.push({ code: 'HEALTH_INVALID', message: error.message }); }
    result.channels[channel] = { ...research, research, stored: state?.channels?.[channel] || null, readiness, archive, online, publication: state?.channels?.[channel]?.publication || null, reasons: [...(research.reasons || []), ...readiness.reasons, ...archive.reasons, ...online.reasons] };
  }
  return result;
}
export function updatePublicationState(root, options = {}) {
  const { date, channel } = options;
  requiredChannel(channel); requiredText(options.runId, 'runId');
  return guardedMutation(root, date, options, async () => {
    const { transactionId, step, candidateSha256, pngSha256 } = options;
    requiredText(transactionId, 'transactionId');
    if (!PUBLICATION_STEPS.includes(step) || !/^[a-f0-9]{64}$/.test(candidateSha256 || '') || !/^[a-f0-9]{64}$/.test(pngSha256 || '')) throw operationError('PUBLICATION_CONFLICT', '发布步骤或身份无效');
    const paths = operationPaths(root, date);
    const state = await readJsonIfExists(paths.state);
    if (!state || state.date !== date || !state.channels?.[channel]) throw operationError('STATE_CONFLICT', '缺少同日频道状态');
    const previous = state.channels[channel].publication;
    if (previous && (previous.transactionId !== transactionId || previous.candidateSha256 !== candidateSha256 || previous.pngSha256 !== pngSha256 || PUBLICATION_STEPS.indexOf(step) < PUBLICATION_STEPS.indexOf(previous.step))) throw operationError('PUBLICATION_CONFLICT', '事务身份冲突或进度倒退');
    if (!previous && step !== 'prepared') throw operationError('PUBLICATION_CONFLICT', '新事务必须从 prepared 注册');
    if (state.channels[channel].published && previous?.step !== 'complete') throw operationError('PUBLICATION_CONFLICT', '已归档频道禁止新事务');
    const candidate = options.candidate || (step === 'prepared' ? expectedArtifactPaths(root, date, channel).candidate : archiveContentPath(root, date, channel));
    const recovery = path.resolve(root, candidate) === archiveContentPath(root, date, channel);
    const { assertChannelPreflight } = await import('./daily-preflight.mjs');
    await assertChannelPreflight(root, { date, channel, candidate, recovery, requireReady: true, candidateSha256, pngSha256, now: options.now });
    const { assertPublishTime } = await import('./game-lib.mjs');
    assertPublishTime(date, clockNow(options));
    if (['index-written','embedded-written','complete'].includes(step)) {
      const archive = await inspectLocalArchive(root, date, channel, options);
      if (!archive.valid) throw operationError('PUBLICATION_CONFLICT', '发布完成步骤缺少正式归档证据', archive);
    }
    if (previous?.step === step) return { apiVersion: STATE_EVIDENCE_API_VERSION, unchanged: true, publication: previous, state };
    const publication = { transactionId, step, candidateSha256, pngSha256, runId: options.runId, updatedAt: clockNow(options).toISOString() };
    state.channels[channel] = { ...state.channels[channel], publication, status: step === 'complete' ? 'published' : 'publishing', published: step === 'complete', ...(step === 'complete' ? { missingSections: [] } : {}) };
    state.stage = deriveStage(state); state.lastCheckpointAt = publication.updatedAt;
    await writeJson(paths.state, state);
    return { apiVersion: STATE_EVIDENCE_API_VERSION, unchanged: false, publication, state };
  });
}

// A completed local transaction may fail a deployment gate. This narrow reversal
// preserves its evidence and is refused once any edition file reaches HEAD.
export function cancelUncommittedPublication(root, options = {}) {
  const {date,channel,runId,transactionId,backup} = options;
  requiredChannel(channel); requiredText(runId,'runId'); requiredText(options.reason,'reason');
  return guardedMutation(root,date,options,async()=>{
    const {assertUncommittedPublication} = await import('./publication-repository.mjs');
    const before = await assertUncommittedPublication(root,options);
    const paths=operationPaths(root,date),state=await readJsonIfExists(paths.state);
    const current=state?.channels?.[channel];
    const historical=state?.publicationCancellations?.findLast(item=>item.transactionId===transactionId&&item.runId===runId);
    const publication=current?.publication||historical;
    if(publication?.runId!==runId||publication.transactionId!==transactionId)throw operationError('PUBLICATION_CONFLICT','只能撤回本轮未提交事务');
    const expectedBackup=path.join(paths.directory,`${date}-${channel}-cancelled-${transactionId}`);
    if(path.resolve(root,backup)!==expectedBackup)throw operationError('PUBLICATION_CONFLICT','撤回备份路径不匹配');
    const journal=await readJsonIfExists(path.join(expectedBackup,'journal.json'));
    const data=channel==='game'?'data':'data/minsheng';
    if(journal?.id!==transactionId||sha256(before)!==journal.indexBeforeSha256||sha256(await readFile(path.join(root,data,'index.json')))!==journal.indexBeforeSha256||
      await readJsonIfExists(archiveContentPath(root,date,channel))||sha256(await readFile(expectedArtifactPaths(root,date,channel).candidate))!==publication.candidateSha256||
      sha256(await readFile(path.join(expectedBackup,'body.json')))!==publication.candidateSha256||sha256(await readFile(path.join(expectedBackup,'public.png')))!==publication.pngSha256)throw operationError('PUBLICATION_CONFLICT','撤回文件或备份证据不匹配');
    if(!current.publication&&historical){
      if(current.published||current.status!=='researched')throw operationError('PUBLICATION_CONFLICT','撤回后频道已继续推进');
      return {cancelled:true,unchanged:true,transactionId,cancelledAt:historical.cancelledAt};
    }
    const cancelledAt=clockNow(options).toISOString();
    state.publicationCancellations=[...(state.publicationCancellations||[]),{...publication,date,channel,cancelledAt,reason:options.reason,backup}];
    const readiness=await readJsonIfExists(paths.readiness);
    if(readiness?.channels?.[channel]){delete readiness.channels[channel];await writeJson(paths.readiness,readiness);}
    state.channels[channel]={...current,status:'researched',published:false,publication:null,mirrorStatus:'pending'};
    state.stage=deriveStage(state);state.lastCheckpointAt=cancelledAt;
    await writeJson(paths.state,state);
    return {cancelled:true,transactionId,cancelledAt};
  });
}
