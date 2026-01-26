import dynamic from "next/dynamic";
import React from "react";

// echarts-for-react uses window; we disable SSR
const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

function isPlainObject(x: any): x is Record<string, any> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function deepMerge(base: any, override: any): any {
  if (!isPlainObject(base) || !isPlainObject(override)) return override ?? base;
  const out: Record<string, any> = { ...base };
  for (const k of Object.keys(override)) {
    const bv = (base as any)[k];
    const ov = (override as any)[k];
    if (isPlainObject(bv) && isPlainObject(ov)) out[k] = deepMerge(bv, ov);
    else out[k] = ov;
  }
  return out;
}

// Light-mode, high-contrast defaults (applies to all charts)
const BASE_OPTION = {
  backgroundColor: "transparent",
  animation: false,
  textStyle: {
    color: "#111827",
    fontFamily:
      "ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial"
  },
  legend: {
    top: 0,
    textStyle: { color: "#111827" }
  },
  tooltip: {
    backgroundColor: "rgba(255,255,255,0.98)",
    borderColor: "rgba(17,24,39,0.12)",
    borderWidth: 1,
    textStyle: { color: "#111827" },
    extraCssText: "box-shadow: 0 10px 24px rgba(0,0,0,0.12); border-radius: 10px;"
  },
  xAxis: {
    axisLine: { lineStyle: { color: "rgba(17,24,39,0.22)" } },
    axisTick: { lineStyle: { color: "rgba(17,24,39,0.22)" } },
    axisLabel: { color: "rgba(17,24,39,0.72)" },
    splitLine: { show: false }
  },
  yAxis: {
    axisLine: { lineStyle: { color: "rgba(17,24,39,0.22)" } },
    axisTick: { lineStyle: { color: "rgba(17,24,39,0.22)" } },
    axisLabel: { color: "rgba(17,24,39,0.72)" },
    nameTextStyle: { color: "rgba(17,24,39,0.72)" },
    splitLine: { lineStyle: { color: "rgba(17,24,39,0.08)" } }
  },
  // Use a consistent, high-contrast palette.
  color: [
    "#2563eb", // blue
    "#16a34a", // green
    "#f59e0b", // amber
    "#7c3aed", // purple
    "#ef4444", // red
    "#0ea5e9" // sky
  ]
};

export function EChart(props: { option: any; height?: number }) {
  const option = deepMerge(BASE_OPTION, props.option ?? {});

  return (
    <div style={{ width: "100%", height: props.height ?? 340 }}>
      <ReactECharts
        option={option}
        style={{ height: "100%", width: "100%" }}
        opts={{ renderer: "canvas" }}
      />
    </div>
  );
}
