import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertGameDealCoverage, assertResearchComplete, researchCompleteness } from "./daily-operations.mjs";
import { beijingDate } from "./game-lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).filter((arg) => arg.startsWith("--")).map((arg) => {
  const index = arg.indexOf("=");
  return index === -1 ? [arg.slice(2), true] : [arg.slice(2, index), arg.slice(index + 1)];
}));
const date = args.date || beijingDate();
const channels = args.channel ? [args.channel] : ["minsheng", "game"];
const output = { date, channels: {} };
let failed = false;
for (const channel of channels) {
  try {
  output.channels[channel] = await researchCompleteness(process.cwd(), date, channel);
  try { await assertResearchComplete(process.cwd(), date, channel); }
  catch { failed = true; }
  if (channel === "game") {
    const candidatePath = path.resolve("data", ".pending", `${date}.json`);
    try {
      const brief = JSON.parse(await readFile(candidatePath, "utf8"));
      output.channels[channel].dealCoverage = await assertGameDealCoverage(process.cwd(), date, brief);
    } catch (error) {
      if (error.code !== "ENOENT") {
        output.channels[channel].dealCoverage = { complete: false, error: error.message };
        failed = true;
      } else {
        output.channels[channel].dealCoverage = { complete: false, skipped: true, code: 'CANDIDATE_MISSING', error: '诊断未含候选覆盖，不能作为 ready 门禁' };
        if (args['require-candidate'] === 'true') failed = true;
      }
    }
  }
  } catch (error) { output.channels[channel] = { complete: false, code: error.code || 'RESEARCH_INVALID', error: error.message }; failed = true; }
}
console.log(JSON.stringify(output, null, 2));
if (failed) process.exitCode = 1;
