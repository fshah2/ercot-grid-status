export type Point = { ts: string; value: number };

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

// Keep in sync with scripts/src/types.ts. All `ts` values are real UTC ISO strings.
export type Load7d = { meta: Record<string, unknown>; points: Point[] };
export type Forecast7d = { meta: Record<string, unknown>; points: Point[] };
export type Price7d = { meta: Record<string, unknown>; points: Point[] };
export type FuelMix7d = { meta: Record<string, unknown>; points: FuelMixPoint[] };
// points = past + current hour (latest posting per hour); upcomingPoints = scheduled future hours.
export type Outages7d = {
  meta: Record<string, unknown>;
  points: OutagePoint[];
  upcomingPoints?: OutagePoint[];
};
export type SupplyDemand2d = {
  meta: Record<string, unknown> & { headroomAvailable?: boolean; headroomNote?: string };
  points: SupplyDemandPoint[];
};

export type PriceStatus = "Normal" | "Elevated" | "Spike";
export type GridStress = "Normal" | "Watch" | "Stressed";

export type GridStressLatest = {
  meta?: { schemaVersion: number };
  ts: string;
  gridStress: GridStress;
  priceStatus: PriceStatus;
  // Which signals fired (UI builds its reason text from these)
  loadWatch: boolean;
  loadStressed: boolean;
  outageHigh: boolean;
  lambdaWatch: boolean;
  lambdaStressed: boolean;
  headroomLow: boolean;
  headroomAvailable?: boolean;

  latestPrice?: number | null;
  priceP75?: number | null;
  priceP95?: number | null;
  latestDemandMW?: number | null;
  latestOutagesMW?: number | null;
  latestHeadroomMW?: number | null;
  latestHeadroomPct?: number | null;
  latestLambda?: number | null;
  latestOutagesTs?: string | null;

  notes: string[];
};
