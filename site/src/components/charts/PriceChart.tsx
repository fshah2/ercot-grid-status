import React from "react";
import type { Price7d } from "../../lib/types";
import { fmtMoney, fmtTime } from "../../lib/format";
import { EChart } from "./EChart";

export function PriceChart(props: { price: Price7d; p75?: number | null; p95?: number | null }) {
  const pts = props.price.points ?? [];
  const p75 = props.p75;
  const p95 = props.p95;

  const toX = (ts: string) => {
    const t = Date.parse(ts);
    return Number.isFinite(t) ? t : ts;
  };

  const series: any[] = [
    {
      name: "Price",
      type: "line",
      showSymbol: false,
      data: pts.map((p) => [toX(p.ts), p.value])
    }
  ];

  // Add horizontal context bands as dashed lines.
  // (ECharts markLine would be nice, but simple series is easier to tooltip.)
  if (typeof p75 === "number") {
    series.push({
      name: "75th percentile (last 7d)",
      type: "line",
      showSymbol: false,
      lineStyle: { type: "dashed" },
      data: pts.map((p) => [toX(p.ts), p75])
    });
  }

  if (typeof p95 === "number") {
    series.push({
      name: "95th percentile (last 7d)",
      type: "line",
      showSymbol: false,
      lineStyle: { type: "dashed" },
      data: pts.map((p) => [toX(p.ts), p95])
    });
  }

  const option = {
    tooltip: {
      trigger: "axis",
      formatter: (items: any[]) => {
        const ts = items?.[0]?.data?.[0];
        const priceItem = (items ?? []).find((it: any) => it.seriesName === "Price");
        const v = priceItem?.data?.[1];
        const rows = (items ?? [])
          .filter((it: any) => it.seriesName !== "Price")
          .map((it: any) => `${it.marker} ${it.seriesName}: <b>${fmtMoney(it.data[1], 0)}</b> / MWh`)
          .join("<br/>");

        const head = `<div><b>${fmtTime(ts)}</b><br/>Price: <b>${fmtMoney(v, 0)}</b> / MWh`;
        return rows ? `${head}<br/>${rows}</div>` : `${head}</div>`;
      }
    },
    legend: { top: 0 },
    grid: { left: 56, right: 16, top: 36, bottom: 40 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: "$/MWh" },
    series
  };

  return <EChart option={option} />;
}
