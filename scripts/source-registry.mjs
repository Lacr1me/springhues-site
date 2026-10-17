import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.resolve(scriptDir, "..", "config", "daily-sources.json");

export const SOURCE_REGISTRY = JSON.parse(readFileSync(registryPath, "utf8"));

const aliasToId = new Map();
for (const [id, source] of Object.entries(SOURCE_REGISTRY.sources)) {
  for (const value of [id, source.label, ...(source.aliases || [])]) {
    aliasToId.set(normalizeKey(value), id);
  }
}

export function canonicalSourceId(value) {
  return aliasToId.get(normalizeKey(value)) || null;
}

export function canonicalSourceLabel(value) {
  const id = canonicalSourceId(value);
  return id ? SOURCE_REGISTRY.sources[id].label : String(value || "").trim();
}

export function requiredSourceIds(channel, section) {
  const ids = SOURCE_REGISTRY.requirements?.[channel]?.[section];
  if (!Array.isArray(ids)) throw new Error(`未知的日报来源分组：${channel}/${section}`);
  return [...ids];
}

export function requiredSourceLabels(channel, section) {
  return requiredSourceIds(channel, section).map((id) => SOURCE_REGISTRY.sources[id].label);
}

export function allowedSourceIds(channel, section) {
  const required = requiredSourceIds(channel, section);
  const optional = SOURCE_REGISTRY.optionalRequirements?.[channel]?.[section] || [];
  return [...new Set([...required, ...optional])];
}

export function channelSections(channel) {
  const sections = SOURCE_REGISTRY.requirements?.[channel];
  if (!sections) throw new Error(`未知日报频道：${channel}`);
  return Object.keys(sections);
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s／/·•()（）_-]+/g, "");
}
