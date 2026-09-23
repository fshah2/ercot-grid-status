import React from "react";
import type { FuelMix7d, FuelMixPoint } from "../../lib/types";
import { fmtTime, fmtNumber } from "../../lib/format";
import { EChart } from "./EChart";

export function FuelMixChart(props: { fuelmix: FuelMix7d }) {
  const pts = props.fuelmix.points ?? [];

  const toX = (ts: string) => {
    const t = Date.parse(ts);
    return Number.isFinite(t) ? t : ts;
  };

  // SCED rows are ~5 minutes apart. When ERCOT skips a stretch (e.g. a whole missing day),
  // insert a null point so the lines break instead of drawing a straight line across the gap.
  const GAP_MS = 30 * 60 * 1000;
  const seriesData = (pick: (p: FuelMixPoint) => number) => {
    const out: Array<[number | string, number | null]> = [];
    let prevT: number | null = null;
    for (const p of pts) {
      const x = toX(p.ts);
      if (typeof x === "number" && prevT != null && x - prevT > GAP_MS) {
        out.push([prevT + (x - prevT) / 2, null]);
      }
      out.push([x, pick(p)]);
      if (typeof x === "number") prevT = x;
    }
    return out;
  };

  const option = {
    tooltip: {
      trigger: "axis",
      formatter: (items: any[]) => {
        const ts = items?.[0]?.data?.[0];
        const rows = (items ?? [])
          .filter((it) => typeof it?.data?.[1] === "number")
          .map((it) => `${it.marker} ${it.seriesName}: <b>${fmtNumber(it.data[1])}</b> MW`)
          .join("<br/>");
        return `<div><b>${fmtTime(ts)}</b><br/>${rows}</div>`;
      }
    },
    legend: { top: 0 },
    grid: { left: 48, right: 16, top: 36, bottom: 40 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: "MW" },
    series: [
      {
        name: "Wind",
        type: "line",
        stack: "total",
        areaStyle: {},
        showSymbol: false,
        data: seriesData((p) => p.wind)
      },
      {
        name: "Solar",
        type: "line",
        stack: "total",
        areaStyle: {},
        showSymbol: false,
        data: seriesData((p) => p.solar)
      },
      {
        name: "Other renewables",
        type: "line",
        stack: "total",
        areaStyle: {},
        showSymbol: false,
        data: seriesData((p) => p.otherRenew)
      },
      {
        name: "Thermal",
        type: "line",
        stack: "total",
        areaStyle: {},
        showSymbol: false,
        data: seriesData((p) => p.thermal)
      },
      {
        name: "Storage discharge",
        type: "line",
        stack: "total",
        areaStyle: {},
        showSymbol: false,
        data: seriesData((p) => p.storageDischarge)
      }
    ]
  };

  return <EChart option={option} />;
}
