import React from "react";
import type { Load7d, Forecast7d } from "../../lib/types";
import { fmtTime, fmtNumber } from "../../lib/format";
import { EChart } from "./EChart";

export function LoadChart(props: { load: Load7d; forecast: Forecast7d }) {
  const load = props.load.points ?? [];
  const forecast = props.forecast.points ?? [];

  const toX = (ts: string) => {
    const t = Date.parse(ts);
    return Number.isFinite(t) ? t : ts;
  };

  const series = [
    {
      name: "Actual demand (MW)",
      type: "line",
      showSymbol: false,
      data: load.map((p) => [toX(p.ts), p.value])
    }
  ];

  if (forecast.length) {
    series.push({
      name: "Forecast demand (MW)",
      type: "line",
      showSymbol: false,
      lineStyle: { type: "dashed" },
      data: forecast.map((p) => [toX(p.ts), p.value])
    });
  }

  const option = {
    tooltip: {
      trigger: "axis",
      formatter: (items: any[]) => {
        const rows = items
          .map((it) => `${it.marker} ${it.seriesName}: <b>${fmtNumber(it.data[1])}</b>`)
          .join("<br/>");
        const ts = items?.[0]?.data?.[0];
        return `<div><b>${fmtTime(ts)}</b><br/>${rows}</div>`;
      }
    },
    legend: { top: 0 },
    grid: { left: 48, right: 16, top: 36, bottom: 40 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: "MW" },
    series
  };

  return <EChart option={option} />;
}
