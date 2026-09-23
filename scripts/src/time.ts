import { CONFIG } from "./config.js";

/**
 * ERCOT timestamps are Central Prevailing Time (America/Chicago) with no offset,
 * e.g. "2026-09-22T14:05:17". Everything we write for the website is real UTC ISO.
 *
 * DST edge cases:
 *  - Spring forward: local 02:00–02:59 does not exist. We shift it forward using
 *    the pre-transition offset (02:30 -> 03:30 CDT), which is what ERCOT's
 *    hour-ending labels imply.
 *  - Fall back: local 01:00–01:59 happens twice. By default we pick the first
 *    (CDT, UTC-5) occurrence. ERCOT marks the second occurrence with a flag
 *    (repeatHourFlag / repeatedHourFlag / DSTFlag); pass `isRepeatHour: true`
 *    (alias `preferLater`) to get the second (CST, UTC-6) occurrence.
 */
export type LocalTimeOptions = {
  timeZone?: string;
  isRepeatHour?: boolean;
  preferLater?: boolean;
};

const HOUR_MS = 60 * 60 * 1000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock time of `utcMs` in `timeZone`, expressed as "naive" epoch ms (as if it were UTC). */
function wallClockMs(utcMs: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const hour = get("hour") % 24; // guard against engines that emit "24" for midnight
  return Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
}

/** Offset (ms) of `timeZone` from UTC at instant `utcMs` (e.g. -5h for CDT). */
function offsetMs(utcMs: number, timeZone: string): number {
  return wallClockMs(utcMs, timeZone) - Math.floor(utcMs / 1000) * 1000;
}

/** Parse "YYYY-MM-DDTHH:mm[:ss[.sss]]" (no zone) as naive epoch ms. */
function parseNaiveLocal(local: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? "0"));
  return Number.isNaN(ms) ? null : ms;
}

/**
 * All UTC instants whose wall-clock time in `timeZone` equals `naiveMs`.
 * 0 results = spring-forward gap, 2 results = fall-back repeated hour.
 */
function resolveLocal(naiveMs: number, timeZone: string): number[] {
  const offsets = new Set([
    offsetMs(naiveMs - 12 * HOUR_MS, timeZone),
    offsetMs(naiveMs + 12 * HOUR_MS, timeZone)
  ]);
  const out: number[] = [];
  for (const off of offsets) {
    const utc = naiveMs - off;
    if (wallClockMs(utc, timeZone) === naiveMs) out.push(utc);
  }
  return out.sort((a, b) => a - b);
}

function pickInstant(naiveMs: number, opts: LocalTimeOptions): number {
  const timeZone = opts.timeZone ?? CONFIG.marketTimeZone;
  const candidates = resolveLocal(naiveMs, timeZone);
  if (candidates.length === 0) {
    // Gap: interpret with the offset in effect just before the transition.
    return naiveMs - offsetMs(naiveMs - 12 * HOUR_MS, timeZone);
  }
  const later = opts.isRepeatHour ?? opts.preferLater ?? false;
  return later ? candidates[candidates.length - 1] : candidates[0];
}

/**
 * Convert a Central-time wall-clock string ("YYYY-MM-DDTHH:mm:ss", no zone) to UTC ISO.
 * Strings that already carry "Z" or an offset are passed through (normalized).
 */
export function localTimeToUtcIso(local: string, opts: LocalTimeOptions = {}): string | null {
  if (!local) return null;
  if (/[zZ]$/.test(local) || /[+-]\d{2}:\d{2}$/.test(local)) {
    const t = Date.parse(local);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const naive = parseNaiveLocal(local);
  if (naive == null) return null;
  return new Date(pickInstant(naive, opts)).toISOString();
}

/**
 * Parse ERCOT hour-ending values: "01:00", "1:00", "24:00", "1", or integer 1..24.
 * Returns the hour number 1..24, or null.
 */
export function parseHourEnding(hourEnding: unknown): number | null {
  if (typeof hourEnding === "number") {
    return Number.isInteger(hourEnding) && hourEnding >= 1 && hourEnding <= 24 ? hourEnding : null;
  }
  if (typeof hourEnding !== "string") return null;
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(hourEnding);
  if (!m) return null;
  if (m[2] && m[2] !== "00") return null;
  const he = Number(m[1]);
  return he >= 1 && he <= 24 ? he : null;
}

/**
 * Convert (operating date, hour ending) in Central time to the UTC instant at which
 * that hour ENDS. "24:00" rolls over to 00:00 of the next day.
 *
 * We resolve the hour's START (HE-1:00 local) and add one hour, because on the
 * fall-back day the start (01:00) is the ambiguous wall-clock time that the
 * repeat flag disambiguates. If the start falls in the spring-forward gap, the
 * hour-ending wall time itself is unambiguous and we use it directly.
 */
export function hourEndingToUtcIso(
  operatingDate: string,
  hourEnding: unknown,
  opts: LocalTimeOptions = {}
): string | null {
  const he = parseHourEnding(hourEnding);
  if (!operatingDate || he == null) return null;

  const dayMs = parseNaiveLocal(`${operatingDate}T00:00:00`);
  if (dayMs == null) return null;

  const timeZone = opts.timeZone ?? CONFIG.marketTimeZone;
  const startNaive = dayMs + (he - 1) * HOUR_MS;

  if (resolveLocal(startNaive, timeZone).length === 0) {
    const endNaive = dayMs + he * HOUR_MS;
    return new Date(pickInstant(endNaive, { ...opts, timeZone })).toISOString();
  }
  return new Date(pickInstant(startNaive, { ...opts, timeZone }) + HOUR_MS).toISOString();
}

/** Calendar date (YYYY-MM-DD) of `d` in the market time zone. */
export function marketDate(d: Date, timeZone: string = CONFIG.marketTimeZone): string {
  return new Date(wallClockMs(d.getTime(), timeZone)).toISOString().slice(0, 10);
}

/** Wall-clock "YYYY-MM-DDTHH:mm:ss" of `d` in the market time zone (ERCOT query param format). */
export function marketDateTimeParam(d: Date, timeZone: string = CONFIG.marketTimeZone): string {
  return new Date(wallClockMs(d.getTime(), timeZone)).toISOString().slice(0, 19);
}

/** Human-readable market time, e.g. "Sep 23, 12:00 AM CDT" (for plain-English notes). */
export function marketTimeLabel(d: Date, timeZone: string = CONFIG.marketTimeZone): string {
  return d.toLocaleString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  });
}
