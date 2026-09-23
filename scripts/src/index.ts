import path from "node:path";
import { CONFIG } from "./config.js";
import { getIdToken } from "./ercotAuth.js";
import { ErcotClient } from "./ercotClient.js";
import {
  ensureDir,
  nowStampForHistoryDir,
  pruneOldHistory,
  readJsonIfExists,
  writeJson,
  withinWindow,
  mergeUniqueByTs,
  safeObject
} from "./io.js";
import {
  extractRows,
  buildFuelMixPoints,
  buildLambdaPoints,
  buildLoadPoints,
  buildOutagePoints,
  buildPricePoints,
  buildSupplyDemandPoints,
  buildForecastPoints,
  splitAtNow
} from "./normalize.js";
import { computeGridStress } from "./gridStress.js";
import { marketDate, marketDateTimeParam } from "./time.js";
import type {
  FuelMix7d,
  Load7d,
  Outages7d,
  Price7d,
  Forecast7d,
  SupplyDemand2d,
  GridStressLatest
} from "./types.js";

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/**
 * Read an existing frontend file only if it was written with the current schema.
 * Older files (e.g. v1 with Central times mislabeled as UTC) are ignored so their
 * points never mix with corrected ones; the fetch window rebuilds them.
 */
function readVersioned<T extends { meta?: unknown }>(p: string): T | null {
  const existing = readJsonIfExists<T>(p);
  const version = (existing?.meta as { schemaVersion?: unknown } | undefined)?.schemaVersion;
  if (existing && version !== CONFIG.schemaVersion) {
    console.log(`[MIGRATE] Ignoring ${path.basename(p)} (schemaVersion ${String(version)} != ${CONFIG.schemaVersion}).`);
    return null;
  }
  return existing;
}

