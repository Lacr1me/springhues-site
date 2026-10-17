import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertGameArchiveConsistency, assertManifestEdition, assertMinshengArchiveConsistency, selectPriorEditions } from "./archive-consistency.mjs";
import { beijingDate, validateGame } from "./game-lib.mjs";
import { httpFallbackBase, tlsCertificateCode, sha256, requireEvidence, verifyDeploymentProof, verifyPageEvidence } from "./health-lib.mjs";
import { validateMinsheng } from "./minsheng-lib.mjs";

const CHANNELS = {
  game: {
    label: "游戏日报",
    manifestFile: "data/index.json",
    pagePath: "game/",
    pngPath: (date) => `downloads/game/${date}.png`,
    validate: validateGame,
    assertDistinct: assertGameArchiveConsistency
  },
  minsheng: {
    label: "民生日报",
    manifestFile: "data/minsheng/index.json",
    pagePath: "minsheng/",
    pngPath: (date) => `downloads/minsheng/${date}.png`,
    validate: validateMinsheng,
    assertDistinct: assertMinshengArchiveConsistency
  }
};

export async function runDailyHealth({ root = process.cwd(), date = beijingDate(), channel, liveBase, fetchImpl = fetch, checkedAt = new Date().toISOString(), targetCommit, pageProbe, deploymentProof, mirror = {} } = {}) {
  if (channel && !CHANNELS[channel]) throw new Error('Unknown health channel');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid health date');
  const selected = channel ? [[channel, CHANNELS[channel]]] : Object.entries(CHANNELS);
  const evidence = { targetCommit, pageProbe, deploymentProof };
  const normalizedLiveBase = liveBase?.replace(/\/$/, "");
  const result = {
    date,
    checkedAt,
    targetCommit: targetCommit || null,
    scope: selected.map(([name]) => name),
    mirror,
    evidenceBoundary: 'Local files, HTTP bytes, supplied browser observations and supplied Pages API evidence are reported separately. Offline/injected proofs are not production acceptance.',
    local: {},
    live: {},
    channels: {},
    reasonCodes: [],
    warnings: [],
    transport: normalizedLiveBase ? { requested: protocolName(normalizedLiveBase), effective: null } : null
  };

  for (const [channel, config] of selected) {
    config.channel = channel;
    const local = await inspectLocalChannel(root, date, config, checkedAt);
    result.local[channel] = local;
    result.channels[channel] = { local };
    collectReasonCodes(result, "local", channel, local);
  }

  if (normalizedLiveBase) {
    for (const [channel, config] of selected) {
      const live = await inspectLiveChannel(normalizedLiveBase, date, checkedAt, config, fetchImpl, result, evidence);
      result.live[channel] = live;
      result.channels[channel].live = live;
      collectReasonCodes(result, "live", channel, live);
    }
    const transports = new Set(Object.values(result.live).map((channel) => channel.transport).filter(Boolean));
    result.transport.effective = transports.has("http-fallback")
      ? "http-fallback"
      : transports.size === 1 ? [...transports][0] : transports.size ? "mixed" : "unavailable";
  }

  const groups = normalizedLiveBase ? [result.local, result.live] : [result.local];
  result.healthy = groups.every((group) => Object.values(group).every((channel) => channel.valid));
  for (const item of Object.values(result.channels)) item.healthy = item.local.valid && (!normalizedLiveBase || item.live.valid);
  result.localArchived = Object.values(result.local).every(item => item.valid);
  result.onlineVerified = Boolean(normalizedLiveBase && result.healthy);
  result.degraded = result.warnings.length > 0;
  return result;
}

async function inspectLocalChannel(root, date, config, checkedAt) {
  const content = await component(async () => {
    const manifest = await readJson(path.join(root, config.manifestFile));
    const edition = manifest.editions.find((item) => item.date === date);
    if (!edition) throw codedError("CONTENT_MISSING", "当天归档记录不存在");
    if (edition.publishAt !== `${date}T11:00:00+08:00`) throw codedError("PUBLISH_TIME_MISMATCH", "发布时间不是北京时间11:00");
    requireEvidence(Date.parse(edition.publishAt) <= Date.parse(checkedAt), 'NOT_PUBLISHED_YET', 'Target edition is not public before publishAt');
    assertManifestEdition(edition, {date, issue: edition.issue}, config.label);
    const bytes = await readFile(path.join(root, edition.file));
    const brief = JSON.parse(bytes);
    config.validate(brief, { expectedDate: date });
    assertManifestEdition(edition, brief, config.label);
    const priorBriefs = await Promise.all(selectPriorEditions(manifest, date, config.channel)
      .map((item) => readJson(path.join(root, item.file))));
    config.assertDistinct(brief, priorBriefs);
    return { file: edition.file, issue: edition.issue, sha256: sha256(bytes) };
  }, "CONTENT_INVALID");

  const png = await component(async () => {
    const file = path.join(root, config.pngPath(date));
    const buffer = await readFile(file);
    validatePng(buffer, config.label);
    return { file: config.pngPath(date), bytes: buffer.length, width: buffer.readUInt32BE(16), sha256: sha256(buffer) };
  }, "PNG_MISSING_OR_INVALID");

  const deployment = { valid: true, status: "local-filesystem" };
  return channelResult(content, png, deployment, "local");
}

