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

// Some ERCOT timestamps look like "2026-01-24T18:45:17" (no timezone).
// Treat as UTC for consistency by appending "Z" when no timezone is present.
function normalizeTs(ts: string): string {
  if (!ts) return ts;
  // already ISO with Z or offset
  if (/[zZ]$/.test(ts) || /[+-]\d{2}:\d{2}$/.test(ts)) return ts;
  // looks like YYYY-MM-DDTHH:mm:ss
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(ts)) return `${ts}Z`;
  return ts;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Load endpoint gives operatingDay + hourEnding like "01:00".
// We'll map to a timestamp at that hour (UTC) as "YYYY-MM-DDTHH:00:00Z".
function operatingDayHourToTs(operatingDay: string, hourEnding: string): string {
  // hourEnding expected "HH:00"
  const hh = hourEnding?.slice(0, 2);
  if (!operatingDay || !hh) return "";
  return `${operatingDay}T${hh}:00:00Z`;
}

function operatingDateHourEndingIntToTs(operatingDate: string, hourEndingInt: any): string {
  const he = Number(hourEndingInt);
  if (!operatingDate || !Number.isFinite(he) || he < 1 || he > 24) return "";
  if (he === 24) {
    // 24:00 -> 00:00 next day
    const nextDay = addDays(operatingDate, 1);
    return `${nextDay}T00:00:00Z`;
  }
  return `${operatingDate}T${pad2(he)}:00:00Z`;
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
      // IMPORTANT: match ERCOT field order for NP3-910-ER (2D Agg Gen Summary)
      // (2nd col is repeatHourFlag, NOT postedDatetime)
      const fallbackFields = [
        "SCEDTimestamp",
        "repeatHourFlag",
        "sumBasePointNonIRR",
        "sumBasePointWGR",
        "sumBasePointPVGR",
        "sumBasePointREMRES",
        "sumBasePointTotal",
        "sumBasePointESRCharge",
        "sumBasePointESRDischarge",
        "sumBasePointESRNet",
        "sumHASLNonIRR",
        "sumHASLWGR",
        "sumHASLPVGR",
        "sumHASLREMRES",
        "sumHASLTotal",
        "sumGenTelemMW",
        "sumAuxLoadTelemMW",
        "sumAncServiceTelemMW",
        "sumNetGenTelemMW"
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
 */
export function buildLoadPoints(rows: AnyRow[]): Array<{ ts: string; value: number }> {
  const points: Array<{ ts: string; value: number }> = [];

  for (const r of rows) {
    const operatingDay = r.operatingDay;
    const hourEnding = r.hourEnding;
    const total = toNumber(r.total);

    if (!operatingDay || !hourEnding || total === null) continue;

    const ts = operatingDayHourToTs(String(operatingDay), String(hourEnding));
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

    const ts = normalizeTs(String(tsRaw));
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

    const ts = normalizeTs(String(tsRaw));

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
 * Build OUTAGE points (best-effort).
 * We try common zone-based fields.
 */
export function buildOutagePoints(rows: AnyRow[]): Array<{
  ts: string;
  totalResourceMW: number;
  totalIRRMW: number;
  totalNewEquipResourceMW: number;
  zones?: { south: number; north: number; west: number; houston: number };
}> {
  const points: Array<{
    ts: string;
    totalResourceMW: number;
    totalIRRMW: number;
    totalNewEquipResourceMW: number;
    zones?: { south: number; north: number; west: number; houston: number };
  }> = [];

  for (const r of rows) {
    const operatingDate = r.operatingDate ?? r.operatingDay ?? r.operating_date;
    const he = r.hourEnding ?? r.hour_ending ?? r.hourEndingInt;
    const ts = operatingDateHourEndingIntToTs(String(operatingDate ?? ""), he);
    if (!ts) continue;

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

    points.push({
      ts,
      totalResourceMW,
      totalIRRMW,
      totalNewEquipResourceMW,
      zones: { south: zSouth, north: zNorth, west: zWest, houston: zHouston }
    });
  }

  points.sort((a, b) => a.ts.localeCompare(b.ts));
  // Dedupe by ts (keep last)
  const out: typeof points = [];
  for (const p of points) {
    if (!out.length || out[out.length - 1].ts !== p.ts) out.push(p);
    else out[out.length - 1] = p;
  }
  return out;
}

/**
 * Build SUPPLY vs DEMAND points using 2D Agg Gen Summary (NP3-910-ER)
 * and align to the most recent LOAD point at-or-before each SCED timestamp.
 */
export function buildSupplyDemandPoints(
  fuelRows: AnyRow[],
  loadPoints: Array<{ ts: string; value: number }>
): Array<{
  ts: string;
  demandMW: number | null;
  genTelemMW: number | null;
  availHASLMW: number | null;
  headroomMW: number | null;
  headroomPct: number | null;
}> {
  const lp = [...loadPoints].sort((a, b) => a.ts.localeCompare(b.ts));
  let li = 0;

  function demandAtOrBefore(ts: string): number | null {
    if (!lp.length) return null;
    while (li + 1 < lp.length && lp[li + 1].ts <= ts) li++;
    return lp[li].ts <= ts ? lp[li].value : null;
  }

  const out: Array<{
    ts: string;
    demandMW: number | null;
    genTelemMW: number | null;
    availHASLMW: number | null;
    headroomMW: number | null;
    headroomPct: number | null;
  }> = [];

  for (const r of fuelRows) {
    const tsRaw = r.SCEDTimestamp ?? r.scedTimestamp ?? r.timestamp;
    if (!tsRaw) continue;
    const ts = normalizeTs(String(tsRaw));

    const demandMW = demandAtOrBefore(ts);

    const genTelemMW = toNumber(r.sumGenTelemMW);

    // Prefer explicit sumHASLTotal when available (some payloads provide it directly)
    const haslTotalDirect = toNumber(r.sumHASLTotal);

    // Or sum components when present
    const haslNon = toNumber(r.sumHASLNonIRR);
    const haslW = toNumber(r.sumHASLWGR);
    const haslS = toNumber(r.sumHASLPVGR);
    const haslR = toNumber(r.sumHASLREMRES);

    const hasAnyHasl = [haslNon, haslW, haslS, haslR].some((v) => v != null);
    const haslTotalFromParts = hasAnyHasl
      ? (haslNon ?? 0) + (haslW ?? 0) + (haslS ?? 0) + (haslR ?? 0)
      : null;

    const haslTotal = haslTotalDirect ?? haslTotalFromParts;

    // Fallback availability proxy (in order of preference):
    // 1) sumBasePointTotal (scheduled generation)
    // 2) sumNetGenTelemMW (telemetry)
    // 3) sumGenTelemMW
    const basePointTotal = toNumber(r.sumBasePointTotal);
    const netGenTelemMW = toNumber(r.sumNetGenTelemMW);

    const availProxyMW =
      basePointTotal ??
      (netGenTelemMW == null ? null : netGenTelemMW) ??
      (genTelemMW == null ? null : genTelemMW);

    const availHASLMW = haslTotal ?? availProxyMW;

    const headroomMW = demandMW == null || availHASLMW == null ? null : availHASLMW - demandMW;
    const headroomPct =
      headroomMW == null || availHASLMW == null || availHASLMW <= 0
        ? null
        : (headroomMW / availHASLMW) * 100;

    out.push({
      ts,
      demandMW,
      genTelemMW: genTelemMW == null ? null : genTelemMW,
      availHASLMW: availHASLMW == null || !Number.isFinite(availHASLMW) ? null : availHASLMW,
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
  return dedup;
}

/**
 * Build FORECAST points (best-effort).
 * This endpoint’s schema varies; we try to locate:
 * - a timestamp field
 * - a value field (load/forecast)
 */
export function buildForecastPoints(rows: AnyRow[]): Array<{ ts: string; value: number }> {
  const tsCandidates = [
    "forecastTimestamp",
    "timestamp",
    "intervalEnding",
    "SCEDTimestamp",
    "postedDatetime",
    "postedDateTime"
  ];
  const valCandidates = ["forecast", "loadForecast", "mw", "MW", "value", "systemTotal", "total"];

  const points: Array<{ ts: string; value: number }> = [];

  for (const r of rows) {
    let tsRaw: any = null;
    for (const f of tsCandidates) {
      if (r[f] != null) {
        tsRaw = r[f];
        break;
      }
    }
    if (!tsRaw) continue;

    let valRaw: any = null;
    for (const f of valCandidates) {
      if (r[f] != null) {
        valRaw = r[f];
        break;
      }
    }
    const v = toNumber(valRaw);
    if (v === null) continue;

    const ts = normalizeTs(String(tsRaw));
    points.push({ ts, value: v });
  }

  points.sort((a, b) => a.ts.localeCompare(b.ts));
  return points;
}

/**
 * Build LAMBDA points: {ts,value} from systemLambda
 */
export function buildLambdaPoints(rows: AnyRow[]): Array<{ ts: string; value: number }> {
  const points: Array<{ ts: string; value: number }> = [];

  for (const r of rows) {
    const tsRaw = r.SCEDTimestamp ?? r.scedTimestamp ?? r.timestamp;
    const lam = toNumber(r.systemLambda ?? r.lambda ?? r.SystemLambda);
    if (!tsRaw || lam === null) continue;

    points.push({ ts: normalizeTs(String(tsRaw)), value: lam });
  }

  points.sort((a, b) => a.ts.localeCompare(b.ts));
  return points;
}
