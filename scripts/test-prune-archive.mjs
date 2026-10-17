// scripts/prune-archive.mjs 的隔离测试：在临时 git 仓库里造夹具，不碰真实 data/、downloads/、artifacts/。
// 与其它 B/C 测试一致，保留夹具目录便于排查。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyPrune, collectAssetRefs, parseArgs, planPrune, renderReport } from "./prune-archive.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "prune-archive-"));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const put = async (rel, text = "x") => { const file = path.join(root, ...rel.split("/")); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); };
const exists = (rel) => access(path.join(root, ...rel.split("/"))).then(() => true, () => false);
const edition = (channel, date, issue) => ({ date, issue, publishAt: `${date}T11:00:00+08:00`, title: channel, headline: `h${date}`,
  file: channel === "game" ? `data/${date}.json` : `data/minsheng/${date}.json` });

assert.deepEqual([...collectAssetRefs({ a: ["x game-brief-assets/2026-09-01-a.jpg y"], b: { c: "game-brief-assets/b.png" }, d: 1 })].sort(), ["game-brief-assets/2026-09-01-a.jpg", "game-brief-assets/b.png"]);
assert.throws(() => parseArgs(["--keep=0"]), /keep/);
assert.throws(() => parseArgs(["--channel=x"]), /channel/);
assert.throws(() => parseArgs(["--nope"]), /未知参数/);
assert.deepEqual(parseArgs(["--apply", "--keep=3", "--channel=game"]), { apply: true, keep: 3, channel: "game" });

