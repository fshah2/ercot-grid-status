// scripts/src/normalize.ts
// Normalizers for ERCOT Public Data API responses.
//
// ERCOT "public-reports" often returns a columnar format:
//
// {
//   "fields": [{ "name": "SCEDTimestamp" }, ...],
//   "data": [
//      ["2026-01-24T18:45:17", false, "HB_NORTH", 216.77],
//      ...
//   ]
// }
//
// This file converts that into object rows and then into frontend points.
//
// All ERCOT timestamps are Central Prevailing Time with no offset; every `ts`
// produced here is real UTC ISO (see time.ts).

import { hourEndingToUtcIso, localTimeToUtcIso } from "./time.js";

type AnyRow = Record<string, any>;
type ApiResponseLike = any;

function isObject(x: any): x is Record<string, any> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function toNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * True when the row is flagged as the second occurrence of the repeated hour
 * on the fall-back DST day. Each dataset names the flag differently:
 *  - repeatHourFlag: 2d_agg_gen_summary, lmp_node_zone_hub
 *  - repeatedHourFlag: sced_system_lambda
 *  - DSTFlag: act_sys_load_by_fzn, lf_by_model_weather_zone
 * hourly_res_outage_cap has no flag (first occurrence is used).
 */
function isRepeatHour(r: AnyRow): boolean {
  return r.repeatHourFlag === true || r.repeatedHourFlag === true || r.DSTFlag === true;
}

// ERCOT SCED/posted timestamps look like "2026-01-24T18:45:17" (Central time, no zone).
function normalizeTs(ts: string, isRepeat = false): string {
  if (!ts) return "";
  return localTimeToUtcIso(ts, { isRepeatHour: isRepeat }) ?? "";
}

function firstArrayRow(arr: any[]): any[] | null {
  for (const x of arr) if (Array.isArray(x)) return x;
  return null;
}

function looksLikeAggGenSummaryRow(row: any[]): boolean {
  // expected: ["2026-01-21T12:30:19", false, <numbers...>]
  return (
    Array.isArray(row) &&
    typeof row[0] === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(String(row[0])) &&
    row.length >= 10
  );
}

/**
 * Convert API response(s) to a list of object-rows.
 * Supports:
 * - { fields: [{name}], data: [ [...], ... ] }
 * - { _embedded: { reportData: [ {...}, ... ] } } (older style)
 * - { data: [ {...}, ... ] } object rows
 *
 * Also supports a common local-cache mistake:
 * - Saving ONLY the "data" array (array-of-arrays) for 2d_agg_gen_summary,
 *   which otherwise loses the field names. We recover with a fallback field order.
 */
