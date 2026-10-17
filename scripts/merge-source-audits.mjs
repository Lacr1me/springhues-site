import { mergeSourceAudits } from "./daily-operations.mjs";
import { beijingDate } from "./game-lib.mjs";

const dateArg = process.argv.find((arg) => arg.startsWith("--date="));
const date = dateArg?.slice("--date=".length) || beijingDate();
console.log(JSON.stringify(await mergeSourceAudits(process.cwd(), date), null, 2));
