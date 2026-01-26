import { GridStress, GridStressLatest, Point, PriceStatus } from "./types.js";

function percentile(values: number[], p: number): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const idx = Math.min(xs.length - 1, Math.max(0, Math.floor((p / 100) * (xs.length - 1))));
  return xs[idx] ?? null;
}

/**
 * Tunable, conservative thresholds.
 * These are intentionally simple + explainable for non-technical users.
 */
const THRESHOLDS = {
  // Price ($/MWh)
  priceElevatedAbs: 150,
  priceSpikeAbs: 300,
  priceSpikeAbsHard: 500, // "very high" backstop

  // System Lambda (same units as $/MWh signal; higher = tighter)
  lambdaWatch: 300,
  lambdaStressed: 500,

  // Load/outage percentiles
  loadWatchPct: 90,
  loadStressedPct: 95,
  outageHighPct: 90
};

export function computePriceStatus(price7d: Point[]): {
  status: PriceStatus;
  latestPrice: number | null;
  p75: number | null;
  p95: number | null;
} {
  const latest = price7d.length ? price7d[price7d.length - 1] : null;
  const values = price7d.map((p) => p.value);
  const p75 = percentile(values, 75);
  const p95 = percentile(values, 95);
  const latestPrice = latest?.value ?? null;

  let status: PriceStatus = "Normal";

  if (latestPrice != null) {
    // We use BOTH relative thresholds (percentiles) and simple absolute thresholds.
    const elevatedCut = Math.max(p75 ?? -Infinity, THRESHOLDS.priceElevatedAbs);
    const spikeCut = Math.max(p95 ?? -Infinity, THRESHOLDS.priceSpikeAbs);

    if (latestPrice >= THRESHOLDS.priceSpikeAbsHard || latestPrice >= spikeCut) status = "Spike";
    else if (latestPrice >= elevatedCut) status = "Elevated";
  }

  return { status, latestPrice, p75, p95 };
}

export function computeGridStress(input: {
  nowIso: string;
  pricePoints: Point[];
  loadPoints: Point[];
  outagePoints?: Point[];
  lambdaPoints?: Point[];
}): GridStressLatest {
  const notes: string[] = [];

  const price = computePriceStatus(input.pricePoints);

  const loadValues = input.loadPoints.map((p) => p.value);
  const loadP90 = percentile(loadValues, THRESHOLDS.loadWatchPct);
  const loadP95 = percentile(loadValues, THRESHOLDS.loadStressedPct);
  const latestLoad = input.loadPoints.length ? input.loadPoints[input.loadPoints.length - 1].value : null;

  const outages = input.outagePoints ?? [];
  const outageValues = outages.map((p) => p.value);
  const outageP90 = percentile(outageValues, THRESHOLDS.outageHighPct);
  const latestOutage = outages.length ? outages[outages.length - 1].value : null;

  const lambda = input.lambdaPoints ?? [];
  const latestLambda = lambda.length ? lambda[lambda.length - 1].value : null;

  // Flags
  const loadWatch = latestLoad != null && loadP90 != null && latestLoad >= loadP90;
  const loadStressed = latestLoad != null && loadP95 != null && latestLoad >= loadP95;

  const outageHigh = latestOutage != null && outageP90 != null && latestOutage >= outageP90;

  const lambdaWatch = latestLambda != null && latestLambda >= THRESHOLDS.lambdaWatch;
  const lambdaStressed = latestLambda != null && latestLambda >= THRESHOLDS.lambdaStressed;

  // Classification
  let gridStress: GridStress = "Normal";

  // STRESSED: Spike prices OR very high lambda OR (very high load + high outages)
  if (
    price.status === "Spike" ||
    lambdaStressed ||
    (loadStressed && outageHigh)
  ) {
    gridStress = "Stressed";
  }
  // WATCH: Elevated prices OR high lambda OR unusually high load OR unusually high outages
  else if (
    price.status === "Elevated" ||
    lambdaWatch ||
    loadWatch ||
    outageHigh
  ) {
    gridStress = "Watch";
  }

  // Notes (plain English, include thresholds so tooltips can show them)
  if (price.latestPrice != null) {
    notes.push(
      `Latest real-time price is $${price.latestPrice.toFixed(0)}/MWh.`
    );
    notes.push(
      `Price status rules: Elevated if above max(75th percentile, $${THRESHOLDS.priceElevatedAbs}); Spike if above max(95th percentile, $${THRESHOLDS.priceSpikeAbs}) or above $${THRESHOLDS.priceSpikeAbsHard}.`
    );
  } else {
    notes.push("Price data is missing right now, so the stress label relies more on demand/outages/lambda.");
  }

  if (latestLambda != null) {
    notes.push(`System Lambda is ${latestLambda.toFixed(0)}.`);
    notes.push(
      `Lambda rules: Watch at ≥${THRESHOLDS.lambdaWatch}; Stressed at ≥${THRESHOLDS.lambdaStressed}.`
    );
  } else {
    notes.push("System Lambda is missing right now.");
  }

  if (latestLoad != null && loadP90 != null && loadP95 != null) {
    notes.push(`Demand right now is ${latestLoad.toFixed(0)} MW.`);
    notes.push(
      `Demand rules: Watch above the ${THRESHOLDS.loadWatchPct}th percentile; Stressed above the ${THRESHOLDS.loadStressedPct}th percentile (based on the last 7 days).`
    );
  }

  if (latestOutage != null && outageP90 != null) {
    notes.push(`Outages right now are ${latestOutage.toFixed(0)} MW.`);
    notes.push(
      `Outage rule: “Unusually high” if above the ${THRESHOLDS.outageHighPct}th percentile (last 7 days).`
    );
  }

  notes.push(
    "This is a conservative indicator meant to answer: “Are conditions getting tight?” It is not an emergency alert system."
  );

  return {
    ts: input.nowIso,
    gridStress,
    priceStatus: price.status,
    latestPrice: price.latestPrice,
    priceP75: price.p75,
    priceP95: price.p95,
    notes
  };
}