try {
  git("init", "-q");
  // 游戏：日期有缺口（09-03、09-07 不存在），不假设连续。保留最近 3 期 = 09-08、09-06、09-05。
  const gameDates = ["2026-09-08", "2026-09-06", "2026-09-05", "2026-09-04", "2026-09-02", "2026-09-01"];
  const minshengDates = ["2026-09-08", "2026-09-07", "2026-09-06", "2026-09-05", "2026-09-04", "2026-09-02"];
  const manifest = (channel, dates) => ({ timezone: "Asia/Shanghai", generateAt: "09:30", publishAt: "11:00",
    editions: dates.map((date, index) => edition(channel, date, dates.length - index)) });
  await put("data/index.json", `${JSON.stringify(manifest("game", gameDates), null, 2)}\n`);
  await put("data/minsheng/index.json", `${JSON.stringify(manifest("minsheng", minshengDates), null, 2)}\n`);
  const refs = {
    "2026-09-08": ["game-brief-assets/2026-09-08-a.jpg"],
    "2026-09-06": ["game-brief-assets/2026-09-06-a.jpg"],
    "2026-09-05": ["game-brief-assets/2026-09-05-a.jpg", "game-brief-assets/2026-09-04-shared.jpg"],
    "2026-09-04": ["game-brief-assets/2026-09-04-shared.jpg", "game-brief-assets/2026-09-04-a.jpg", "game-brief-assets/legacy-removed.jpg"],
    "2026-09-02": ["game-brief-assets/2026-09-02-a.jpg", "game-brief-assets/2026-09-02-page.jpg"],
    "2026-09-01": ["game-brief-assets/2026-09-01-a.jpg"]
  };
  for (const [date, images] of Object.entries(refs)) {
    await put(`data/${date}.json`, JSON.stringify({ date, features: [{ image: images[0] }], deals: images.slice(1).map((image) => ({ image })) }));
    await put(`downloads/game/${date}.png`, `game-${date}`);
    for (const image of images) await put(image, image);
  }
  for (const date of minshengDates) {
    await put(`data/minsheng/${date}.json`, JSON.stringify({ date }));
    if (date !== "2026-09-02") await put(`downloads/minsheng/${date}.png`, `minsheng-${date}`); // 索引有、PNG 缺失
  }
  await put("data/2026-08-20.json", JSON.stringify({ date: "2026-08-20", features: [{ image: "game-brief-assets/2026-08-20-a.jpg" }] })); // 索引外残留
  await put("game-brief-assets/2026-08-20-a.jpg");
  await put("game-brief-assets/2026-08-01-stray.jpg"); // 早于窗口、无人引用：按文件名判定
  await put("game-brief-assets/legacy-unreferenced.jpg"); // 无日期记号且无人引用：无法判断，保留
  await put("data/embedded.js", "stale");
  await put("site/page.html", '<img src="game-brief-assets/2026-09-02-page.jpg">'); // 其它页面引用：保留
  await put("data/resources.json", "{}");
  git("add", "-A");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.autocrlf=false", "commit", "-qm", "fixture");
  await put("game-brief-assets/2026-09-01-untracked.jpg", "untracked"); // 未跟踪旧图：绝不删除
  await put("data/.pending/2026-09-09.json", JSON.stringify({ features: [{ image: "game-brief-assets/2026-09-01-a.jpg" }] })); // 草稿引用：保留
  await put("data/.pending/minsheng/2026-09-09.json", "{}");

  const plan = await planPrune({ root, keep: 3 });
  const [game, minsheng] = plan.plans;
  assert.deepEqual(game.kept.map((item) => item.date), ["2026-09-08", "2026-09-06", "2026-09-05"]);
  assert.deepEqual(game.removedDates, ["2026-09-04", "2026-09-02", "2026-09-01", "2026-08-20"].sort().reverse());
  assert.deepEqual(minshengDates.slice(0, 3), minsheng.kept.map((item) => item.date));
  assert.ok(minsheng.warnings.some((text) => text.includes("2026-09-02") && text.includes("PNG")), "索引有而 PNG 缺失必须明确提示");
  const planned = new Set(plan.deletions.map((item) => item.path));
  for (const rel of ["data/2026-09-04.json", "downloads/game/2026-09-04.png", "data/2026-08-20.json", "game-brief-assets/2026-09-04-a.jpg",
    "game-brief-assets/legacy-removed.jpg", "game-brief-assets/2026-09-02-a.jpg", "game-brief-assets/2026-08-20-a.jpg", "game-brief-assets/2026-08-01-stray.jpg",
    "data/minsheng/2026-09-04.json", "downloads/minsheng/2026-09-04.png"]) assert.ok(planned.has(rel), `应删除 ${rel}`);
  for (const rel of ["game-brief-assets/2026-09-04-shared.jpg", "game-brief-assets/2026-09-02-page.jpg", "game-brief-assets/2026-09-01-a.jpg",
    "game-brief-assets/legacy-unreferenced.jpg", "game-brief-assets/2026-09-01-untracked.jpg", "data/2026-09-05.json", "downloads/game/2026-09-05.png", "data/resources.json"]) assert.ok(!planned.has(rel), `必须保留 ${rel}`);
  assert.ok(plan.assets.unknown.includes("game-brief-assets/legacy-unreferenced.jpg"));
  assert.equal(plan.assets.untrackedOld.length, 1);
  const report = renderReport(plan);
  assert.ok(report.includes("dry-run") && report.includes("1 个未跟踪的旧图未处理"));

  // dry-run 不改任何文件。
  assert.ok(await exists("data/2026-09-04.json") && (await readFile(path.join(root, "data/index.json"), "utf8")).includes("2026-09-01"));

  let rebuilt = 0;
  await applyPrune(plan, { rebuildEmbedded: async () => { rebuilt += 1; } });
  assert.equal(rebuilt, 1);
  for (const rel of planned) assert.equal(await exists(rel), false, `${rel} 应已删除`);
  for (const rel of ["game-brief-assets/2026-09-04-shared.jpg", "game-brief-assets/2026-09-02-page.jpg", "game-brief-assets/2026-09-01-a.jpg",
    "game-brief-assets/legacy-unreferenced.jpg", "game-brief-assets/2026-09-01-untracked.jpg", "data/.pending/2026-09-09.json"]) assert.ok(await exists(rel), `${rel} 应保留`);
  for (const [file, channel, dates] of [["data/index.json", "game", gameDates], ["data/minsheng/index.json", "minsheng", minshengDates]]) {
    const expected = manifest(channel, dates);
    expected.editions = expected.editions.slice(0, 3);
    assert.equal(await readFile(path.join(root, file), "utf8"), `${JSON.stringify(expected, null, 2)}\n`, `${file} 必须只过滤条目并保持格式`);
  }
  // 暂存区只含删除；未跟踪文件不会被 git 触碰。
  const staged = git("diff", "--cached", "--name-status").trim().split(/\r?\n/);
  assert.ok(staged.length === planned.size && staged.every((line) => line.startsWith("D\t")), "git rm 只能产生删除");
  assert.match(git("status", "--short", "--", "game-brief-assets/2026-09-01-untracked.jpg"), /^\?\?/);

  const again = await planPrune({ root, keep: 3 });
  assert.equal(again.nothing, true, "重复运行必须无可移除内容");
  assert.ok(renderReport(again).includes("无可移除内容"));
  // 仅民生频道时不处理配图。
  const only = await planPrune({ root, keep: 1, channel: "minsheng" });
  assert.equal(only.assets.delete.length, 0);
  assert.ok(only.deletions.every((item) => item.path.includes("minsheng")));
  console.log("归档清理测试通过：最近 N 期窗口、共用配图保留、未跟踪文件不动、索引格式、幂等、缺失提示。");
} finally {
  console.log(`保留隔离测试夹具：${root}`);
}
