import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
async function optional(file) {
  try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function conflict(message) { throw new Error(`PUBLISH_CONFLICT: ${message}`); }

// Each replacement is atomic at rename, not a cross-file atomic transaction.
// Unique staged files are retained on failure. Recovery inspects bytes, not just steps.
async function replace(file, bytes, afterStage = async () => {}) {
  await mkdir(path.dirname(file), { recursive: true });
  const staged = `${file}.${randomUUID()}.staged`;
  const handle = await open(staged, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await afterStage();
  await rename(staged, file);
}

export async function runPublishTransaction({ root, date, channel, runId, preflight, updateState,
  validateCandidate, makeEdition, afterBoundary = async () => {} }) {
  if (!['game', 'minsheng'].includes(channel) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid publish target');
  if (typeof preflight !== 'function' || typeof updateState !== 'function') throw new Error('Publish state adapter required');
  const data = channel === 'game' ? 'data' : 'data/minsheng';
  const pending = path.join(root, 'data/.pending', channel === 'game' ? '' : channel, `${date}.json`);
  const target = path.join(root, data, `${date}.json`);
  const png = path.join(root, 'downloads', channel, `${date}.png`);
  const index = path.join(root, data, 'index.json');
  const journalPath = path.join(root, 'artifacts/operations', `${date}-${channel}-publish-transaction.json`);
  const journalBytes = await optional(journalPath);
  let journal = journalBytes && JSON.parse(journalBytes);
  if (journal && (journal.schemaVersion !== 1 || !journal.id || !Array.isArray(journal.completedSteps) ||
    hash(jsonBytes(journal.manifestAfter)) !== journal.indexAfterSha256)) conflict('journal schema or saved manifest is damaged');
  let body = await optional(target);
  const draft = await optional(pending);
  if (!journal && body) conflict('unowned archive exists; retain it for inspection');
  if (!draft && !body) throw new Error('PUBLISH_INPUT_MISSING');
  const input = draft || body;
  const identity = { date, channel, candidateSha256: hash(input), pngSha256: hash(await readFile(png)) };
  if (journal) {
    for (const [key, value] of Object.entries(identity)) if (journal.identity?.[key] !== value) conflict(`${key} differs from journal`);
    if (body && hash(body) !== identity.candidateSha256) conflict('archive body changed');
  }
  const brief = JSON.parse(input);
  if (brief.date !== date) conflict('candidate date differs');
  const currentManifestBytes = await readFile(index);
  const manifest = JSON.parse(currentManifestBytes);
  if (journal) {
    if (![journal.indexBeforeSha256, journal.indexAfterSha256].includes(hash(currentManifestBytes))) conflict('index changed outside this transaction');
  } else {
    if (manifest.editions.some(item => item.date === date)) conflict('edition already indexed');
    await validateCandidate(brief, manifest);
  }
  const context = () => ({ root, date, channel, runId, ...identity, candidate: body ? target : pending,
    recovery: Boolean(body), transactionId: journal?.id, step: journal?.step });
  async function check() {
    const gate = await preflight(context());
    if (!gate?.valid) throw new Error(`PUBLISH_PREFLIGHT_FAILED: ${JSON.stringify(gate?.missing || gate?.errors || [])}`);
    // Catch edits between the gate and a write. Lease enforcement belongs to B.
    if (hash(await readFile(body ? target : pending)) !== identity.candidateSha256 || hash(await readFile(png)) !== identity.pngSha256) conflict('input changed during preflight');
  }
  await check();
  if (!journal) {
    const next = structuredClone(manifest);
    next.editions.push(makeEdition(brief));
    next.editions.sort((a, b) => b.date.localeCompare(a.date));
    journal = { schemaVersion: 1, id: randomUUID(), identity, createdAt: new Date().toISOString(),
      indexBeforeSha256: hash(currentManifestBytes), indexAfterSha256: hash(jsonBytes(next)), manifestBefore: manifest,
      manifestAfter: next, step: 'prepared', completedSteps: [] };
    await replace(journalPath, jsonBytes(journal), async () => { await afterBoundary('journal:prepared:staged'); await check(); });
    await afterBoundary('journal:prepared');
  }
  // Repeat all gates against the saved pre-publication manifest even after index commit.
  await validateCandidate(brief, journal.manifestBefore);
  async function progress(step) {
    await check();
    journal.step = step;
    journal.completedSteps = [...new Set([...journal.completedSteps, step])];
    journal.updatedAt = new Date().toISOString();
    await replace(journalPath, jsonBytes(journal), async () => { await afterBoundary(`journal:${step}:staged`); await check(); });
    await afterBoundary(`journal:${step}`);
    const stateSteps = {body:'content-written',index:'index-written',embedded:'embedded-written'};
    if (stateSteps[step]) {
      await updateState({...context(), status:'publishing', publicationStep:stateSteps[step]});
      await afterBoundary(`state:${step}`);
    }
  }
  if (journal.step !== 'complete') {
    await check();
    await updateState({ ...context(), status: 'publishing', publicationStep:'prepared' });
    await afterBoundary('state:publishing');
  }
  if (!body) {
    await check();
    // Never overwrite a destination, including an unjournalled competing write.
    if (await optional(target)) conflict('archive appeared during publication');
    await rename(pending, target);
    body = input;
    await afterBoundary('body:written');
  }
  if (journal.step !== 'complete') await progress('body');
  const beforeIndex = await readFile(index);
  if (hash(beforeIndex) === journal.indexBeforeSha256) {
    await check();
    await replace(index, jsonBytes(journal.manifestAfter), async () => { await afterBoundary('index:staged'); await check(); });
    await afterBoundary('index:written');
  } else if (hash(beforeIndex) !== journal.indexAfterSha256) conflict('index changed before replacement');
  if (journal.step !== 'complete') await progress('index');
  if (channel === 'game') {
    const briefs = {};
    for (const edition of journal.manifestAfter.editions) briefs[edition.date] = JSON.parse(await readFile(path.join(root, edition.file), 'utf8'));
    const embedded = Buffer.from(`globalThis.__GAME_BRIEF_ARCHIVE__ = ${JSON.stringify({ manifest: journal.manifestAfter, briefs })};\n`);
    const embeddedPath = path.join(root, 'data/embedded.js');
    const existing = await optional(embeddedPath);
    if (!existing?.equals(embedded)) {
      await check();
      await replace(embeddedPath, embedded, async () => { await afterBoundary('embedded:staged'); await check(); });
      await afterBoundary('embedded:written');
    }
    if (journal.step !== 'complete') await progress('embedded');
  }
  await check();
  await updateState({ ...context(), status: 'published', publicationStep:'complete' });
  await afterBoundary('state:published');
  if (journal.step !== 'complete') await progress('complete');
  return { status: 'complete', transactionId: journal.id, identity, journal: journalPath };
}
