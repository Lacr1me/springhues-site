const state = { manifest: null, edition: null, activeDate: null };
const externalSourceMarker = "（来自于外网）";
const categoryConfig = {
  domestic: { target: "domesticStories", color: "#d71920" },
  international: { target: "internationalStories", color: "#6a19d8" },
  tech: { target: "techStories", color: "#079447" },
  ai: { target: "aiStories", color: "#0876d1" }
};

const $ = (selector) => document.querySelector(selector);
const desktopColumns = window.matchMedia("(min-width: 1501px)");
let alignmentFrame;
const publishedEditions = () => [...state.manifest.editions]
  .filter((edition) => new Date(edition.publishAt).getTime() <= Date.now())
  .sort((a, b) => b.date.localeCompare(a.date));
const cnDate = (iso) => {
  const [year, month, day] = iso.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
};

async function init() {
  try {
    state.manifest = await fetch("../data/minsheng/index.json?source=archive", { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("无法读取民生日报归档");
      return response.json();
    });
    const editions = publishedEditions();
    if (!editions.length) throw new Error("今日日报将在 11:00 后发布");
    buildArchive(editions);
    const requested = new URLSearchParams(location.search).get("date");
    const selected = editions.find((edition) => edition.date === requested) || editions[0];
    if (requested && selected.date !== requested) showToast("该日期尚未发布，已为你打开最新一期", 4200);
    await loadEdition(selected, false);
    scheduleRefresh();
  } catch (error) {
    showToast(error.message, 6000);
    $("#loading p").textContent = error.message;
  }
}

async function loadEdition(edition, scroll = true) {
  $("#loading").classList.remove("hidden");
  try {
    const dataUrl = new URL(`../${edition.file}`, location.href);
    dataUrl.searchParams.set("edition", edition.date);
    const brief = await fetch(dataUrl, { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("这期日报暂时无法读取");
      return response.json();
    });
    if (brief.date !== edition.date) throw new Error("日报日期与归档索引不一致");
    state.edition = brief;
    state.activeDate = edition.date;
    if (scroll && window.SpringhuesUI) await window.SpringhuesUI.update(() => render(brief));
    else render(brief);
    history.replaceState({}, "", `?date=${encodeURIComponent(edition.date)}`);
    $("#archiveDialog").close();
    if (scroll) window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  } finally {
    $("#loading").classList.add("hidden");
    $("#top").setAttribute("aria-busy", "false");
  }
}

function render(brief) {
  const downloadPng = $("#downloadPng");
  downloadPng.href = `../downloads/minsheng/${encodeURIComponent(brief.date)}.png`;
  downloadPng.download = `${brief.date}-民生日报.png`;

  document.title = `${brief.date} 民生日报`;
  $("#navDate").textContent = brief.date;
  $("#editionDate").textContent = cnDate(brief.date);
  $("#weekday").textContent = brief.weekday;
  $("#lunarDate").textContent = brief.lunarDate;

  const storyById = new Map();
  for (const [category, config] of Object.entries(categoryConfig)) {
    const stories = brief.sections[category];
    stories.forEach((story) => storyById.set(story.id, { ...story, category }));
    renderStories($("#" + config.target), stories);
  }

  const topList = $("#topStories");
  topList.replaceChildren(...brief.topStoryIds.map((id, index) => {
    const story = storyById.get(id);
    const item = document.createElement("li");
    item.style.setProperty("--story-color", categoryConfig[story.category].color);
    const number = document.createElement("span");
    number.textContent = index + 1;
    const link = document.createElement("a");
    link.href = story.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = story.title;
    item.append(number, link);
    return item;
  }));

  const metrics = brief.metrics.map((metric) => {
    const item = document.createElement("div");
    item.className = "metric";
    const icon = document.createElement("div");
    icon.className = "metric-icon";
    icon.setAttribute("aria-hidden", "true");
    if (window.SpringhuesUI) icon.append(window.SpringhuesUI.icon("chart"));
    const body = document.createElement("div");
    const metricNote = metric.source
      ? `${metric.note}；${formatSource(metric.source, metric.sourceOrigin)}`
      : metric.note;
    body.append(textNode("div", "metric-name", metric.name), textNode("div", "metric-value", metric.value), textNode("div", "metric-note", metricNote));
    item.append(icon, body);
    return item;
  });
  $("#metrics").replaceChildren(...metrics);
  const metricSourceOrigins = sourceOriginMap(brief.metrics);
  const storySourceOrigins = sourceOriginMap(Object.values(brief.sections).flat());
  const metricSources = brief.metricSources.map((source) => formatSource(source, metricSourceOrigins.get(source)));
  const storySources = brief.sources.map((source) => formatSource(source, storySourceOrigins.get(source)));
  $("#metricsCutoff").textContent = `数据截至：${brief.metricsCutoff} · ${metricSources.join("、")}`;
  $("#observation").textContent = brief.observation;
  $("#sourceLine").textContent = `数据来源：${storySources.join("、")}。全部标题均保留可点击原始链接。`;
  $("#cutoffLine").textContent = `检索截止：${brief.cutoff}`;
  $("#productionTime").textContent = `制作时间：${brief.productionTime}`;
  updateArchiveActiveState();
  scheduleStoryAlignment();
}

function scheduleStoryAlignment() {
  cancelAnimationFrame(alignmentFrame);
  alignmentFrame = requestAnimationFrame(alignStoryRows);
}

