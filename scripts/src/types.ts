export type JsonObject = Record<string, unknown>;

export type ApiResponse = {
  _embedded?: Record<string, unknown>;
  _links?: Record<string, { href?: string }>;
  page?: {
    number?: number;
    size?: number;
    totalPages?: number;
    totalElements?: number;
  };
} & JsonObject;

export type Point = { ts: string; value: number };

export type ForecastPoint = { ts: string; value: number };

export type FuelMixPoint = {
  ts: string;
  wind: number;
  solar: number;
  otherRenew: number;
  thermal: number;
  storageDischarge: number;
  storageCharge: number;
};

export type OutagePoint = {
  ts: string;
  totalResourceMW: number;
  totalIRRMW: number;
  totalNewEquipResourceMW: number;
  zones?: {
    south: number;
    north: number;
    west: number;
    houston: number;
  };
};

export type SupplyDemandPoint = {
  ts: string;
  demandMW: number | null;
  genTelemMW: number | null;
  availHASLMW: number | null;
  headroomMW: number | null;
  headroomPct: number | null;
};

export type Load7d = { meta: JsonObject; points: Point[]; forecastPoints?: ForecastPoint[] };
export type Price7d = { meta: JsonObject; points: Point[] };
export type FuelMix7d = { meta: JsonObject; points: FuelMixPoint[] };
export type Outages7d = { meta: JsonObject; points: OutagePoint[] };
export type Forecast7d = { meta: JsonObject; points: ForecastPoint[] };
export type SupplyDemand2d = { meta: JsonObject; points: SupplyDemandPoint[] };

export type PriceStatus = "Normal" | "Elevated" | "Spike";
export type GridStress = "Normal" | "Watch" | "Stressed";

export type GridStressLatest = {
  ts: string;
  gridStress: GridStress;
  priceStatus: PriceStatus;
  // Context for UI bands/tiles
  latestPrice?: number | null;
  priceP75?: number | null;
  priceP95?: number | null;
  latestDemandMW?: number | null;
  latestOutagesMW?: number | null;
  latestHeadroomMW?: number | null;
  latestHeadroomPct?: number | null;
  notes: string[];
};
