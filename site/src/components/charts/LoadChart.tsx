import React from "react";
import type { EChartsOption, SeriesOption } from "echarts";
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

  // Keep series typed as ECharts' unified SeriesOption, from the SAME module as EChartsOption.
  const series: SeriesOption[] = [
    {
      name: "Actual demand (MW)",
      type: "line" as const,
      showSymbol: false,
      data: load.map((p) => [toX(p.ts), p.value])
    }
  ];

  if (forecast.length) {
    series.push({
      name: "Forecast demand (MW)",
      type: "line" as const,
      showSymbol: false,
      lineStyle: { type: "dashed" },
      data: forecast.map((p) => [toX(p.ts), p.value])
    });
  }

  const option: EChartsOption = {
    tooltip: {
      trigger: "axis",
      formatter: (params: any) => {
        const items = Array.isArray(params) ? params : [params];

        const rows = items
          .map((it: any) => {
            const v = Array.isArray(it?.data) ? it.data[1] : it?.value?.[1];
            return `${it.marker} ${it.seriesName}: <b>${fmtNumber(v)}</b>`;
          })
          .join("<br/>");

        const ts = Array.isArray(items?.[0]?.data)
          ? items[0].data[0]
          : items?.[0]?.value?.[0];

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
