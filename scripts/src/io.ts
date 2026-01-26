import fs from "node:fs";
import path from "node:path";
import { JsonObject } from "./types.js";

export function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

export function readJsonIfExists<T>(p: string): T | null {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJson(p: string, data: unknown) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function listHistorySnapshots(historyDir: string): string[] {
  // data/history/YYYY-MM-DD/HH-mm.json
  if (!fs.existsSync(historyDir)) return [];
  const days = fs
    .readdirSync(historyDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const files: string[] = [];
  for (const day of days) {
    const dayDir = path.join(historyDir, day);
    const snaps = fs
      .readdirSync(dayDir, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.endsWith(".json"))
      .map((f) => path.join(dayDir, f.name))
      .sort();
    files.push(...snaps);
  }
  return files;
}

export function pruneOldHistory(historyDir: string, cutoffIsoUtc: string) {
  const cutoff = new Date(cutoffIsoUtc).getTime();
  const all = listHistorySnapshots(historyDir);
  for (const file of all) {
    const base = path.basename(file, ".json"); // HH-mm
    const day = path.basename(path.dirname(file)); // YYYY-MM-DD
    const isoGuess = `${day}T${base.replace("-", ":")}:00Z`;
    const t = new Date(isoGuess).getTime();
    if (!Number.isNaN(t) && t < cutoff) {
      fs.rmSync(file);
      // remove empty day dirs
      const dayDir = path.dirname(file);
      const remaining = fs.readdirSync(dayDir);
      if (remaining.length === 0) fs.rmdirSync(dayDir);
    }
  }
}

export function mergeUniqueByTs<T extends { ts: string }>(existing: T[], incoming: T[]): T[] {
  const map = new Map<string, T>();
  for (const p of existing) map.set(p.ts, p);
  for (const p of incoming) map.set(p.ts, p);
  return [...map.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}

export function withinWindow<T extends { ts: string }>(points: T[], cutoffIsoUtc: string): T[] {
  const cutoff = new Date(cutoffIsoUtc).getTime();
  return points
    .filter((p) => {
      const t = new Date(p.ts).getTime();
      return !Number.isNaN(t) && t >= cutoff;
    })
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

export function nowStampForHistoryDir(now: Date): { day: string; hm: string } {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  return { day: `${y}-${m}-${d}`, hm: `${hh}-${mm}` };
}

export function safeObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
  return {};
}
