const state = { manifest: null, brief: null, activeDate: null };
const $ = (selector) => document.querySelector(selector);
const pad = (number) => String(number).padStart(2, "0");
const cnDate = (iso) => {
  const [year, month, day] = iso.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
};

async function init() {
  try {
    const embedded = globalThis.__GAME_BRIEF_ARCHIVE__;
    try {
      state.manifest = await fetch("data/index.json?source=archive", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error("无法读取归档索引");
        return response.json();
      });
    } catch (error) {
      if (!embedded?.manifest) throw error;
      state.manifest = embedded.manifest;
    }
    buildArchive();
    const requested = new URLSearchParams(location.search).get("date");
    const available = getPublishedEditions();
    const chosen = available.find((edition) => edition.date === requested) || available[0];
    if (!chosen) throw new Error("11:00 后发布今日简报，请稍后再来");
    await loadBrief(chosen);
    scheduleEditionRefresh();
  } catch (error) {
    showToast(error.message, 5000);
  }
}

function nowInShanghai() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
}

function getPublishedEditions() {
  const now = Date.now();
  return [...state.manifest.editions]
    .filter((edition) => new Date(edition.publishAt).getTime() <= now)
    .sort((a, b) => b.date.localeCompare(a.date));
}

async function loadBrief(edition) {
  let data;
  try {
    const dataUrl = new URL(edition.file, document.baseURI);
    dataUrl.searchParams.set("edition", edition.date);
    data = await fetch(dataUrl, { cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("这期日报暂时无法读取");
      return response.json();
    });
  } catch (error) {
    data = globalThis.__GAME_BRIEF_ARCHIVE__?.briefs?.[edition.date];
    if (!data) throw error;
  }
  if (data.date !== edition.date) throw new Error("日报日期与归档索引不一致");
  const changingEdition = Boolean(state.activeDate);
  state.brief = data;
  state.activeDate = edition.date;
  if (changingEdition && window.SpringhuesUI) await window.SpringhuesUI.update(() => render(data));
  else render(data);
  const url = new URL(location.href);
  url.searchParams.set("date", edition.date);
  history.replaceState({}, "", url);
  updateArchiveActiveState();
  $("#archiveDialog").close();
  scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
}

function render(brief) {
  const downloadPng = $("#downloadPng");
  downloadPng.href = `downloads/game/${encodeURIComponent(brief.date)}.png`;
  downloadPng.download = `${brief.date}-游戏简报.png`;

  document.title = `${brief.date} 游戏方块日报`;
  $("#editionLabel").textContent = brief.backfilledAt
    ? `历史补档 · ${brief.date}`
    : `今日刊 · ${brief.date} · 11:00 发布`;
  $("#navDate").textContent = brief.date;
  $("#features").replaceChildren(...brief.features.map((item, index) => featureCard(item, index)));
  $("#newsList").replaceChildren(...brief.news.map((item, index) => newsRow(item, index)));
  $("#packList").replaceChildren(...brief.packs.map((item, index) => packRow(item, index)));
  $("#modsList").replaceChildren(...brief.mods.map(modRow));
  $("#dealList").replaceChildren(...brief.deals.map(dealRow));
  const lowCount = brief.deals.filter((deal) => deal.label.includes("史低")).length;
  $("#dealSummary").textContent = `${brief.deals.length} 款热门促销 · 含 ${lowCount} 款史低`;
  $("#dealList").scrollTop = 0;
  requestAnimationFrame(updateDealScrollbar);
  $("#trendList").replaceChildren(...brief.trends.map((trend) => element("li", "", trend)));
  $("#dataWindow").textContent = brief.dataWindow;
  $("#sourceSummary").textContent = `主要来源：${brief.sources.join("、")}。检索截止 ${brief.cutoff}。`;
}

function featureCard(item, index) {
  const link = externalLink(item.url, item.title, `feature-card${index ? " green" : ""}`);
  link.append(safeImage(item.image, item.title));
  const content = element("div", "feature-content");
  content.append(
    element("span", "tag", index ? "MINECRAFT" : "今日头条"),
    element("span", "out-link", "↗"),
    element("h3", "", item.title),
    element("p", "", item.summary),
    element("p", "feature-meta", `${item.source} · ${item.date}`)
  );
  link.append(content);
  return link;
}

function newsRow(item, index) {
  const link = externalLink(item.url, item.title, "news-row");
  const copy = element("div");
  const heading = element("h3", "", item.title);
  heading.append(element("span", "inline-link", "↗"));
  copy.append(heading, element("p", "", item.summary), element("small", "", `${item.source} · ${item.date}`));
  link.append(element("span", "rank", pad(index + 1)), safeImage(item.image, item.title), copy);
  return link;
}

function packRow(item, index) {
  const link = externalLink(item.url, item.name, "pack-row");
  const copy = element("div");
  const heading = element("h3", "", item.name);
  heading.append(element("span", "inline-link", "↗"));
  copy.append(heading, element("p", "", item.summary), element("small", "", `${item.category} · ${item.source}`));
  const heat = element("span", "heat", String(item.heat));
  heat.append(element("small", "", "HEAT"));
  link.append(element("span", "pack-rank", pad(index + 1)), safeImage(item.image, item.name), copy, heat);
  return link;
}

