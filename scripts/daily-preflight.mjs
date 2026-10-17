import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { STATE_EVIDENCE_API_VERSION, archiveContentPath, assertGameDealCoverage, assertResearchComplete, inspectReadyArtifacts, operationPaths, readResearchLedger } from './daily-operations.mjs';
import { validateGame } from './game-lib.mjs';
import { validateMinsheng, validateMinshengSourceAudit } from './minsheng-lib.mjs';
import { assertGamePublishCandidate, assertMinshengPublishCandidate, assertManifestEdition, selectArchiveComparisonEditions } from './archive-consistency.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
function exact(root, input, expected) {
  const result = path.resolve(root, input || expected);
  if (result !== path.resolve(expected)) fail('PATH_INVALID', `路径必须为 ${expected}`);
  return result;
}
function inside(root, input, directory) {
  if (!input) fail('ARTIFACT_MISSING', '缺少渲染/检查证据路径');
  const file = path.resolve(root, input);
  const relative = path.relative(directory, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('PATH_INVALID', '渲染和检查证据必须位于当天 render 目录');
  return file;
}
function sameDateTime(value, date, now) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= Date.parse(date + 'T00:00:00+08:00') && time <= now.getTime();
}
function issueEvidenceTime(value, brief, now) {
  const time = Date.parse(value);
  if (!brief?.backfilledAt) return sameDateTime(value, brief?.date, now);
  const backfilledAt = Date.parse(brief.backfilledAt);
  return Number.isFinite(time) && Number.isFinite(backfilledAt) &&
    backfilledAt > Date.parse(`${brief.date}T11:00:00+08:00`) &&
    time >= backfilledAt && time <= now.getTime();
}
export async function preflightChannel(root, options = {}) {
  const { date, channel } = options;
  const now = new Date(options.now ?? Date.now());
  const result = { apiVersion: STATE_EVIDENCE_API_VERSION, date, channel, ok: false, checkedAt: now.toISOString(), identity: {}, gates: {}, reasons: [], proof: null, dependencyHashes: {} };
  result.archiveComparisonVersion = 2;
  async function gate(name, callback) {
    try { const value = await callback(); result.gates[name] = { ok: true }; return value; }
    catch (error) { const reason = { code: error.code || name.toUpperCase() + '_INVALID', message: error.message }; result.gates[name] = { ok: false, ...reason }; result.reasons.push(reason); return null; }
  }
  if (!['game','minsheng'].includes(channel) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    result.reasons.push({ code: 'INPUT_INVALID', message: '需要目标日期及频道' }); return result;
  }
  const paths = operationPaths(root, date);
  const renderDirectory = path.join(paths.directory, date + '-render');
  const canonical = path.resolve(root, 'data', '.pending', ...(channel === 'minsheng' ? ['minsheng'] : []), date + '.json');
  let proof = null;
  if (options.requireReady) proof = await gate('readiness', () => inspectReadyArtifacts(root, date, channel, options));
  result.proof = proof;
  const artifactOptions = { candidate: options.candidate || (options.recovery ? archiveContentPath(root, date, channel) : proof?.candidate), html: options.html || proof?.html, png: options.png || proof?.renderPng, publicPng: options.publicPng || proof?.publicPng, renderEvidence: options.renderEvidence || proof?.preflight?.evidencePaths?.renderEvidence, visualEvidence: options.visualEvidence || proof?.preflight?.evidencePaths?.visualEvidence };
  const brief = await gate('content', async () => {
    const candidate = exact(root, artifactOptions.candidate, options.recovery ? archiveContentPath(root, date, channel) : canonical);
    const buffer = await readFile(candidate);
    result.identity.candidate = path.relative(root, candidate).replaceAll('\\','/');
    result.identity.candidateSha256 = digest(buffer);
    if (options.candidateSha256 && result.identity.candidateSha256 !== options.candidateSha256) fail('PROOF_CHANGED','候选身份与事务不符');
    const value = JSON.parse(buffer);
    (channel === 'game' ? validateGame : validateMinsheng)(value, { expectedDate: date });
    result.identity.issue = value.issue;
    return value;
  });
  await gate('research', async () => {
    const research = await assertResearchComplete(root, date, channel);
    result.research = research;
    const entries = (await readResearchLedger(root, date)).filter(item => item.channel === channel);
    result.dependencyHashes.research = digest(JSON.stringify(entries));
    // Final content must be linked to the active evidence set, not only counted.
    if (brief) for (const [section, summary] of Object.entries(research.sections)) {
      const items = channel === 'game' ? brief[section] : section === 'metrics' ? brief.metrics : brief.sections[section];
      for (const item of items || []) {
        const ids = [typeof item === 'string' ? item : item.id, item?.url, item?.kind, item?.name, item?.title].filter(Boolean);
        const appId = /\/app\/(\d+)/.exec(item?.url || '')?.[1]; if (appId) ids.push(appId);
        if (!ids.some(id => summary.candidateIds.includes(id))) fail('CANDIDATE_UNBOUND', `${section} 成品条目未绑定当前有效候选：${ids[0] || 'unknown'}`);
      }
    }
  });
  await gate('stateIdentity', async () => {
    const state = await readJson(paths.state);
    if (state.date !== date || !state.channels?.[channel]) fail('STATE_CONFLICT', '缺少同日频道状态');
    if (brief && state.channels[channel].issue != null && state.channels[channel].issue !== brief.issue) fail('STATE_CONFLICT','状态期号与正文不一致');
  });
  if (channel === 'minsheng') await gate('audit', async () => {
    if (!brief) fail('CONTENT_REQUIRED', '审计依赖有效正文');
    const auditBuffer = await readFile(paths.audit);
    validateMinshengSourceAudit(brief, JSON.parse(auditBuffer));
    result.dependencyHashes.audit = digest(auditBuffer);
  });
  if (channel === 'game') await gate('steamCoverage', async () => {
    if (!brief) fail('CONTENT_REQUIRED', '覆盖门禁依赖有效正文');
    result.dealCoverage = await assertGameDealCoverage(root, date, brief);
    if (date >= '2026-08-27') result.dependencyHashes.freeze = digest(await readFile(paths.steamDiscovery));
  });
  await gate('archive', async () => {
    if (!brief) fail('CONTENT_REQUIRED', '归档门禁依赖有效正文');
    const manifest = await readJson(path.join(root, 'data', ...(channel === 'minsheng' ? ['minsheng'] : []), 'index.json'));
    if (!Array.isArray(manifest.editions)) fail('ARCHIVE_INVALID','归档索引无效');
    const current = manifest.editions.filter(item => item.date === date);
    if (current.length && !options.recovery) fail('ARCHIVE_CONFLICT','目标期已在正式索引');
    if (current.length > 1) fail('ARCHIVE_CONFLICT','目标期重复索引');
    if (current.length) assertManifestEdition(current[0], brief, channel === 'game' ? '游戏日报' : '民生日报');
    // Publication issue order also handles later historical backfills.
    const priorManifest = { ...manifest, editions: options.recovery && current.length
      ? manifest.editions.filter(item => item.issue < brief.issue)
      : manifest.editions.filter(item => item.date !== date) };
    const recent = selectArchiveComparisonEditions(priorManifest, date, channel);
    const prior = [];
    const identities = [];
    for (const edition of recent) {
      const file = exact(root, edition.file, archiveContentPath(root, edition.date, channel));
      const data = await readFile(file);
      const value = JSON.parse(data);
      assertManifestEdition(edition, value, channel === 'game' ? '游戏日报' : '民生日报');
      prior.push(value); identities.push({ edition, sha256: digest(data) });
    }
    (channel === 'game' ? assertGamePublishCandidate : assertMinshengPublishCandidate)(brief, priorManifest, prior);
    // Retain the dependency identity of existing published proofs. All affected
    // successor bodies still pass the new gate; only the saved hash format differs.
    const hashedIdentities = options.recovery && proof && !proof.preflight.archiveComparisonVersion
      ? identities.filter(item => item.edition.date < date) : identities;
    result.dependencyHashes.archive = digest(JSON.stringify({ editions: priorManifest.editions, recent: hashedIdentities }));
  });
  await gate('render', async () => {
    const html = inside(root, artifactOptions.html, renderDirectory);
    const png = inside(root, artifactOptions.png, renderDirectory);
    const publicPng = exact(root, artifactOptions.publicPng, path.resolve(root, 'downloads', channel, date + '.png'));
    const [htmlBuffer, pngBuffer, publicBuffer] = await Promise.all([readFile(html), readFile(png), readFile(publicPng)]);
    if (pngBuffer.length <= 24 || !pngBuffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || pngBuffer.readUInt32BE(16) !== 3840) fail('PNG_INVALID','PNG 必须为3840px');
    const pngSha256 = digest(pngBuffer);
    if (digest(publicBuffer) !== pngSha256 || (options.pngSha256 && options.pngSha256 !== pngSha256)) fail('PROOF_CHANGED','公开 PNG/事务身份与渲染 PNG 不一致');
    result.identity.pngSha256 = pngSha256; result.identity.htmlSha256 = digest(htmlBuffer);
    const href = channel === 'game' ? `downloads/game/${date}.png` : `../downloads/minsheng/${date}.png`;
    if (!htmlBuffer.toString('utf8').includes(date) || !htmlBuffer.toString('utf8').includes(href)) fail('HTML_INVALID','HTML 日期/下载路径错误');
    const evidenceFile = inside(root, artifactOptions.renderEvidence, renderDirectory);
    const evidenceBuffer = await readFile(evidenceFile);
    const evidence = JSON.parse(evidenceBuffer);
    if (evidence.date !== date || evidence.channel !== channel || evidence.renderer !== 'render.mjs' || evidence.scale !== 2 || evidence.validate !== true || evidence.candidateSha256 !== result.identity.candidateSha256 || evidence.htmlSha256 !== result.identity.htmlSha256 || evidence.pngSha256 !== pngSha256 || !issueEvidenceTime(evidence.checkedAt, brief, now)) fail('RENDER_EVIDENCE_INVALID','缺少匹配当前 JSON/HTML/PNG 的统一渲染记录');
    result.dependencyHashes.renderEvidence = digest(evidenceBuffer);
    result.evidencePaths = { renderEvidence: path.relative(root, evidenceFile).replaceAll('\\','/') };
  });
  await gate('visual', async () => {
    const evidenceFile = inside(root, artifactOptions.visualEvidence, renderDirectory);
    const buffer = await readFile(evidenceFile);
    const evidence = JSON.parse(buffer);
    if (evidence.date !== date || evidence.channel !== channel || evidence.method !== 'view_image' || evidence.result !== 'pass' || !String(evidence.inspector || '').trim() || !issueEvidenceTime(evidence.inspectedAt, brief, now) || evidence.pngSha256 !== result.identity.pngSha256 || !Array.isArray(evidence.findings) || evidence.findings.length) fail('VISUAL_EVIDENCE_INVALID','缺少 view_image 原图检查通过记录或目标 PNG 哈希不符');
    result.dependencyHashes.visualEvidence = digest(buffer);
    result.evidencePaths = { ...result.evidencePaths, visualEvidence: path.relative(root, evidenceFile).replaceAll('\\','/') };
  });
  if (proof) await gate('proofFreshness', async () => {
    for (const [key, value] of Object.entries(result.dependencyHashes)) if (proof.preflight.dependencyHashes?.[key] !== value) fail('PROOF_CHANGED', `就绪后依赖发生变化：${key}`);
    if (Object.keys(proof.preflight.dependencyHashes || {}).some(key => !result.dependencyHashes[key])) fail('PROOF_CHANGED', '旧证明依赖无法重新核验');
  });
  result.ok = Object.values(result.gates).every(item => item.ok) && result.reasons.length === 0;
  return result;
}
export async function assertChannelPreflight(root, options) {
  const result = await preflightChannel(root, options);
  if (!result.ok) throw Object.assign(new Error(result.reasons.map(item => item.code + ': ' + item.message).join('\n')), { code: 'PRECHECK_FAILED', result });
  return result;
}
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--')).map(arg => { const i = arg.indexOf('='); return i < 0 ? [arg.slice(2), true] : [arg.slice(2,i),arg.slice(i+1)]; }));
  const result = await preflightChannel(process.cwd(), { date: args.date, channel: args.channel, candidate: args.candidate, html: args.html, png: args.png, publicPng: args['public-png'], renderEvidence: args['render-evidence'], visualEvidence: args['visual-evidence'], requireReady: args['require-ready'] === 'true', recovery: args.recovery === 'true', candidateSha256: args['candidate-sha256'], pngSha256: args['png-sha256'] });
  console.log(JSON.stringify(result,null,2)); if (!result.ok) process.exitCode = 1;
}
