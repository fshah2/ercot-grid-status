import { CONFIG } from "./config.js";

/**
 * Convert common ERCOT “delivery” fields into an ISO timestamp.
 *
 * Many ERCOT datasets use:
 *  - deliveryDate: YYYY-MM-DD
 *  - deliveryHour: 1-24 (hour ending) or 0-23 (hour beginning) depending on dataset
 *  - deliveryInterval: 1-12 (5-min) or 1-4 (15-min) depending on dataset
 *
 * Because field conventions vary, we do best-effort:
 *  - If hour is 1-24, treat as “hour ending” and subtract 1 to get hour start.
 *  - If interval exists:
 *      5-min: (interval-1)*5
 *      15-min: (interval-1)*15
 *
 * We interpret as America/Chicago “wall clock” and then convert to UTC ISO.
 */
export function deliveryToIsoUtc(input: {
  deliveryDate?: string;
  deliveryHour?: number;
  deliveryInterval?: number;
}): string | null {
  const { deliveryDate, deliveryHour, deliveryInterval } = input;
  if (!deliveryDate || typeof deliveryDate !== "string") return null;

  const hourRaw = typeof deliveryHour === "number" ? deliveryHour : 0;

  // If 1-24, treat as hour ending
  const hourStart = hourRaw >= 1 && hourRaw <= 24 ? hourRaw - 1 : hourRaw;

  let minute = 0;
  if (typeof deliveryInterval === "number" && Number.isFinite(deliveryInterval)) {
    // choose 5-min vs 15-min by common range
    if (deliveryInterval >= 1 && deliveryInterval <= 12) minute = (deliveryInterval - 1) * 5;
    else if (deliveryInterval >= 1 && deliveryInterval <= 4) minute = (deliveryInterval - 1) * 15;
  }

  // Construct a "local time" string.
  const local = `${deliveryDate}T${pad2(hourStart)}:${pad2(minute)}:00`;

  // Convert to UTC ISO using Intl (no external deps).
  return localTimeToUtcIso(local, CONFIG.marketTimeZone);
}

export function parseAnyTimestampToIsoUtc(row: Record<string, unknown>): string | null {
  // Try common keys first
  const direct =
    getString(row, "timestamp") ||
    getString(row, "ts") ||
    getString(row, "datetime") ||
    getString(row, "dateTime") ||
    getString(row, "postedDatetime") ||
    getString(row, "postedDateTime") ||
    getString(row, "reportDatetime") ||
    getString(row, "reportDateTime");

  if (direct) {
    // If it already includes timezone/offset, Date can parse it.
    const d = new Date(direct);
    if (!Number.isNaN(d.getTime())) return d.toISOString();

    // If it's “YYYY-MM-DDTHH:mm:ss” without zone, assume market TZ.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(direct)) {
      return localTimeToUtcIso(direct, CONFIG.marketTimeZone);
    }
  }

  // Try delivery fields
  const deliveryDate = getString(row, "deliveryDate");
  const deliveryHour = getNumber(row, "deliveryHour");
  const deliveryInterval = getNumber(row, "deliveryInterval");
  return deliveryToIsoUtc({ deliveryDate, deliveryHour, deliveryInterval });
}

function localTimeToUtcIso(localIsoNoZone: string, timeZone: string): string | null {
  // Use Intl.DateTimeFormat to interpret local time zone.
  // Technique: format parts of a Date constructed from local string as if it were UTC,
  // then compute offset by comparing intended local components.
  const naive = new Date(localIsoNoZone + "Z"); // treat as UTC temporarily
  if (Number.isNaN(naive.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(naive);

  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  const asLocal = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get(
    "minute"
  )}:${get("second")}`;

  // The naive date was "localIsoNoZone as UTC". We want "localIsoNoZone as timeZone".
  // Compute delta between those two interpretations.
  const intended = new Date(asLocal + "Z");
  const deltaMs = naive.getTime() - intended.getTime();
  const utc = new Date(naive.getTime() + deltaMs);
  return utc.toISOString();
}

function pad2(n: number) {
  return String(Math.floor(n)).padStart(2, "0");
}
function getString(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" && v.trim() ? v : null;
}
function getNumber(o: Record<string, unknown>, k: string): number | null {
  const v = o[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
