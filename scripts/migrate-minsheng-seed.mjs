import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeMinsheng, validateMinsheng } from "./minsheng-lib.mjs";

const root = process.cwd();
const sourcePath = path.join(root, "民生日报-2026-08-23.html");
const html = await readFile(sourcePath, "utf8");
const decode = (value) => value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">");

const storyPattern = /<article class="story"><div class="story-title"><span class="num">\d+<\/span><a href="([^"]+)">([^<]+)<\/a><\/div><div class="summary">([^<]+)<\/div><div class="meta"><a href="[^"]+">([^<]+)<\/a>　([^<]+)<\/div><\/article>/g;
const stories = [...html.matchAll(storyPattern)].map((match) => ({
  title: decode(match[2]), summary: decode(match[3]), source: decode(match[4]), publishedAt: decode(match[5]), url: decode(match[1])
}));
if (stories.length !== 35) throw new Error(`预期从成品HTML提取35条新闻，实际${stories.length}条`);

const sections = {
  domestic: stories.slice(0, 10),
  international: stories.slice(10, 20),
  tech: stories.slice(20, 30),
  ai: stories.slice(30, 35)
};
const metricPattern = /<div class="metric"><div class="metric-icon">([^<]+)<\/div><div><div class="metric-name">([^<]+)<\/div><div class="metric-value">([^<]+)<\/div><div class="metric-note">([^<]+)<\/div><\/div><\/div>/g;
const kindByName = {
  "国内金价": "gold", "北京油价": "domestic_oil", "布伦特原油": "international_oil", "WTI原油": "international_oil_wti",
  "人民币兑美元": "usd_cny", "人民币兑欧元": "eur_cny", "人民币兑日元": "jpy_cny", "上证指数": "shanghai_index", "深证／创业板": "china_indexes"
};
const metrics = [...html.matchAll(metricPattern)].map((match) => ({ kind: kindByName[decode(match[2])] || "other", icon: decode(match[1]), name: decode(match[2]), value: decode(match[3]), note: decode(match[4]) }));

const dateSub = html.match(/<div class="date-sub">([^<]+)<\/div>/)?.[1] || "星期日　农历丙午年七月十一";
const [weekday, lunarDate] = dateSub.split("　");
const observation = html.match(/<section class="observation">[\s\S]*?<p>([^<]+)<\/p><\/section>/)?.[1];
const productionTime = html.match(/制作时间：([^<]+)<\/div><\/footer>/)?.[1];
const sourceText = html.match(/<footer><div class="sources">数据来源：([^。]+)。/)?.[1] || "";
const topTitles = [...html.matchAll(/<div class="top3-row">[\s\S]*?<span>([^<]+)<\/span><\/div>/g)].map((match) => decode(match[1]));

const brief = normalizeMinsheng({
  date: "2026-08-23",
  issue: 1,
  weekday,
  lunarDate,
  cutoff: productionTime,
  productionTime,
  sections,
  topStoryIds: [],
  metrics,
  metricsCutoff: productionTime,
  metricSources: ["上海黄金交易所", "北京市发改委", "中国外汇交易中心", "新华财经", "公开国际油价数据"],
  observation,
  sources: sourceText.split("、").filter(Boolean),
});

const allStories = Object.values(brief.sections).flat();
brief.topStoryIds = topTitles.map((title) => allStories.find((story) => story.title === title || story.title.includes(title) || title.includes(story.title.replace(/^科学家将/, "")))?.id).filter(Boolean);
validateMinsheng(brief, { expectedDate: "2026-08-23" });

const dataDir = path.join(root, "data", "minsheng");
await mkdir(dataDir, { recursive: true });
await writeFile(path.join(dataDir, "2026-08-23.json"), `${JSON.stringify(brief, null, 2)}\n`, "utf8");
const manifest = {
  timezone: "Asia/Shanghai",
  generateAt: "10:50",
  publishAt: "11:00",
  editions: [{
    date: "2026-08-23",
    issue: 1,
    publishAt: "2026-08-23T11:00:00+08:00",
    title: "民生日报 · 每日35条精选新闻",
    headline: allStories.find((story) => story.id === brief.topStoryIds[0])?.title || "每日35条精选新闻",
    file: "data/minsheng/2026-08-23.json"
  }]
};
await writeFile(path.join(dataDir, "index.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log("已迁移 2026-08-23 民生日报：35条新闻、3条头条引用、9项数据指标。");