export function extractRows(resp: ApiResponseLike): AnyRow[] {
  if (!resp) return [];

  // If this is already an array of responses, flatten.
  if (Array.isArray(resp)) {
    // Case: array-of-arrays (often mistakenly saved as the entire payload)
    const first = firstArrayRow(resp);
    if (first && looksLikeAggGenSummaryRow(first)) {
      // IMPORTANT: match ERCOT field order for NP3-910-ER (2D Agg Gen Summary),
      // as returned in the API's `fields` array (see data/latest/2d_agg_gen_summary.json).
      // (2nd col is repeatHourFlag, NOT postedDatetime)
      const fallbackFields = [
        "SCEDTimestamp",
        "repeatHourFlag",
        "sumBasePointNonIRR",
        "sumBasePointWGR",
        "sumBasePointPVGR",
        "sumBasePointREMRES",
        "sumGenTelemMW",
        "sumBasePointESR",
        "sumBasePointESRCharge",
        "sumBasePointESRDischarge",
        "sumHASLNonIRR",
        "sumLASLNonIRR",
        "sumHASLWGR",
        "sumLASLWGR",
        "sumHASLPVGR",
        "sumLASLPVGR",
        "sumHASLREMRES",
        "sumLASLREMRES"
      ];

      return (resp as any[])
        .filter((r) => Array.isArray(r))
        .map((arr: any[]) => {
          const obj: AnyRow = {};
          for (let i = 0; i < Math.min(arr.length, fallbackFields.length); i++) {
            obj[fallbackFields[i]] = arr[i];
          }
          return obj;
        });
    }

    // Else: array of mixed things (or array of response objects)
    return resp.flatMap(extractRows);
  }

  // Columnar format: fields + data arrays
  if (Array.isArray(resp.fields) && Array.isArray(resp.data) && resp.data.length) {
    const fieldNames = resp.fields.map((f: any) => f?.name).filter(Boolean);
    if (!fieldNames.length) return [];

    return resp.data
      .filter((r: any) => Array.isArray(r))
      .map((arr: any[]) => {
        const obj: AnyRow = {};
        for (let i = 0; i < fieldNames.length; i++) obj[fieldNames[i]] = arr[i];
        return obj;
      });
  }

  // Some caches store { data: [ [...], ... ] } without fields (still recover if it’s agg gen)
  if (Array.isArray(resp.data) && resp.data.length && Array.isArray(resp.data[0])) {
    const first = firstArrayRow(resp.data);
    if (first && looksLikeAggGenSummaryRow(first)) {
      return extractRows(resp.data);
    }
    return [];
  }

  // Embedded object rows (some endpoints)
  const emb = resp._embedded;
  if (emb && Array.isArray(emb.reportData)) return emb.reportData.filter(isObject);

  // Direct object array
  if (Array.isArray(resp.data) && resp.data.length && isObject(resp.data[0])) {
    return resp.data as AnyRow[];
  }

  return [];
}

/**
 * Build LOAD points: {ts,value} using operatingDay + hourEnding and "total" MW.
 * ts = UTC instant at which the hour ends (HE24 -> next day 00:00 Central).
 */
export function buildLoadPoints(rows: AnyRow[]): Array<{ ts: string; value: number }> {
  const points: Array<{ ts: string; value: number }> = [];

  for (const r of rows) {
    const operatingDay = r.operatingDay;
    const hourEnding = r.hourEnding;
    const total = toNumber(r.total);

    if (!operatingDay || !hourEnding || total === null) continue;

    const ts = hourEndingToUtcIso(String(operatingDay), hourEnding, { isRepeatHour: isRepeatHour(r) });
    if (!ts) continue;

    points.push({ ts, value: total });
  }

  // sort + dedupe by ts (keep last)
  points.sort((a, b) => a.ts.localeCompare(b.ts));
  const out: Array<{ ts: string; value: number }> = [];
  for (const p of points) {
    if (!out.length || out[out.length - 1].ts !== p.ts) out.push(p);
    else out[out.length - 1] = p;
  }
  return out;
}

/**
 * Build PRICE points: pick one headline settlement point if present.
 * rows fields: SCEDTimestamp, settlementPoint, LMP
 */
export function buildPricePoints(
  rows: AnyRow[],
  headlineSettlementPoint: string
): Array<{ ts: string; value: number }> {
  // group by timestamp
  const byTs = new Map<string, AnyRow[]>();
  for (const r of rows) {
    const tsRaw = r.SCEDTimestamp ?? r.scedTimestamp ?? r.timestamp;
    const sp = r.settlementPoint ?? r.settlement_point ?? r.settlementPointName;
    const lmp = toNumber(r.LMP ?? r.lmp ?? r.price);

    if (!tsRaw || !sp || lmp === null) continue;

    const ts = normalizeTs(String(tsRaw), isRepeatHour(r));
    if (!ts) continue;
    const arr = byTs.get(ts) ?? [];
    arr.push({ ts, settlementPoint: String(sp), LMP: lmp });
    byTs.set(ts, arr);
  }

  const points: Array<{ ts: string; value: number }> = [];

  for (const [ts, arr] of byTs.entries()) {
    // 1) exact headline match
    const exact = arr.find((x) => x.settlementPoint === headlineSettlementPoint);
    if (exact) {
      points.push({ ts, value: exact.LMP });
      continue;
    }

    // 2) otherwise prefer hubs (HB_*)
    const hubs = arr.filter((x) => String(x.settlementPoint).startsWith("HB_"));
    if (hubs.length) {
      const avg = hubs.reduce((s, x) => s + x.LMP, 0) / Math.max(1, hubs.length);
      points.push({ ts, value: avg });
      continue;
    }

    // 3) fallback: average everything
    const avg = arr.reduce((s, x) => s + x.LMP, 0) / Math.max(1, arr.length);
    points.push({ ts, value: avg });
  }

  points.sort((a, b) => a.ts.localeCompare(b.ts));
  return points;
}