function alignStoryRows() {
  const lists = ["#domesticStories", "#internationalStories", "#techStories"].map((selector) => $(selector));
  const rows = lists.map((list) => [...list.children]);
  const sideColumn = document.querySelector(".aligned-columns .side-column");
  const newsColumns = [...document.querySelectorAll(".aligned-columns > .news-column")];

  rows.flat().forEach((story) => story.style.removeProperty("height"));
  sideColumn?.style.removeProperty("height");
  if (!desktopColumns.matches || rows.some((group) => !group.length) || !sideColumn) return;

  const rowCount = Math.min(...rows.map((group) => group.length));
  const rowHeights = Array.from({ length: rowCount }, (_, index) =>
    Math.ceil(Math.max(...rows.map((group) => group[index].getBoundingClientRect().height)))
  );
  applyRowHeights(rows, rowHeights);

  let newsHeight = Math.ceil(Math.max(...newsColumns.map((column) => column.getBoundingClientRect().height)));
  const sideNaturalHeight = Math.ceil(sideColumn.getBoundingClientRect().height);
  if (sideNaturalHeight > newsHeight) {
    const extraPerRow = Math.ceil((sideNaturalHeight - newsHeight) / rowCount);
    applyRowHeights(rows, rowHeights.map((height) => height + extraPerRow));
    newsHeight = Math.ceil(Math.max(...newsColumns.map((column) => column.getBoundingClientRect().height)));
  }
  sideColumn.style.height = `${newsHeight}px`;
}

function applyRowHeights(rows, heights) {
  heights.forEach((height, index) => rows.forEach((group) => {
    group[index].style.height = `${height}px`;
  }));
}

function renderStories(container, stories) {
  container.replaceChildren(...stories.map((story, index) => {
    const article = document.createElement("article");
    article.className = "story";
    const heading = document.createElement("div");
    heading.className = "story-title";
    const number = textNode("span", "story-number", String(index + 1).padStart(2, "0"));
    const h3 = document.createElement("h3");
    const link = document.createElement("a");
    link.href = story.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = story.title;
    h3.append(link);
    heading.append(number, h3);
    const summary = textNode("p", "story-summary", story.summary);
    const meta = document.createElement("div");
    meta.className = "story-meta";
    const source = document.createElement("a");
    source.href = story.url;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    source.textContent = formatSource(story.source, story.sourceOrigin);
    meta.append(source, document.createTextNode(story.publishedAt));
    const paperLabel = [story.paper?.journal, story.paper?.doi ? `DOI ${story.paper.doi}` : ""]
      .filter(Boolean)
      .join(" · ");
    if (paperLabel) {
      const paper = story.paper.url ? document.createElement("a") : document.createElement("span");
      if (story.paper.url) {
        paper.href = story.paper.url;
        paper.target = "_blank";
        paper.rel = "noopener noreferrer";
      }
      paper.textContent = paperLabel;
      meta.append(paper);
    }
    article.append(heading, summary, meta);
    return article;
  }));
}

function formatSource(source, sourceOrigin) {
  const value = String(source || "").replace(new RegExp(`${externalSourceMarker}$`), "").trim();
  return sourceOrigin === "external" ? `${value}${externalSourceMarker}` : value;
}

function sourceOriginMap(items) {
  const origins = new Map();
  for (const item of items) {
    if (!item?.source) continue;
    const current = origins.get(item.source);
    origins.set(item.source, current === "external" || item.sourceOrigin === "external" ? "external" : item.sourceOrigin);
  }
  return origins;
}

function textNode(tag, className, value) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

function buildArchive(editions) {
  const list = $("#archiveList");
  list.replaceChildren(...editions.map((edition) => {
    const link = document.createElement("a");
    link.className = "archive-item";
    link.href = editionUrl(edition.date);
    link.dataset.date = edition.date;
    const time = document.createElement("time");
    time.textContent = edition.date;
    const title = document.createElement("b");
    title.textContent = edition.headline || edition.title;
    const arrow = document.createElement("span");
    arrow.textContent = "→";
    link.append(time, title, arrow);
    return link;
  }));
  const dates = editions.map((edition) => edition.date).sort();
  $("#archiveDate").min = dates[0];
  $("#archiveDate").max = dates[dates.length - 1];
}

function updateArchiveActiveState() {
  $("#archiveDate").value = state.activeDate;
  document.querySelectorAll(".archive-item").forEach((item) => {
    const active = item.dataset.date === state.activeDate;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
}

function editionUrl(date) {
  const url = new URL(location.href);
  url.searchParams.set("date", date);
  url.hash = "";
  return url.href;
}

function navigateToDate(date) {
  const edition = publishedEditions().find((item) => item.date === date);
  if (!edition) {
    $("#archiveDate").value = state.activeDate;
    return showToast("该日期没有已发布的日报");
  }
  if (edition.date === state.activeDate) return $("#archiveDialog").close();
  location.assign(editionUrl(edition.date));
}

$("#archiveTrigger").addEventListener("click", () => $("#archiveDialog").showModal());
$("#closeArchive").addEventListener("click", () => $("#archiveDialog").close());
$("#archiveDialog").addEventListener("click", (event) => { if (event.target === $("#archiveDialog")) $("#archiveDialog").close(); });
$("#archiveDate").addEventListener("change", (event) => navigateToDate(event.target.value));
window.addEventListener("resize", scheduleStoryAlignment);
document.fonts?.ready.then(scheduleStoryAlignment);

function scheduleRefresh() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  const target = new Date(now);
  target.setHours(11, 0, 5, 0);
  if (now >= target) target.setDate(target.getDate() + 1);
  setTimeout(() => location.reload(), Math.min(target - now, 2147483647));
}

let toastTimer;
function showToast(message, duration = 3000) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), duration);
}

init();
