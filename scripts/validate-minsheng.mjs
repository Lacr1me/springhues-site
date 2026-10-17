import { readFile } from "node:fs/promises";
import path from "node:path";
import { SOURCE_POLICY_VERSION, validateMinsheng, validateMinshengSourceAudit } from "./minsheng-lib.mjs";

const file = process.argv[2];
if (!file) throw new Error("用法：node scripts/validate-minsheng.mjs <日报JSON> [来源审计JSON]");
const fullPath = path.resolve(process.cwd(), file);
const brief = JSON.parse(await readFile(fullPath, "utf8"));
validateMinsheng(brief, { expectedDate: brief.date });
if (brief.sourcePolicyVersion === SOURCE_POLICY_VERSION) {
  const auditFile = process.argv[3] || path.join(process.cwd(), "artifacts", "operations", `${brief.date}-source-audit.json`);
  const audit = JSON.parse(await readFile(path.resolve(process.cwd(), auditFile), "utf8").catch(() => {
    throw new Error(`来源策略v2必须提供来源审计：${auditFile}`);
  }));
  validateMinshengSourceAudit(brief, audit);
}
console.log(`校验通过：${brief.date}，共 ${Object.values(brief.sections).flat().length} 条新闻。`);