/**
 * Build FUEL MIX points using fields present in your dataset:
 * - wind: sumBasePointWGR
 * - solar: sumBasePointPVGR
 * - other renewables: sumBasePointREMRES (best-effort)
 * - "everything else": sumBasePointNonIRR (we treat as thermal bucket for now)
 * - batteries/other: sumBasePointESRDischarge (optional)
 */
export function buildFuelMixPoints(rows: AnyRow[]): Array<{
  ts: string;
  wind: number;
  solar: number;
  otherRenew: number;
  thermal: number;
  storageDischarge: number;
  storageCharge: number;
}> {
  const byTs = new Map<
    string,
    { w: number; s: number; r: number; n: number; sd: number; sc: number }
  >();

  for (const r of rows) {
    const tsRaw = r.SCEDTimestamp ?? r.scedTimestamp ?? r.timestamp;
    if (!tsRaw) continue;

    const ts = normalizeTs(String(tsRaw), isRepeatHour(r));
    if (!ts) continue;

    const wind = toNumber(r.sumBasePointWGR) ?? 0;
    const solar = toNumber(r.sumBasePointPVGR) ?? 0;
    const remres = toNumber(r.sumBasePointREMRES) ?? 0;
    const nonIrr = toNumber(r.sumBasePointNonIRR) ?? 0;

    // Batteries can be represented as charge/discharge. Keep both and clamp >= 0.
    const esrDischarge = toNumber(r.sumBasePointESRDischarge) ?? 0;
    const esrCharge = toNumber(r.sumBasePointESRCharge) ?? 0;

    const cur = byTs.get(ts) ?? { w: 0, s: 0, r: 0, n: 0, sd: 0, sc: 0 };
    cur.w += wind;
    cur.s += solar;
    cur.r += remres;
    cur.n += nonIrr;
    cur.sd += Math.max(0, esrDischarge);
    cur.sc += Math.max(0, esrCharge);
    byTs.set(ts, cur);
  }

  const points: Array<{
    ts: string;
    wind: number;
    solar: number;
    otherRenew: number;
    thermal: number;
    storageDischarge: number;
    storageCharge: number;
  }> = [];

  for (const [ts, v] of byTs.entries()) {
    points.push({
      ts,
      wind: Math.max(0, v.w),
      solar: Math.max(0, v.s),
      otherRenew: Math.max(0, v.r),
      thermal: Math.max(0, v.n),
      storageDischarge: Math.max(0, v.sd),
      storageCharge: Math.max(0, v.sc)
    });
  }

  points.sort((a, b) => a.ts.localeCompare(b.ts));
  return points;
}

/**
 * Build OUTAGE points from NP3-233-CD (Hourly Resource Outage Capacity).
 *
 * Every hourly posting repeats the whole outlook (today through ~7 days ahead),
 * so the same target hour appears in many postings. For each target hour we keep
 * the row from the most recent postedDatetime. The result spans past AND future
 * hours; use splitOutagesAtNow() to separate them.
 */
