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
  buildForecastPoints
} from "./normalize.js";
import { computeGridStress } from "./gridStress.js";
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
 * ERCOT requires some datetime query params in:
 *   yyyy-MM-ddThh:mm:ss
 * i.e., no milliseconds and no trailing timezone "Z".
 */
function toErcotDateTimeParam(isoUtc: string): string {
  return isoUtc.replace(/\.\d{3}Z$/, "").replace(/Z$/, "");
}

function toMarketLocalParam(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(d);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";

  // ERCOT expects: YYYY-MM-DDTHH:mm:ss  (NO timezone suffix)
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
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

  // Time window formats
  const dateFrom = cutoff.slice(0, 10); // YYYY-MM-DD
  const dateTo = nowIso.slice(0, 10);   // YYYY-MM-DD

  const dtFrom = toErcotDateTimeParam(cutoffIso); // yyyy-MM-ddThh:mm:ss
  const dtTo = toErcotDateTimeParam(nowIso);      // yyyy-MM-ddThh:mm:ss

  // 2d_agg_gen_summary can lag by days. Fetch a wider window.
  // We'll later trim to "last 2 days of AVAILABLE data".
  const scedLagHours = 6;              // avoid querying right up to "now"
  const scedLookbackHours = 24 * 7;    // fetch up to 7 days

  const scedToDate = new Date(now.getTime() - scedLagHours * 60 * 60 * 1000);
  const scedFromDate = new Date(scedToDate.getTime() - scedLookbackHours * 60 * 60 * 1000);

  const scedFrom = toMarketLocalParam(scedFromDate, CONFIG.marketTimeZone);
  const scedTo = toMarketLocalParam(scedToDate, CONFIG.marketTimeZone);


  const QUERY_BY_KEY: Record<string, Record<string, string>> = {
    act_sys_load_by_fzn: {
      operatingDayFrom: dateFrom,
      operatingDayTo: dateTo
    },
    lf_by_model_weather_zone: {
      postedDatetimeFrom: dtFrom,
      postedDatetimeTo: dtTo
    },
    hourly_res_outage_cap: {
      postedDatetimeFrom: dtFrom,
      postedDatetimeTo: dtTo
    },

    // SCED-based endpoints: lock window using SCEDTimestampFrom/To
    "2d_agg_gen_summary": {
      SCEDTimestampFrom: scedFrom,
      SCEDTimestampTo: scedTo
    },
    lmp_node_zone_hub: {
      SCEDTimestampFrom: scedFrom,
      SCEDTimestampTo: scedTo
    },
    sced_system_lambda: {
      SCEDTimestampFrom: scedFrom,
      SCEDTimestampTo: scedTo
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
  const existingLoad = readJsonIfExists<Load7d>(path.join(publicDataDir, "load_7d.json"));
  const existingPrice = readJsonIfExists<Price7d>(path.join(publicDataDir, "price_7d.json"));
  const existingFuel = readJsonIfExists<FuelMix7d>(path.join(publicDataDir, "fuelmix_7d.json"));
  const existingOutages = readJsonIfExists<Outages7d>(path.join(publicDataDir, "outages_7d.json"));
  const existingForecast = readJsonIfExists<Forecast7d>(path.join(publicDataDir, "forecast_7d.json"));
  const existingSupply = readJsonIfExists<SupplyDemand2d>(path.join(publicDataDir, "supplydemand_2d.json"));

  const loadRows = pagesLoad ? pagesLoad.flatMap((p) => extractRows(p as any)) : [];
  const forecastRows = pagesForecast ? pagesForecast.flatMap((p) => extractRows(p as any)) : [];
  const outageRows = pagesOutages ? pagesOutages.flatMap((p) => extractRows(p as any)) : [];
  const fuelRows = pagesFuel ? pagesFuel.flatMap((p) => extractRows(p as any)) : [];
  const priceRows = pagesPrice ? pagesPrice.flatMap((p) => extractRows(p as any)) : [];
  const lambdaRows = pagesLambda ? pagesLambda.flatMap((p) => extractRows(p as any)) : [];

  const newLoadPoints = withinWindow(buildLoadPoints(loadRows), cutoff);
  const newForecastPoints = withinWindow(buildForecastPoints(forecastRows), cutoff);
  const newOutagePoints = withinWindow(buildOutagePoints(outageRows), cutoff);
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
  const supplyNew = buildSupplyDemandPoints(fuelRows, mergedLoad);

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

  const mergedForecast = withinWindow(
    mergeUniqueByTs(existingForecast?.points ?? [], newForecastPoints),
    cutoff
  );

  const load7d: Load7d = {
    meta: {
      updatedAt: nowIso,
      windowDays: CONFIG.historyDays,
      source: "ERCOT Public Data API",
      endpoint: CONFIG.endpoints.actualLoad,
      queryUsed: usedQueryByKey["act_sys_load_by_fzn"] ?? {},
      notes: "System load is aggregated across rows per timestamp (if multiple zones are present)."
    },
    points: mergedLoad
  };

  const forecast7d: Forecast7d = {
    meta: {
      updatedAt: nowIso,
      windowDays: CONFIG.historyDays,
      source: "ERCOT Public Data API",
      endpoint: CONFIG.endpoints.forecast,
      queryUsed: usedQueryByKey["lf_by_model_weather_zone"] ?? {},
      notes:
        "Forecast is best-effort aggregated across rows per timestamp. If your dataset schema differs, adjust scripts/src/normalize.ts buildForecastPoints()."
    },
    points: mergedForecast
  };

  const price7d: Price7d = {
    meta: {
      updatedAt: nowIso,
      windowDays: CONFIG.historyDays,
      source: "ERCOT Public Data API",
      endpoint: CONFIG.endpoints.prices,
      queryUsed: usedQueryByKey["lmp_node_zone_hub"] ?? {},
      headlineSettlementPoint: CONFIG.headlineSettlementPoint,
      notes:
        "Price series is the selected settlement point if present (default HB_NORTH). If not present, we fall back to averaging available rows per timestamp."
    },
    points: mergedPrice
  };

  const fuelmix7d: FuelMix7d = {
    meta: {
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
      updatedAt: nowIso,
      windowDays: CONFIG.historyDays,
      source: "ERCOT Public Data API",
      endpoint: CONFIG.endpoints.outages,
      queryUsed: usedQueryByKey["hourly_res_outage_cap"] ?? {},
      notes:
        "Outages are aggregated from NP3-233-CD by load zone and split into Total, IRR, and New Equipment capability outages."
    },
    points: mergedOutages
  };

  const supplyDemand2d: SupplyDemand2d = {
    meta: {
      updatedAt: nowIso,
      windowDays: 2,
      source: "ERCOT Public Data API",
      endpoint: CONFIG.endpoints.fuelMix,
      queryUsed: usedQueryByKey["2d_agg_gen_summary"] ?? {},
      notes:
        "Supply = total HASL (High Sustained Limit) across NonIRR+WGR+PVGR+REMRES from 2D Agg Gen Summary. Demand aligns to the most recent hourly system load reading at-or-before each SCED timestamp."
    },
    points: mergedSupply
  };

  // For stress classification, use total outaged capability as a simple scalar.
  const outagesForStress = mergedOutages.map((p) => ({ ts: p.ts, value: p.totalResourceMW }));

  const latestSupply = mergedSupply.length
    ? mergedSupply[mergedSupply.length - 1]
    : null;

  const gridstress: GridStressLatest = computeGridStress({
    nowIso,
    pricePoints: mergedPrice,
    loadPoints: mergedLoad,
    outagePoints: outagesForStress,
    lambdaPoints: CONFIG.includeSystemLambda ? newLambdaPoints : []
  });

  // Add extra context used by the UI (bands/tiles).
  gridstress.latestHeadroomMW = latestSupply?.headroomMW ?? null;
  gridstress.latestHeadroomPct = latestSupply?.headroomPct ?? null;
  gridstress.latestDemandMW = latestSupply?.demandMW ?? (mergedLoad.length ? mergedLoad[mergedLoad.length - 1].value : null);
  gridstress.latestOutagesMW = outagesForStress.length ? outagesForStress[outagesForStress.length - 1].value : null;
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
