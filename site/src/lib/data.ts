import type {
  FuelMix7d,
  Forecast7d,
  GridStressLatest,
  Load7d,
  Outages7d,
  Price7d,
  SupplyDemand2d
} from "./types";

async function getJson<T>(path: string): Promise<T> {
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