async function inspectLiveChannel(base, date, checkedAt, config, fetchImpl, result, evidence) {
  try {
    await fetchOk(`${base}/?health=${encodeURIComponent(checkedAt)}`, fetchImpl);
    return inspectLiveAt(base, date, checkedAt, config, fetchImpl, protocolName(base), undefined, result.local[config.channel], evidence);
  } catch (error) {
    const certificateCode = tlsCertificateCode(error);
    const fallbackBase = certificateCode && httpFallbackBase(base);
    if (!fallbackBase) return failedLiveChannel(error, "TRANSPORT_FAILED");
    const warning = `HTTPS 证书异常（${certificateCode}），已通过 HTTP 只读复核内容；不得据此重做日报或重触发部署`;
    if (!result.warnings.includes(warning)) result.warnings.push(warning);
    if (!result.reasonCodes.includes("TLS_CERTIFICATE_DEGRADED")) result.reasonCodes.push("TLS_CERTIFICATE_DEGRADED");
    try {
      return await inspectLiveAt(fallbackBase, date, checkedAt, config, fetchImpl, "http-fallback", warning, result.local[config.channel], evidence);
    } catch (fallbackError) {
      return failedLiveChannel(codedError("TRANSPORT_FAILED", `HTTPS 证书异常（${certificateCode}），HTTP 复核也失败：${fallbackError.message}`), "TRANSPORT_FAILED");
    }
  }
}

