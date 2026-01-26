import React from "react";
import type { Outages7d } from "../../lib/types";
import { fmtNumber, fmtTime } from "../../lib/format";
import { EChart } from "./EChart";

export function OutagesChart(props: { outages: Outages7d }) {
  const pts = props.outages.points ?? [];

  const toX = (ts: string) => {
    const t = Date.parse(ts);
    return Number.isFinite(t) ? t : ts;
  };

  const option = {
    tooltip: {
      trigger: "axis",
      formatter: (items: any[]) => {
        const ts = items?.[0]?.data?.[0];
        const rows = (items ?? [])
          .map((it) => `${it.marker} ${it.seriesName}: <b>${fmtNumber(it.data[1])}</b> MW`)
          .join("<br/>");
        return `<div><b>${fmtTime(ts)}</b><br/>${rows}</div>`;
      }
    },
    legend: { top: 0 },
    grid: { left: 56, right: 16, top: 36, bottom: 40 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: "MW" },
    series: [
      {
        name: "IRR outages",
        type: "line",
        stack: "outages",
        areaStyle: {},
        showSymbol: false,
        data: pts.map((p) => [toX(p.ts), p.totalIRRMW])
      },
      {
        name: "New equipment outages",
        type: "line",
        stack: "outages",
        areaStyle: {},
        showSymbol: false,
        data: pts.map((p) => [toX(p.ts), p.totalNewEquipResourceMW])
      },
      {
        name: "Other outages (implied)",
        type: "line",
        stack: "outages",
        areaStyle: {},
        showSymbol: false,
        data: pts.map((p) => {
          const other = (p.totalResourceMW ?? 0) - (p.totalIRRMW ?? 0) - (p.totalNewEquipResourceMW ?? 0);
          return [toX(p.ts), Math.max(0, other)];
        })
      }
    ]
  };

  return <EChart option={option} />;
}
