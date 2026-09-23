import type {
  FuelMix7d,
  Forecast7d,
  GridStressLatest,
  Load7d,
  Outages7d,
  Price7d,
  SupplyDemand2d
} from "./types";

// The site is served under a sub-path on GitHub Pages (e.g. /ercot-grid-status).
// NEXT_PUBLIC_BASE_PATH is inlined at build time; empty for local `npm run dev`.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

async function getJson<T>(relPath: string): Promise<T> {
  const path = `${BASE_PATH}${relPath}`;
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return (await res.json()) as T;
}

export async function loadAll() {
  const [
    load,
    forecast,
    price,
    fuelmix,
    outages,
    supply,
    stress
  ] = await Promise.all([
    getJson<Load7d>("/data/load_7d.json"),
    getJson<Forecast7d>("/data/forecast_7d.json"),
    getJson<Price7d>("/data/price_7d.json"),
    getJson<FuelMix7d>("/data/fuelmix_7d.json"),
    getJson<Outages7d>("/data/outages_7d.json"),
    getJson<SupplyDemand2d>("/data/supplydemand_2d.json"),
    getJson<GridStressLatest>("/data/gridstress_latest.json")
  ]);

  return { load, forecast, price, fuelmix, outages, supply, stress };
}
