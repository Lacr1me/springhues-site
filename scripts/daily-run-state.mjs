import process from "node:process";
import { readFile } from 'node:fs/promises';
import { acquireRunLease, appendResearchLedger, checkpointRunState, createReadyProof, freezeSteamDiscovery, initializeRunState, mergeSourceAudits, queryRunState, reconcileRunState, releaseRunLease } from "./daily-operations.mjs";
import { beijingDate } from "./game-lib.mjs";

const root = process.cwd();
const [command = "status"] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const args = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith("--")).map((arg) => {
  const index = arg.indexOf("=");
  return index === -1 ? [arg.slice(2), true] : [arg.slice(2, index), arg.slice(index + 1)];
}));
const date = args.date || beijingDate();

try {
if (command === "init") {
  console.log(JSON.stringify(await initializeRunState(root, {
    date,
    runId: args["run-id"],
    kind: args.kind || "main",
    minshengIssue: numberOrUndefined(args["minsheng-issue"]),
    gameIssue: numberOrUndefined(args["game-issue"])
  }), null, 2));
} else if (command === "record") {
  console.log(JSON.stringify(await appendResearchLedger(root, {
    date,
    runId: args["run-id"],
    channel: args.channel,
    section: args.section,
    source: args.source,
    sourceId: args['source-id'],
    tier: args.tier,
    url: args.url,
    status: args.status,
    availableCount: args.available,
    rejectedCount: args.rejected,
    coverageComplete: args["coverage-complete"] === "true",
    evidenceComplete: args["evidence-complete"] === "true",
    reasons: args.reason,
    candidateIds: args.candidates,
    revokedCandidateIds: args['revoke-candidates'],
    eventId: args['event-id'],
    attemptedAt: args['attempted-at'],
    candidateEvidence: args['evidence-file'] ? JSON.parse(await readFile(args['evidence-file'], 'utf8')) : []
  }), null, 2));
} else if (command === "checkpoint") {
  console.log(JSON.stringify(await checkpointRunState(root, date, {
    stage: args.stage,
    channel: args.channel,
    status: args.status,
    published: args.published === undefined ? undefined : args.published === "true",
    missingSections: args.missing === undefined ? undefined : args.missing.split(",").filter(Boolean),
    runId: args["run-id"],
    runStatus: args["run-status"],
    exitReason: args['exit-reason'],
    mirrorStatus: args['mirror-status'],
    budget: args['budget-file'] ? JSON.parse(await readFile(args['budget-file'], 'utf8')) : undefined
  }), null, 2));
} else if (command === "lease-acquire") {
  console.log(JSON.stringify(await acquireRunLease(root, {
    date,
    runId: args["run-id"],
    ttlSeconds: numberOrUndefined(args.ttl)
  }), null, 2));
} else if (command === "lease-release") {
  console.log(JSON.stringify(await releaseRunLease(root, {
    date,
    runId: args["run-id"]
  }), null, 2));
} else if (command === "mark-ready") {
  console.log(JSON.stringify(await createReadyProof(root, {
    date,
    runId: args['run-id'],
    channel: args.channel,
    candidate: args.candidate,
    html: args.html,
    png: args.png,
    publicPng: args["public-png"],
    renderEvidence: args['render-evidence'],
    visualEvidence: args['visual-evidence']
  }), null, 2));
} else if (command === "merge-audit") {
  console.log(JSON.stringify(await mergeSourceAudits(root, date, { runId: args['run-id'] }), null, 2));
} else if (command === "steam-freeze") {
  console.log(JSON.stringify(await freezeSteamDiscovery(root, {
    date,
    runId: args["run-id"],
    sourceUrl: args["source-url"],
    lateAuthorizationFile: args['late-authorization-file'],
    frozenAt: args['frozen-at'],
    appIds: args["app-ids"],
    extraAppIds: args["extra-app-ids"]
  }), null, 2));
} else if (command === "reconcile") {
  const result = await reconcileRunState(root, date, { channel: args.channel, runId: args['run-id'] });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} else if (command === "status") {
  const output = await queryRunState(root, date, { channel: args.channel });
  console.log(JSON.stringify(output, null, 2));
} else {
  throw new Error(`未知命令：${command}`);
}
} catch (error) {
  console.log(JSON.stringify({ ok: false, date, code: error.code || 'OPERATION_FAILED', message: error.message, result: error.result || error.details }, null, 2));
  process.exitCode = 1;
}

function numberOrUndefined(value) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error("期号必须为正整数");
  return number;
}