export function buildOutagePoints(rows: AnyRow[]): OutagePointOut[] {
  const best = new Map<string, { posted: string; point: OutagePointOut }>();

  for (const r of rows) {
    const operatingDate = r.operatingDate ?? r.operatingDay ?? r.operating_date;
    const he = r.hourEnding ?? r.hour_ending ?? r.hourEndingInt;
    // No repeat-hour flag in this dataset: first occurrence is used.
    const ts = hourEndingToUtcIso(String(operatingDate ?? ""), he);
    if (!ts) continue;

    const posted = String(r.postedDatetime ?? "");
    const prev = best.get(ts);
    if (prev && prev.posted >= posted) continue;

    const zSouth = toNumber(r.totalResourceMWZoneSouth) ?? 0;
    const zNorth = toNumber(r.totalResourceMWZoneNorth) ?? 0;
    const zWest = toNumber(r.totalResourceMWZoneWest) ?? 0;
    const zHouston = toNumber(r.totalResourceMWZoneHouston) ?? 0;
    const totalResourceMW = zSouth + zNorth + zWest + zHouston;

    const irrSouth = toNumber(r.totalIRRMWZoneSouth) ?? 0;
    const irrNorth = toNumber(r.totalIRRMWZoneNorth) ?? 0;
    const irrWest = toNumber(r.totalIRRMWZoneWest) ?? 0;
    const irrHouston = toNumber(r.totalIRRMWZoneHouston) ?? 0;
    const totalIRRMW = irrSouth + irrNorth + irrWest + irrHouston;

    const neSouth = toNumber(r.totalNewEquipResourceMWZoneSouth) ?? 0;
    const neNorth = toNumber(r.totalNewEquipResourceMWZoneNorth) ?? 0;
    const neWest = toNumber(r.totalNewEquipResourceMWZoneWest) ?? 0;
    const neHouston = toNumber(r.totalNewEquipResourceMWZoneHouston) ?? 0;
    const totalNewEquipResourceMW = neSouth + neNorth + neWest + neHouston;

    best.set(ts, {
      posted,
      point: {
        ts,
        totalResourceMW,
        totalIRRMW,
        totalNewEquipResourceMW,
        zones: { south: zSouth, north: zNorth, west: zWest, houston: zHouston }
      }
    });
  }

  return [...best.values()].map((b) => b.point).sort((a, b) => a.ts.localeCompare(b.ts));
}

type OutagePointOut = {
  ts: string;
  totalResourceMW: number;
  totalIRRMW: number;
  totalNewEquipResourceMW: number;
  zones?: { south: number; north: number; west: number; houston: number };
};

/**
 * Split hour-ending points into past/current vs future.
 * An hour-ending point `ts` covers [ts-1h, ts). The hour in progress
 * (ts-1h <= now < ts) counts as "current", so it lands in `past`.
 */
export function splitAtNow<T extends { ts: string }>(
  points: T[],
  nowMs: number
): { past: T[]; future: T[] } {
  const past: T[] = [];
  const future: T[] = [];
  for (const p of points) {
    const t = Date.parse(p.ts);
    if (!Number.isFinite(t)) continue;
    (t - 60 * 60 * 1000 <= nowMs ? past : future).push(p);
  }
  return { past, future };
}

/**
 * Build SUPPLY vs DEMAND points using 2D Agg Gen Summary (NP3-910-ER)
 * and align to the most recent LOAD point at-or-before each SCED timestamp.
 *
 * Available capability = sum of HASL (High Ancillary Service Limit) across
 * NonIRR + WGR + PVGR + REMRES. ERCOT currently publishes these as null in
 * this report. We NEVER substitute generation or base point for capacity
 * (that makes headroom = generation - load, which is meaningless), so when
 * HASL is missing, availHASLMW / headroomMW / headroomPct are null and
 * `haslAvailable` is false.
 */
