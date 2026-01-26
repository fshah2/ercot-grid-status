import React, { useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { StatusTile } from "../components/StatusTile";
import { ChartCard } from "../components/ChartCard";
import { loadAll } from "../lib/data";
import type {
  FuelMix7d,
  Forecast7d,
  GridStressLatest,
  Load7d,
  Outages7d,
  Price7d,
  SupplyDemand2d
} from "../lib/types";
import { fmtMoney, fmtTime } from "../lib/format";
import { LoadChart } from "../components/charts/LoadChart";
import { FuelMixChart } from "../components/charts/FuelMixChart";
import { PriceChart } from "../components/charts/PriceChart";
import { OutagesChart } from "../components/charts/OutagesChart";
import { SupplyDemandChart } from "../components/charts/SupplyDemandChart";

type State = {
  load: Load7d;
  forecast: Forecast7d;
  price: Price7d;
  fuelmix: FuelMix7d;
  outages: Outages7d;
  supply: SupplyDemand2d;
  stress: GridStressLatest;
};

function stressTone(gridStress: GridStressLatest["gridStress"]): "good" | "warn" | "bad" {
  return gridStress === "Normal" ? "good" : gridStress === "Watch" ? "warn" : "bad";
}

function priceTone(priceStatus: GridStressLatest["priceStatus"]): "good" | "warn" | "bad" {
  return priceStatus === "Normal" ? "good" : priceStatus === "Elevated" ? "warn" : "bad";
}

export default function HomePage() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCharts, setShowCharts] = useState(true);

  useEffect(() => {
    loadAll()
      .then(setState)
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") setShowCharts(window.innerWidth >= 820);
  }, []);

  const computed = useMemo(() => {
    if (!state) return null;

    const latestPrice = state.price.points.length
      ? state.price.points[state.price.points.length - 1].value
      : null;

    const latestFuel = state.fuelmix.points.length
      ? state.fuelmix.points[state.fuelmix.points.length - 1]
      : null;

    const renewNow = latestFuel ? latestFuel.wind + latestFuel.solar + latestFuel.otherRenew : null;
    const genNow = latestFuel
      ? latestFuel.wind + latestFuel.solar + latestFuel.otherRenew + latestFuel.thermal + latestFuel.storageDischarge
      : null;
    const renewPct =
      renewNow != null && genNow != null && genNow > 0 ? (renewNow / genNow) * 100 : null;

    return { latestPrice, renewPct };
  }, [state]);

  const reasonLine = useMemo(() => {
    if (!state) return "—";
    const s = state.stress;

    const reasons: string[] = [];

    if (s.priceStatus === "Spike") reasons.push("Price spike");
    else if (s.priceStatus === "Elevated") reasons.push("High prices");

    // System Lambda detection from notes
    const lambdaNote = s.notes.find((n) => /System Lambda is/i.test(n));
    if (lambdaNote) {
      const m = lambdaNote.match(/(\d+(?:\.\d+)?)/);
      const v = m ? Number(m[1]) : NaN;
      if (Number.isFinite(v)) {
        if (v >= 500) reasons.push("Very high system cost");
        else if (v >= 300) reasons.push("High system cost");
      }
    }

    if (s.gridStress !== "Normal") {
      if (s.notes.some((n) => /Demand right now/i.test(n))) reasons.push("High demand");
      if (s.notes.some((n) => /Outages right now/i.test(n))) reasons.push("High outages");
    }

    // Dedup + keep top 2
    const seen = new Set<string>();
    const uniq = reasons.filter((r) => (seen.has(r) ? false : (seen.add(r), true)));

    if (uniq.length) return uniq.slice(0, 2).join(" + ");
    return s.gridStress === "Normal" ? "Typical conditions" : "Multiple signals";
  }, [state]);

  const actionBox = useMemo(() => {
    if (!state) return null;
    const s = state.stress.gridStress;

    if (s === "Stressed") {
      return {
        title: "What this means (quick)",
        items: [
          "Conditions look tight. ERCOT may be relying on more expensive/limited resources.",
          "If you can, reduce big loads (AC, dryer, oven) for the next couple hours.",
          "Prices can jump fast; your retail bill may not change in real time."
        ]
      };
    }

    if (s === "Watch") {
      return {
        title: "What this means (quick)",
        items: [
          "One or more signals are running high. This is an early heads-up.",
          "If you can, avoid big usage during the next peak window.",
          "Check again later — these conditions can change quickly."
        ]
      };
    }

    return {
      title: "What this means (quick)",
      items: [
        "Conditions look normal. Nothing unusual in these signals right now.",
        "This page is mainly a quick check-in for demand, prices, and renewables."
      ]
    };
  }, [state]);

  return (
    <Layout>
      {error && <div className="alert">Error loading data: {error}</div>}
      {!state && !error && <div className="muted">Loading…</div>}

      {state && computed && (
        <>
          <div className="topRow">
            <div className="muted">
              Last updated: <b>{fmtTime(state.stress.ts)}</b>
            </div>

            <button className="btn" onClick={() => setShowCharts((v) => !v)}>
              {showCharts ? "Hide charts" : "Show charts"}
            </button>
          </div>

          {/* SECTION: NOW */}
          <div className="section">
            <div className="sectionHead">
              <h2 className="h2Big">What’s happening right now</h2>
              <div className="muted">
                Three quick answers for a fast check-in. Hover the ⓘ icons for plain-English explanations.
              </div>
            </div>

            <div className="tiles">
              <StatusTile
                title="Grid Stress"
                icon="⚡"
                value={state.stress.gridStress}
                subvalue={reasonLine}
                tone={stressTone(state.stress.gridStress)}
                tooltipTitle="What does “Grid Stress” mean?"
                tooltipBody={
                  <div>
                    <p>
                      This is a simple “how tight is the grid?” label.
                      It helps answer: <b>should I expect the grid to be under strain right now?</b>
                    </p>
                    <p>
                      We look at: <b>prices</b>, <b>demand</b>, <b>outages</b>, and (when available) <b>System Lambda</b>.
                      Higher values usually mean ERCOT is using more expensive or limited resources.
                    </p>
                    <p className="muted">Why this label was chosen (latest signals):</p>
                    <ul>
                      {state.stress.notes.slice(0, 6).map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </div>
                }
              />

              <StatusTile
                title="Renewables right now"
                icon="🌬️"
                value={computed.renewPct == null ? "—" : `${computed.renewPct.toFixed(0)}%`}
                subvalue="Share of generation"
                tone="neutral"
                tooltipTitle="What counts as renewables here?"
                tooltipBody={
                  <div>
                    <p>
                      This shows the <b>share of generation</b> coming from renewables right now (mostly wind + solar).
                    </p>
                    <p className="muted">
                      Renewables can change quickly (weather + time of day), which can affect prices.
                    </p>
                  </div>
                }
              />

              <StatusTile
                title="Prices"
                icon="💲"
                value={state.stress.priceStatus}
                subvalue={
                  computed.latestPrice == null ? "Latest price unavailable" : `${fmtMoney(computed.latestPrice, 0)} / MWh`
                }
                tone={priceTone(state.stress.priceStatus)}
                tooltipTitle="What is a price “spike” here?"
                tooltipBody={
                  <div>
                    <p>
                      This is a simple real-time price signal. When prices jump, it often means the grid is tighter
                      (high demand, outages, congestion, or less wind/solar).
                    </p>
                    <p>
                      <b>Normal</b>: typical for the last week<br />
                      <b>Elevated</b>: noticeably higher than usual (often ~$150/MWh+)<br />
                      <b>Spike</b>: very high (often ~$300/MWh+)
                    </p>
                    <p className="muted">
                      This is a grid indicator — your retail bill may not change in real time.
                    </p>
                  </div>
                }
              />
            </div>

            {/* Action box */}
            <div className={`actionBox actionBox-${stressTone(state.stress.gridStress)}`}>
              <div className="actionTitle">{actionBox?.title}</div>
              <ul className="actionList">
                {actionBox?.items.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* SECTION: TRENDS */}
          <div className="section">
            <div className="sectionHead">
              <h2 className="h2Big">Trends (last 7 days)</h2>
              <div className="muted">
                These charts explain <i>why</i> the status changed. If you just want the answer, the section above is enough.
              </div>
            </div>

            {!showCharts ? (
              <div className="notes">
                <b>Charts are hidden.</b> Turn them back on with the button above.
              </div>
            ) : (
              <div className="grid">
                <ChartCard
                  title="Do we have enough supply? (Demand vs Available) — last 2 days"
                  tooltipTitle="What is “Available capability” here?"
                  tooltipBody={
                    <div>
                      <p>
                        <b>Demand</b> is the system load (how much Texans are using).
                      </p>
                      <p>
                        <b>Available capability (HASL)</b> is a best-effort “how much could we produce?” envelope
                        from ERCOT’s 2-day aggregated generation summary.
                      </p>
                      <p className="muted">
                        Headroom = Available − Demand. If headroom shrinks, conditions can get tighter.
                      </p>
                    </div>
                  }
                >
                  <SupplyDemandChart supply={state.supply} />
                </ChartCard>

                <ChartCard
                  title="Demand (Load) — last 7 days"
                  tooltipTitle="Why should I care about demand?"
                  tooltipBody={
                    <div>
                      <p>
                        This chart shows how much electricity Texans are using. When demand is unusually high,
                        the grid can get tighter.
                      </p>
                      <p className="muted">The dashed line (if present) is the best-effort forecast from ERCOT.</p>
                    </div>
                  }
                >
                  <LoadChart load={state.load} forecast={state.forecast} />
                </ChartCard>

                <ChartCard
                  title="Real-time price (headline) — last 7 days"
                  tooltipTitle="What price is this, exactly?"
                  tooltipBody={
                    <div>
                      <p>
                        This is one “headline” real-time price series to keep things simple (default: <b>HB_NORTH</b>).
                        It helps answer: “Are prices spiking?”
                      </p>
                      <p className="muted">
                        You can change the headline hub/zone in <code>scripts/src/config.ts</code>.
                      </p>
                    </div>
                  }
                >
                  <PriceChart price={state.price} p75={state.stress.priceP75} p95={state.stress.priceP95} />
                </ChartCard>

                <ChartCard
                  title="Fuel mix — last 7 days"
                  tooltipTitle="What does this fuel mix chart mean?"
                  tooltipBody={
                    <div>
                      <p>
                        This is the grid’s “recipe” over time. A bigger renewables area means more wind/solar.
                        A bigger thermal area means more dispatchable generation.
                      </p>
                      <p className="muted">It can change quickly with weather, time of day, and demand.</p>
                    </div>
                  }
                >
                  <FuelMixChart fuelmix={state.fuelmix} />
                </ChartCard>

                <ChartCard
                  title="Outages — last 7 days"
                  tooltipTitle="What are outages in this chart?"
                  tooltipBody={
                    <div>
                      <p>
                        Outages are generation that is unavailable. Higher outages can make the grid tighter.
                      </p>
                      <p className="muted">
                        We aggregate outage-related fields per timestamp.
                      </p>
                    </div>
                  }
                >
                  <OutagesChart outages={state.outages} />
                </ChartCard>
              </div>
            )}
          </div>

          <div className="notes">
            <h3 className="h3">In plain English</h3>
            <ul>
              <li>
                <b>Normal</b> means “nothing unusual in these signals.”
              </li>
              <li>
                <b>Watch</b> means “one or more signals are running high.”
              </li>
              <li>
                <b>Stressed</b> means “prices spiked or multiple signals are high at once.”
              </li>
            </ul>
          </div>
        </>
      )}
    </Layout>
  );
}
