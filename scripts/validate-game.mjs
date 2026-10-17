import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateGame } from "./game-lib.mjs";

const target = process.argv[2];
if (!target) throw new Error("用法：node scripts/validate-game.mjs <日报JSON路径>");
const brief = JSON.parse(await readFile(path.resolve(target), "utf8"));
validateGame(brief);
console.log(`游戏日报校验通过：${brief.date}`);