export function buildSupplyDemandPoints(
  fuelRows: AnyRow[],
  loadPoints: Array<{ ts: string; value: number }>
): {
  haslAvailable: boolean;
  points: Array<{
    ts: string;
    demandMW: number | null;
    genTelemMW: number | null;
    availHASLMW: number | null;
    headroomMW: number | null;
    headroomPct: number | null;
  }>;
} {
  // Both sides are real UTC ISO strings here, so compare as epoch ms.
  const lp = loadPoints
    .map((p) => ({ t: Date.parse(p.ts), value: p.value }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);

  // Binary search: independent of row order (the API returns SCED rows newest-first).
  function demandAtOrBefore(ts: string): number | null {
    const t = Date.parse(ts);
    let lo = 0;
    let hi = lp.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lp[mid].t <= t) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found >= 0 ? lp[found].value : null;
  }

  const out: Array<{
    ts: string;
    demandMW: number | null;
    genTelemMW: number | null;
    availHASLMW: number | null;
    headroomMW: number | null;
    headroomPct: number | null;
  }> = [];

  let haslAvailable = false;

  for (const r of fuelRows) {
    const tsRaw = r.SCEDTimestamp ?? r.scedTimestamp ?? r.timestamp;
    if (!tsRaw) continue;
    const ts = normalizeTs(String(tsRaw), isRepeatHour(r));
    if (!ts) continue;

    const demandMW = demandAtOrBefore(ts);

    const genTelemMW = toNumber(r.sumGenTelemMW);

    const haslParts = [
      toNumber(r.sumHASLNonIRR),
      toNumber(r.sumHASLWGR),
      toNumber(r.sumHASLPVGR),
      toNumber(r.sumHASLREMRES)
    ];
    // Only trust a row when every component is present; a partial sum would
    // understate capacity and raise false alarms.
    const availHASLMW = haslParts.every((v) => v != null)
      ? haslParts.reduce<number>((s, v) => s + (v as number), 0)
      : null;
    if (availHASLMW != null) haslAvailable = true;

    const headroomMW = demandMW == null || availHASLMW == null ? null : availHASLMW - demandMW;
    const headroomPct =
      headroomMW == null || availHASLMW == null || availHASLMW <= 0
        ? null
        : (headroomMW / availHASLMW) * 100;

    out.push({
      ts,
      demandMW,
      genTelemMW: genTelemMW == null ? null : genTelemMW,
      availHASLMW,
      headroomMW,
      headroomPct
    });
  }

  out.sort((a, b) => a.ts.localeCompare(b.ts));
  // Dedupe by ts
  const dedup: typeof out = [];
  for (const p of out) {
    if (!dedup.length || dedup[dedup.length - 1].ts !== p.ts) dedup.push(p);
    else dedup[dedup.length - 1] = p;
  }
  return { haslAvailable, points: dedup };
}

/**
 * Build FORECAST points from NP3-565-CD (Seven-Day Load Forecast by Model and Weather Zone).
 * - Only rows with inUseFlag === true (the model ERCOT is actually using).
 * - ts = deliveryDate + hourEnding (hour-ending instant, UTC); value = systemTotal.
 * - For each delivery hour, keep the most recent posting.
 * Points extend into the future.
 */
export function buildForecastPoints(rows: AnyRow[]): Array<{ ts: string; value: number }> {
  const best = new Map<string, { posted: string; value: number }>();

  for (const r of rows) {
    if (r.inUseFlag !== true) continue;

    const value = toNumber(r.systemTotal);
    if (value === null) continue;

    const ts = hourEndingToUtcIso(String(r.deliveryDate ?? ""), r.hourEnding, {
      isRepeatHour: isRepeatHour(r)
    });
    if (!ts) continue;

    const posted = String(r.postedDatetime ?? "");
    const prev = best.get(ts);
    if (prev && prev.posted >= posted) continue;
    best.set(ts, { posted, value });
  }

  return [...best.entries()]
    .map(([ts, b]) => ({ ts, value: b.value }))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}

/**
 * Build LAMBDA points: {ts,value} from cappedSystemLambda (NP6-322-CD).
 */
export function buildLambdaPoints(rows: AnyRow[]): Array<{ ts: string; value: number }> {
  const points: Array<{ ts: string; value: number }> = [];

  for (const r of rows) {
    const tsRaw = r.SCEDTimestamp ?? r.scedTimestamp ?? r.timestamp;
    const lam = toNumber(
      r.cappedSystemLambda ?? r.uncappedSystemLambda ?? r.systemLambda ?? r.lambda ?? r.SystemLambda
    );
    if (!tsRaw || lam === null) continue;

    const ts = normalizeTs(String(tsRaw), isRepeatHour(r));
    if (!ts) continue;
    points.push({ ts, value: lam });
  }

  points.sort((a, b) => a.ts.localeCompare(b.ts));
  return points;
}
