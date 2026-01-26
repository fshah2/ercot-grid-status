import React from "react";
import type { FuelMix7d } from "../../lib/types";
import { fmtTime, fmtNumber } from "../../lib/format";
import { EChart } from "./EChart";

export function FuelMixChart(props: { fuelmix: FuelMix7d }) {
  const pts = props.fuelmix.points ?? [];

  const toX = (ts: string) => {
    const t = Date.parse(ts);
    return Number.isFinite(t) ? t : ts;
  };

  const option = {
    tooltip: {
      trigger: "axis",
      formatter: (items: any[]) => {
        const ts = items?.[0]?.data?.[0];
        const rows = items
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
        data: pts.map((p) => [toX(p.ts), p.wind])
      },
      {
        name: "Solar",
        type: "line",
        stack: "total",
        areaStyle: {},
        showSymbol: false,
        data: pts.map((p) => [toX(p.ts), p.solar])
      },
      {
        name: "Other renewables",
        type: "line",
        stack: "total",
        areaStyle: {},
        showSymbol: false,
        data: pts.map((p) => [toX(p.ts), p.otherRenew])
      },
      {
        name: "Thermal",
        type: "line",
        stack: "total",
        areaStyle: {},
        showSymbol: false,
        data: pts.map((p) => [toX(p.ts), p.thermal])
      },
      {
        name: "Storage discharge",
        type: "line",
        stack: "total",
        areaStyle: {},
        showSymbol: false,
        data: pts.map((p) => [toX(p.ts), p.storageDischarge])
      }
    ]
  };

  return <EChart option={option} />;
}
