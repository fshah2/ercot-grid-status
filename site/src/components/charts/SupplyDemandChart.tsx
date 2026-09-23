import React from "react";
import type { SupplyDemand2d } from "../../lib/types";
import { fmtNumber, fmtTime } from "../../lib/format";
import { EChart } from "./EChart";

export function SupplyDemandChart(props: { supply: SupplyDemand2d }) {
  const pts = props.supply.points ?? [];

  // Only trust headroom when the backend confirmed real capacity (HASL) data exists.
  // Older files without the flag fall back to "any point has a positive capacity".
  const headroomAvailable =
    props.supply.meta?.headroomAvailable ??
    pts.some((p) => typeof p.availHASLMW === "number" && p.availHASLMW > 0);

  // ECharts time axis can silently render nothing if timestamps aren't parseable.
  // Convert to epoch ms for maximum compatibility.
  const toX = (ts: string) => {
    const t = Date.parse(ts);
    return Number.isFinite(t) ? t : ts;
  };

  const hasAnyValue = pts.some(
    (p) =>
      (typeof p.demandMW === "number" && Number.isFinite(p.demandMW)) ||
      (headroomAvailable && typeof p.availHASLMW === "number" && Number.isFinite(p.availHASLMW)) ||
      (typeof p.genTelemMW === "number" && Number.isFinite(p.genTelemMW))
  );

  if (!pts.length || !hasAnyValue) {
    return (
      <div className="chartEmpty">
        No supply/demand points yet. If this stays empty, re-run the backend fetch so
        <code> supplydemand_2d.json</code> is regenerated.
      </div>
    );
  }

  const option = {
    tooltip: {
      trigger: "axis",
      formatter: (items: any[]) => {
        const ts = items?.[0]?.data?.[0];
        const byName = new Map<string, number>();
        for (const it of items ?? []) {
          if (it?.data?.length >= 2) byName.set(it.seriesName, it.data[1]);
        }

        const demand = byName.get("Demand") ?? null;
        const avail = byName.get("Available capability (HASL)") ?? null;
        const gen = byName.get("Generation telemetry") ?? null;
        const headroom =
          headroomAvailable && typeof demand === "number" && typeof avail === "number"
            ? avail - demand
            : null;

        const lines: string[] = [];
        if (typeof demand === "number") lines.push(`Demand: <b>${fmtNumber(demand)}</b> MW`);
        if (typeof avail === "number") lines.push(`Available: <b>${fmtNumber(avail)}</b> MW`);
        if (typeof gen === "number") lines.push(`Generation: <b>${fmtNumber(gen)}</b> MW`);
        // A negative "headroom" would mean the capacity data is wrong, not that the grid is short.
        if (typeof headroom === "number" && headroom >= 0)
          lines.push(`Headroom: <b>${fmtNumber(headroom)}</b> MW`);

        return `<div><b>${fmtTime(ts)}</b><br/>${lines.join("<br/>")}</div>`;
      }
    },
    legend: { top: 0 },
    grid: { left: 56, right: 16, top: 36, bottom: 40 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: "MW" },
    series: [
      {
        name: "Demand",
        type: "line",
        showSymbol: false,
        data: pts.map((p) => [toX(p.ts), p.demandMW])
      },
      ...(headroomAvailable
        ? [
            {
              name: "Available capability (HASL)",
              type: "line",
              showSymbol: false,
              data: pts.map((p) => [toX(p.ts), p.availHASLMW])
            }
          ]
        : []),
      {
        name: "Generation telemetry",
        type: "line",
        showSymbol: false,
        lineStyle: { type: "dashed" },
        data: pts.map((p) => [toX(p.ts), p.genTelemMW])
      }
    ]
  };

  return (
    <>
      {!headroomAvailable && (
        <div className="chartNote">
          ERCOT isn’t currently publishing available-capacity data, so headroom can’t be shown. Demand and
          generation are still plotted.
        </div>
      )}
      <EChart option={option} />
    </>
  );
}