function modRow(item) {
  const link = externalLink(item.url, item.name, "mod-row");
  const identity = element("div");
  const name = element("b", "", `${item.name} `);
  name.append(element("span", "inline-link", "↗"));
  identity.append(name, element("p", "", `${item.version} · ${item.loader}`));
  link.append(identity, element("div", "", item.summary), element("div", "mod-meta", `${item.date}\n${item.source}`));
  return link;
}

function dealRow(item) {
  const link = externalLink(item.url, item.name, "deal-row");
  const copy = element("div");
  const heading = element("h3", "", item.name);
  heading.append(element("span", "inline-link", "↗"));
  const meta = element("p", "deal-meta");
  meta.append(
    element("span", "deal-discount", item.discount),
    element("span", "deal-separator", "·"),
    element("span", `deal-status${item.label.includes("史低") ? " low" : ""}`, item.label),
    element("span", "deal-separator", "·"),
    element("span", "deal-ends", item.ends)
  );
  copy.append(heading, meta);
  const price = element("div", "deal-price");
  price.append(element("b", "", item.price));
  const original = element("small");
  original.append(element("s", "", item.original));
  price.append(original);
  link.append(safeImage(item.image, item.name), copy, price);
  return link;
}

function buildArchive() {
  const list = $("#archiveList");
  const editions = getPublishedEditions();
  list.replaceChildren(...editions.map((edition) => {
    const link = element("a", "archive-item");
    link.href = editionUrl(edition.date);
    link.dataset.date = edition.date;
    link.append(element("time", "", edition.date), element("b", "", edition.headline || edition.title), element("span", "", "→"));
    return link;
  }));
  const dates = editions.map((edition) => edition.date).sort();
  if (dates.length) {
    $("#archiveDate").min = dates[0];
    $("#archiveDate").max = dates[dates.length - 1];
  }
}

function editionUrl(date) {
  const url = new URL(location.href);
  url.searchParams.set("date", date);
  url.hash = "";
  return url.href;
}

function updateArchiveActiveState() {
  $("#archiveDate").value = state.activeDate || "";
  document.querySelectorAll(".archive-item").forEach((item) => {
    const active = item.dataset.date === state.activeDate;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
}

function navigateToDate(date) {
  const edition = getPublishedEditions().find((item) => item.date === date);
  if (!edition) {
    $("#archiveDate").value = state.activeDate || "";
    return showToast("该日期没有已发布的游戏日报");
  }
  if (edition.date === state.activeDate) return $("#archiveDialog").close();
  location.assign(editionUrl(edition.date));
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

function externalLink(url, label, className) {
  const link = element("a", className);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("unsafe protocol");
    link.href = parsed.href;
  } catch {
    link.href = "#";
    link.addEventListener("click", (event) => event.preventDefault());
  }
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `${label}（打开原文）`);
  return link;
}

function safeImage(src, alt) {
  const image = element("img");
  image.alt = alt;
  image.loading = "eager";
  image.decoding = "sync";
  if (/^game-brief-assets\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(src || "")) image.src = src;
  else image.hidden = true;
  image.addEventListener("error", () => {
    image.hidden = true;
    image.parentElement?.classList.add("image-missing");
  });
  return image;
}

function updateDealScrollbar() {
  const list = $("#dealList");
  const track = $("#dealScrollbar");
  const thumb = $("#dealScrollThumb");
  const scrollable = list.scrollHeight > list.clientHeight + 1;
  track.hidden = !scrollable;
  if (!scrollable) return;
  const trackHeight = track.clientHeight;
  const thumbHeight = Math.max(42, Math.round(trackHeight * list.clientHeight / list.scrollHeight));
  const maxTop = Math.max(0, trackHeight - thumbHeight);
  const top = list.scrollHeight === list.clientHeight ? 0 : Math.round(maxTop * list.scrollTop / (list.scrollHeight - list.clientHeight));
  thumb.style.height = `${thumbHeight}px`;
  thumb.style.transform = `translateY(${top}px)`;
}

function openArchive() { $("#archiveDialog").showModal(); }
$("#archiveButton").addEventListener("click", openArchive);
$("#closeArchive").addEventListener("click", () => $("#archiveDialog").close());
$("#archiveDialog").addEventListener("click", (event) => { if (event.target === $("#archiveDialog")) $("#archiveDialog").close(); });
$("#archiveDate").addEventListener("change", (event) => navigateToDate(event.target.value));
$("#dealList").addEventListener("scroll", updateDealScrollbar, { passive: true });
addEventListener("resize", updateDealScrollbar, { passive: true });

function scheduleEditionRefresh() {
  const now = nowInShanghai();
  const next = new Date(now);
  next.setHours(11, 0, 3, 0);
  if (now >= next) next.setDate(next.getDate() + 1);
  const wait = Math.min(next.getTime() - now.getTime(), 2147483647);
  setTimeout(() => location.reload(), wait);
}

let toastTimer;
function showToast(message, duration = 2600) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), duration);
}

init();