async function inspectLiveAt(base, date, checkedAt, config, fetchImpl, transport, warning, local, evidence) {
  const stamp = encodeURIComponent(checkedAt);
  const pageUrl = `${base}/${config.pagePath}?date=${date}&health=${stamp}`;
  const reachability = await component(async () => {
    const response = await fetchOk(pageUrl, fetchImpl);
    return { url: response.url || `${base}/${config.pagePath}`, status: response.status };
  }, "DEPLOYMENT_UNAVAILABLE");
  const deployment = await component(async () => verifyDeploymentProof(evidence.deploymentProof, {targetCommit: evidence.targetCommit, checkedAt, base}), 'DEPLOYMENT_PROOF_INVALID');
  const page = await component(async () => {
    const proof = await evidence.pageProbe?.({url:pageUrl, date, channel:config.channel, checkedAt});
    return verifyPageEvidence(proof, {url:pageUrl, date, channel:config.channel, checkedAt});
  }, 'PAGE_PROOF_INVALID');

  const content = await component(async () => {
    const manifest = await fetchJson(`${base}/${config.manifestFile}?health=${stamp}`, fetchImpl);
    const edition = manifest.editions.find((item) => item.date === date);
    if (!edition) throw codedError("CONTENT_MISSING", "线上当天归档记录不存在");
    if (edition.publishAt !== `${date}T11:00:00+08:00`) throw codedError("PUBLISH_TIME_MISMATCH", "线上发布时间不是北京时间11:00");
    requireEvidence(Date.parse(edition.publishAt) <= Date.parse(checkedAt), 'NOT_PUBLISHED_YET', 'Target edition is not public before publishAt');
    assertManifestEdition(edition, {date, issue: edition.issue}, config.label);
    const response = await fetchOk(`${base}/${edition.file}?health=${stamp}`, fetchImpl);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = sha256(bytes);
    requireEvidence(local.content.sha256 && digest === local.content.sha256, 'JSON_HASH_MISMATCH', 'Response JSON bytes differ from local archive');
    const brief = JSON.parse(bytes);
    config.validate(brief, { expectedDate: date });
    assertManifestEdition(edition, brief, config.label);
    const priorBriefs = await Promise.all(selectPriorEditions(manifest, date, config.channel)
      .map((item) => fetchJson(`${base}/${item.file}?health=${stamp}`, fetchImpl)));
    config.assertDistinct(brief, priorBriefs);
    return { file: edition.file, issue: edition.issue, sha256: digest };
  }, "CONTENT_INVALID");

  const png = await component(async () => {
    const url = `${base}/${config.pngPath(date)}?health=${stamp}`;
    // The 3840px game download can be several megabytes. Give the body enough
    // time to arrive while keeping page/JSON probes on the shorter timeout.
    const response = await fetchOk(url, fetchImpl, 60000);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("image/png")) throw codedError("PNG_CONTENT_TYPE_INVALID", `PNG Content-Type 无效：${contentType || "缺失"}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    validatePng(buffer, config.label);
    requireEvidence(local.png.sha256 && sha256(buffer) === local.png.sha256, 'PNG_HASH_MISMATCH', 'Response PNG bytes differ from local public PNG');
    return { url, contentType, bytes: buffer.length, width: buffer.readUInt32BE(16), sha256: sha256(buffer) };
  }, "PNG_MISSING_OR_INVALID");

  return channelResult(content, png, deployment, transport, warning, page, reachability);
}

function channelResult(content, png, deployment, transport, warning, page, reachability) {
  const components = [content, png, deployment, page, reachability].filter(Boolean);
  const valid = components.every(item => item.valid);
  const reasons = components.filter((item) => !item.valid).map((item) => item.reason);
  return {
    valid,
    file: content.file,
    reason: reasons.join("；") || undefined,
    content,
    png,
    deployment,
    page,
    reachability,
    transport,
    warning
  };
}

function failedLiveChannel(error, fallbackCode) {
  const failed = failure(error.code || fallbackCode, error.message);
  return channelResult(failed, failed, failed, "unavailable");
}

async function component(callback, fallbackCode) {
  try { return { valid: true, ...(await callback()) }; }
  catch (error) { return failure(error.code || fallbackCode, error.message); }
}

function failure(code, reason) {
  return { valid: false, code, reason };
}

function collectReasonCodes(result, scope, channel, value) {
  for (const [componentName, componentValue] of Object.entries({ content: value.content, png: value.png, deployment: value.deployment, page:value.page, reachability:value.reachability }).filter(([,v])=>v)) {
    if (!componentValue?.valid) {
      const code = `${scope}_${channel}_${componentName}_${componentValue.code || "INVALID"}`.toUpperCase();
      if (!result.reasonCodes.includes(code)) result.reasonCodes.push(code);
    }
  }
}

function codedError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validatePng(buffer, label) {
  if (buffer.length <= 24) throw codedError("PNG_EMPTY", `${label} PNG 文件不能为空`);
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw codedError("PNG_SIGNATURE_INVALID", `${label} 必须是有效 PNG`);
  const width = buffer.readUInt32BE(16);
  if (width !== 3840) throw codedError("PNG_WIDTH_INVALID", `${label} PNG 宽度必须为 3840px，当前为 ${width}px`);
}

function protocolName(base) {
  return new URL(base).protocol.slice(0, -1);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function fetchOk(url, fetchImpl, timeoutMs = 15000) {
  const response = await fetchImpl(url, {
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw codedError(`HTTP_${response.status}`, `HTTP ${response.status}: ${url}`);
  return response;
}

async function fetchJson(url, fetchImpl) {
  return (await fetchOk(url, fetchImpl)).json();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const dateArg = process.argv.find((arg) => arg.startsWith("--date="));
  const liveArg = process.argv.find((arg) => arg.startsWith("--live="));
  const save = process.argv.includes("--save");
  const channel = process.argv.find(arg => arg.startsWith('--channel='))?.slice(10);
  const targetCommit = process.argv.find(arg => arg.startsWith('--target-commit='))?.slice(16);
  const proofFile = process.argv.find(arg => arg.startsWith('--evidence='))?.slice(11);
  const proofs = proofFile ? await readJson(path.resolve(proofFile)) : {};
  const date = dateArg?.slice("--date=".length) || beijingDate();
  const result = await runDailyHealth({
    root: process.cwd(),
    date,
    channel,
    targetCommit,
    deploymentProof: proofs.deployment,
    mirror: proofs.mirror,
    pageProbe: proofs.pages ? async ({channel}) => proofs.pages[channel] : undefined,
    liveBase: liveArg?.slice("--live=".length)
  });
  if (save) {
    const directory = path.resolve(process.cwd(), "artifacts", "operations");
    const { assertRunLease } = await import('./daily-operations.mjs');
    await assertRunLease(process.cwd(), date, {runId: process.argv.find(arg => arg.startsWith('--run-id='))?.slice(9)});
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${date}${channel ? `-${channel}` : ''}-health.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.healthy) process.exitCode = 1;
}