async function main() {
  const username = mustEnv("ERCOT_USERNAME");
  const password = mustEnv("ERCOT_PASSWORD");
  const subscriptionKey = mustEnv("ERCOT_SUBSCRIPTION_KEY");

  const now = new Date();
  const nowIso = now.toISOString();

  const cutoffIso = new Date(
    now.getTime() - CONFIG.historyDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const cutoff = cutoffIso; // internal storage uses ISO UTC

  // Paths
  const cwd = process.cwd();
  const repoRoot = cwd.endsWith(`${path.sep}scripts`) ? path.resolve(cwd, "..") : cwd;
  const dataLatestDir = path.join(repoRoot, "data", "latest");
  const dataHistoryDir = path.join(repoRoot, "data", "history");
  const publicDataDir = path.join(repoRoot, "site", "public", "data");

  ensureDir(dataLatestDir);
  ensureDir(dataHistoryDir);
  ensureDir(publicDataDir);

  // Auth
  const idToken = await getIdToken({ username, password });
  const client = new ErcotClient(idToken, subscriptionKey);

  // Time window formats. ERCOT query params are Central time (no zone suffix),
  // so build them from Central dates/times, not UTC.
  const cutoffDate = new Date(cutoffIso);
  const dateFrom = marketDate(cutoffDate); // YYYY-MM-DD (Central)
  const dateTo = marketDate(now);          // YYYY-MM-DD (Central)

  const dtFrom = marketDateTimeParam(cutoffDate); // yyyy-MM-ddTHH:mm:ss (Central)
  const dtTo = marketDateTimeParam(now);          // yyyy-MM-ddTHH:mm:ss (Central)

  // Load forecast: only recent postings; each posting already covers ~7 days ahead.
  const forecastPostedFrom = marketDateTimeParam(
    new Date(now.getTime() - CONFIG.forecastPostedLookbackHours * 60 * 60 * 1000)
  );

  // 2d_agg_gen_summary can lag by days. Fetch a wider window.
  // We'll later trim to "last 2 days of AVAILABLE data".
  const scedLagHours = 6;              // avoid querying right up to "now"
  const scedLookbackHours = 24 * 7;    // fetch up to 7 days

  const scedToDate = new Date(now.getTime() - scedLagHours * 60 * 60 * 1000);
  const scedFromDate = new Date(scedToDate.getTime() - scedLookbackHours * 60 * 60 * 1000);

  const scedFrom = marketDateTimeParam(scedFromDate);
  const scedTo = marketDateTimeParam(scedToDate);


  const QUERY_BY_KEY: Record<string, Record<string, string>> = {
    act_sys_load_by_fzn: {
      operatingDayFrom: dateFrom,
      operatingDayTo: dateTo
    },
    lf_by_model_weather_zone: {
      postedDatetimeFrom: forecastPostedFrom,
      postedDatetimeTo: dtTo,
      inUseFlag: "true"
    },
    hourly_res_outage_cap: {
      postedDatetimeFrom: dtFrom,
      postedDatetimeTo: dtTo
    },

    // SCED-based endpoints: lock window using SCEDTimestampFrom/To.
    // Only 2d_agg_gen_summary lags; prices and lambda are real-time, so query up to now.
    "2d_agg_gen_summary": {
      SCEDTimestampFrom: scedFrom,
      SCEDTimestampTo: scedTo
    },
    lmp_node_zone_hub: {
      SCEDTimestampFrom: dtFrom,
      SCEDTimestampTo: dtTo,
      // Server-side filter: without it every SCED run returns ~1,000 settlement points.
      settlementPoint: CONFIG.headlineSettlementPoint
    },
    sced_system_lambda: {
      SCEDTimestampFrom: dtFrom,
      SCEDTimestampTo: dtTo
    }
  };


  // Fetch all endpoints with resilience (one failure shouldn't break whole run)
  const results: Record<string, unknown> = {};
  const usedQueryByKey: Record<string, Record<string, string>> = {};

  async function fetchOne(key: string, endpoint: string) {
    const query = QUERY_BY_KEY[key] ?? {};

    try {
      const pages = await client.fetchAllPages(endpoint, query);
      results[key] = pages;
      usedQueryByKey[key] = query;

      const latest = pages.length ? pages[pages.length - 1] : {};
      writeJson(path.join(dataLatestDir, `${key}.json`), latest);

      console.log(
        `[OK] ${key} using params: ${
          Object.keys(query).length ? Object.keys(query).join(", ") : "(none)"
        }`
      );

      return pages;
    } catch (e) {
      console.error(`[WARN] ${key} failed:`, e);
      return null;
    }
  }

  // Fetch endpoints
  const pagesLoad = await fetchOne("act_sys_load_by_fzn", CONFIG.endpoints.actualLoad);
  const pagesForecast = await fetchOne("lf_by_model_weather_zone", CONFIG.endpoints.forecast);
  const pagesOutages = await fetchOne("hourly_res_outage_cap", CONFIG.endpoints.outages);
  const pagesFuel = await fetchOne("2d_agg_gen_summary", CONFIG.endpoints.fuelMix);
  const pagesPrice = await fetchOne("lmp_node_zone_hub", CONFIG.endpoints.prices);

  const pagesLambda =
    CONFIG.includeSystemLambda
      ? await fetchOne("sced_system_lambda", CONFIG.endpoints.systemLambda)
      : null;

  // History marker
  const stamp = nowStampForHistoryDir(now);
  const historyDirForDay = path.join(dataHistoryDir, stamp.day);
  ensureDir(historyDirForDay);
  writeJson(path.join(historyDirForDay, `${stamp.hm}.json`), {
    ts: nowIso,
    okKeys: Object.keys(results),
    usedQueryByKey,
    includeSystemLambda: CONFIG.includeSystemLambda
  });

  // Prune old raw history
  pruneOldHistory(dataHistoryDir, cutoff);

  // Merge + normalize for frontend
  const existingLoad = readVersioned<Load7d>(path.join(publicDataDir, "load_7d.json"));
  const existingPrice = readVersioned<Price7d>(path.join(publicDataDir, "price_7d.json"));
  const existingFuel = readVersioned<FuelMix7d>(path.join(publicDataDir, "fuelmix_7d.json"));
  const existingOutages = readVersioned<Outages7d>(path.join(publicDataDir, "outages_7d.json"));
  const existingForecast = readVersioned<Forecast7d>(path.join(publicDataDir, "forecast_7d.json"));
  const existingSupply = readVersioned<SupplyDemand2d>(path.join(publicDataDir, "supplydemand_2d.json"));

  const loadRows = pagesLoad ? pagesLoad.flatMap((p) => extractRows(p as any)) : [];
  const forecastRows = pagesForecast ? pagesForecast.flatMap((p) => extractRows(p as any)) : [];
  const outageRows = pagesOutages ? pagesOutages.flatMap((p) => extractRows(p as any)) : [];
  const fuelRows = pagesFuel ? pagesFuel.flatMap((p) => extractRows(p as any)) : [];
  const priceRows = pagesPrice ? pagesPrice.flatMap((p) => extractRows(p as any)) : [];
  const lambdaRows = pagesLambda ? pagesLambda.flatMap((p) => extractRows(p as any)) : [];

  const newLoadPoints = withinWindow(buildLoadPoints(loadRows), cutoff);
  const newForecastPoints = withinWindow(buildForecastPoints(forecastRows), cutoff);
  // Outage postings include projections up to ~7 days ahead. Split at "now":
  // past/current hours are history (merged), future hours are the upcoming outlook (replaced each run).
  const outageSplit = splitAtNow(buildOutagePoints(outageRows), now.getTime());
  const newOutagePoints = withinWindow(outageSplit.past, cutoff);
  const upcomingOutagePoints = outageSplit.future;
  const newFuelPoints = withinWindow(buildFuelMixPoints(fuelRows), cutoff);
  const newPricePoints = withinWindow(
    buildPricePoints(priceRows, CONFIG.headlineSettlementPoint),
    cutoff
  );
  const newLambdaPoints = withinWindow(buildLambdaPoints(lambdaRows), cutoff);

  const mergedLoad = withinWindow(
    mergeUniqueByTs(existingLoad?.points ?? [], newLoadPoints),
    cutoff
  );
  const mergedPrice = withinWindow(
    mergeUniqueByTs(existingPrice?.points ?? [], newPricePoints),
    cutoff
  );
  const mergedFuel = withinWindow(
    mergeUniqueByTs(existingFuel?.points ?? [], newFuelPoints),
    cutoff
  );
  const mergedOutages = withinWindow(
    mergeUniqueByTs(existingOutages?.points ?? [], newOutagePoints),
    cutoff
  );

  // Supply-vs-demand is only 2-day and derived from fuel rows aligned with demand.
  const { points: supplyNew, haslAvailable } = buildSupplyDemandPoints(fuelRows, mergedLoad);

  // IMPORTANT: trim relative to latest AVAILABLE SCED timestamp (ERCOT can lag days).
  const latestSupplyTs = supplyNew.length ? supplyNew[supplyNew.length - 1].ts : null;

  const supplyCutoff = latestSupplyTs
    ? new Date(Date.parse(latestSupplyTs) - 2 * 24 * 60 * 60 * 1000).toISOString()
    : new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

  const supplyNewWindow = withinWindow(supplyNew, supplyCutoff);

  const mergedSupply = withinWindow(
    mergeUniqueByTs(existingSupply?.points ?? [], supplyNewWindow),
    supplyCutoff
  );
  // Headroom is only meaningful when real capacity (HASL) exists in the data we're showing.
  const headroomAvailable = haslAvailable || mergedSupply.some((p) => p.availHASLMW != null);

  const mergedForecast = withinWindow(
    mergeUniqueByTs(existingForecast?.points ?? [], newForecastPoints),
    cutoff
  );

  const load7d: Load7d = {
    meta: {
      schemaVersion: CONFIG.schemaVersion,
      updatedAt: nowIso,
      windowDays: CONFIG.historyDays,
      source: "ERCOT Public Data API",
      endpoint: CONFIG.endpoints.actualLoad,
      queryUsed: usedQueryByKey["act_sys_load_by_fzn"] ?? {},
      notes: "System load (total MW) per hour. ts is the hour-ending time in UTC (ERCOT Central-time hour ending converted, HE24 = next day 00:00 Central)."
    },
    points: mergedLoad
  };

  const forecast7d: Forecast7d = {
    meta: {
      schemaVersion: CONFIG.schemaVersion,
      updatedAt: nowIso,
      windowDays: CONFIG.historyDays,
      source: "ERCOT Public Data API",
      endpoint: CONFIG.endpoints.forecast,
      queryUsed: usedQueryByKey["lf_by_model_weather_zone"] ?? {},
      notes:
        "ERCOT system-wide load forecast (systemTotal) from the in-use model only. ts is the hour-ending time in UTC; for each hour the most recent posting wins. Points extend into the future."
    },
    points: mergedForecast
  };

  const price7d: Price7d = {
    meta: {
      schemaVersion: CONFIG.schemaVersion,
      updatedAt: nowIso,
      windowDays: CONFIG.historyDays,
      source: "ERCOT Public Data API",
      endpoint: CONFIG.endpoints.prices,
      queryUsed: usedQueryByKey["lmp_node_zone_hub"] ?? {},
      headlineSettlementPoint: CONFIG.headlineSettlementPoint,
      notes:
        "Price series is the selected settlement point (default HB_NORTH), filtered server-side. If not present, we fall back to averaging available hub rows per timestamp."
    },
    points: mergedPrice
  };

  const fuelmix7d: FuelMix7d = {
    meta: {
      schemaVersion: CONFIG.schemaVersion,
      updatedAt: nowIso,
      windowDays: CONFIG.historyDays,
      source: "ERCOT Public Data API",
      endpoint: CONFIG.endpoints.fuelMix,
      queryUsed: usedQueryByKey["2d_agg_gen_summary"] ?? {},
      renewablesDefinition: "wind + solar + hydro + other renewables (best-effort key matching)",
      thermalDefinition: "gas + coal + nuclear + other thermal (best-effort key matching)"
    },
    points: mergedFuel
  };

  const outages7d: Outages7d = {
    meta: {
      schemaVersion: CONFIG.schemaVersion,
      updatedAt: nowIso,
      windowDays: CONFIG.historyDays,
      source: "ERCOT Public Data API",
      endpoint: CONFIG.endpoints.outages,
      queryUsed: usedQueryByKey["hourly_res_outage_cap"] ?? {},
      notes:
        "Outages are aggregated from NP3-233-CD by load zone and split into Total, IRR, and New Equipment capability outages. For each hour the most recent posting wins. `points` are past hours plus the hour in progress; `upcomingPoints` are ERCOT's scheduled outlook for future hours."
    },
    points: mergedOutages,
    upcomingPoints: upcomingOutagePoints
  };

  const supplyDemand2d: SupplyDemand2d = {
    meta: {
      schemaVersion: CONFIG.schemaVersion,
      updatedAt: nowIso,
      windowDays: 2,
      source: "ERCOT Public Data API",
      endpoint: CONFIG.endpoints.fuelMix,
      queryUsed: usedQueryByKey["2d_agg_gen_summary"] ?? {},
      headroomAvailable,
      headroomNote: headroomAvailable
        ? "Available capability is the total HASL (High Ancillary Service Limit) across NonIRR+WGR+PVGR+REMRES from the 2-Day Aggregated Generation Summary."
        : "ERCOT isn't currently publishing available-capacity (HASL) values in the 2-Day Aggregated Generation Summary; every HASL field is empty. Headroom is left blank rather than estimated from generation.",
      notes:
        "Demand aligns to the most recent hourly system load reading at-or-before each SCED timestamp (both in UTC). This report lags real time by about 2 days."
    },
    points: mergedSupply
  };

  // For stress classification, use total outaged capability as a simple scalar.
  const outagesForStress = mergedOutages.map((p) => ({ ts: p.ts, value: p.totalResourceMW }));

  const latestSupply = mergedSupply.length
    ? mergedSupply[mergedSupply.length - 1]
    : null;

  const latestHeadroomPct = headroomAvailable ? latestSupply?.headroomPct ?? null : null;

  const gridstress: GridStressLatest = computeGridStress({
    nowIso,
    pricePoints: mergedPrice,
    loadPoints: mergedLoad,
    outagePoints: outagesForStress,
    lambdaPoints: CONFIG.includeSystemLambda ? newLambdaPoints : [],
    headroomPct: latestHeadroomPct
  });

  // Add extra context used by the UI (bands/tiles).
  gridstress.meta = { schemaVersion: CONFIG.schemaVersion };
  gridstress.headroomAvailable = headroomAvailable;
  gridstress.latestHeadroomMW = headroomAvailable ? latestSupply?.headroomMW ?? null : null;
  gridstress.latestHeadroomPct = latestHeadroomPct;
  // Demand from the hourly load series (supply-vs-demand lags ~2 days).
  gridstress.latestDemandMW = mergedLoad.length ? mergedLoad[mergedLoad.length - 1].value : null;
  // Last past/current point = the hour in progress, never a future projection.
  const latestOutage = outagesForStress.length ? outagesForStress[outagesForStress.length - 1] : null;
  gridstress.latestOutagesMW = latestOutage?.value ?? null;
  gridstress.latestOutagesTs = latestOutage?.ts ?? null;
  gridstress.latestPrice = mergedPrice.length ? mergedPrice[mergedPrice.length - 1].value : null;

  // Write frontend JSON
  writeJson(path.join(publicDataDir, "load_7d.json"), load7d);
  writeJson(path.join(publicDataDir, "forecast_7d.json"), forecast7d);
  writeJson(path.join(publicDataDir, "price_7d.json"), price7d);
  writeJson(path.join(publicDataDir, "fuelmix_7d.json"), fuelmix7d);
  writeJson(path.join(publicDataDir, "outages_7d.json"), outages7d);
  writeJson(path.join(publicDataDir, "supplydemand_2d.json"), supplyDemand2d);
  writeJson(path.join(publicDataDir, "gridstress_latest.json"), gridstress);

  // Convenience snapshot
  writeJson(path.join(dataLatestDir, "gridstress_latest.json"), safeObject(gridstress));

  console.log("Done. Updated frontend JSON in site/public/data/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
