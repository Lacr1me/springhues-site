import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beijingDate } from './game-lib.mjs';
import { operationPaths, queryRunState } from './daily-operations.mjs';

const channels = ['game', 'minsheng'];
const exists = async file => access(file).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});
function validDate(date) {
  const parsed = new Date(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('INVALID_DATE');
  return date;
}

// Read-only: include calendar gaps as well as retained state. Never initialize a past day.
export async function checkDailyBacklog({ root = process.cwd(), through, channel, now = new Date() } = {}) {
  const today = beijingDate(now);
  through ||= beijingDate(new Date(now.getTime() - 86400000));
  validDate(through);
  if (through >= today) throw new Error('BACKLOG_MUST_PRECEDE_TODAY');
  if (channel && !channels.includes(channel)) throw new Error('INVALID_CHANNEL');
  const selected = channel ? [channel] : channels;
  const manifests = {};
  for (const name of selected) {
    const file = path.join(root, 'data', ...(name === 'minsheng' ? [name] : []), 'index.json');
    manifests[name] = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(manifests[name].editions)) throw new Error('INVALID_MANIFEST');
    const dates = manifests[name].editions.map(edition => validDate(edition.date));
    if (new Set(dates).size !== dates.length) throw new Error('DUPLICATE_ARCHIVE_DATE');
  }
  const directory = path.join(root, 'artifacts', 'operations');
  const files = await readdir(directory).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const stateDates = files.filter(file => /^\d{4}-\d{2}-\d{2}-run-state\.json$/.test(file)).map(file => validDate(file.slice(0, 10)));
  const retainedDates = [...Object.values(manifests).flatMap(manifest => manifest.editions.map(edition => edition.date)), ...stateDates].filter(date => date <= through).sort();
  const floors = Object.fromEntries(selected.map(name => [name, manifests[name].editions.map(edition => edition.date).sort()[0] || null]));
  const entries = [];
  const unclosedRuns = [];
  if (retainedDates.length) for (let day = new Date(retainedDates[0] + 'T00:00:00Z'); day.toISOString().slice(0, 10) <= through; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    if (stateDates.includes(date)) {
      const paths = operationPaths(root, date);
      const state = JSON.parse(await readFile(paths.state, 'utf8'));
      const lease = await exists(paths.lease) ? JSON.parse(await readFile(paths.lease, 'utf8')) : null;
      if (state.date !== date) throw new Error('STATE_DATE_CONFLICT');
      const activeLease = Boolean(lease?.date === date && Date.parse(lease.expiresAt) > now.getTime());
      for (const run of state.runs || []) if (run.status === 'running') unclosedRuns.push({ date, runId: run.id, startedAt: run.startedAt, activeLease });
    }
    for (const name of selected) {
      // 归档只保留最近 7 期（scripts/prune-archive.mjs）：早于本频道最早在档期次的日期是被有意移除的，不算缺口。
      if (floors[name] && date < floors[name]) continue;
      const indexed = manifests[name].editions.some(edition => edition.date === date);
      const body = path.join(root, 'data', ...(name === 'minsheng' ? [name] : []), date + '.json');
      const png = path.join(root, 'downloads', name, date + '.png');
      // Existing complete file pairs are audited by check-daily-health; do not re-render them.
      if (indexed && await exists(body) && await exists(png)) continue;
      const view = await queryRunState(root, date, { channel: name, now });
      const item = view.channels[name];
      entries.push({
        date, channel: name, issue: item.stored?.issue ?? null, activeLease: view.lease?.active === true,
        action: item.archive.exists || indexed ? 'recover-archive' : item.readiness.valid ? 'publish-ready' : 'resume-research',
        readinessValid: item.readiness.valid, researchComplete: item.research.complete,
        sections: Object.fromEntries(Object.entries(item.research.sections || {}).filter(([, section]) => !section.complete).map(([key, section]) => [key, {
          candidateCount: section.candidateCount, target: section.target, missing: section.missing,
          incomplete: section.incomplete, evidenceMissingIds: section.evidenceMissingIds,
          ...(key === 'deals' ? { unresolvedAppIds: section.unresolvedAppIds || [],
            freezeError: section.frozenDiscoveryError, coverageError: section.frozenCoverageError } : {})
        }])),
        reasons: [...(item.research.reasons || []), ...(indexed || item.archive.exists ? item.archive.reasons : [])]
      });
    }
  }
  return { apiVersion: 1, checkedAt: now.toISOString(), through, firstDate: retainedDates[0] || null,
    archiveCounts: Object.fromEntries(selected.map(name => [name, manifests[name].editions.filter(edition => edition.date <= through).length])),
    missingCount: entries.length, entries, unclosedRuns };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const index = arg.indexOf('=');
    return [arg.slice(2, index), arg.slice(index + 1)];
  }));
  try {
    console.log(JSON.stringify(await checkDailyBacklog({ through: args.through, channel: args.channel }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
