"use client";

import { useMemo } from "react";
import type { Data } from "plotly.js";
import { PlotlyChart } from "@/components/shared/PlotlyChart";
import type { EngineResult } from "@/lib/forecast";

/** Grouped bars: MAPE vs WAPE, hold-out vs walk-forward, per fitted model. */
export function MetricBars({ res }: { res: EngineResult }) {
  const data = useMemo(() => {
    const ms = res.models.filter((m) => m.status === "ok" && m.holdout);
    const ordered = [...ms].sort((a, b) => res.ranking.indexOf(a.id) - res.ranking.indexOf(b.id));
    const x = ordered.map((m) => m.shortName);
    const series: { name: string; values: (number | null)[]; color: string }[] = [
      { name: "Hold-out WAPE", values: ordered.map((m) => m.holdout?.metrics.wape ?? null), color: "#0072b2" },
      { name: "Hold-out MAPE", values: ordered.map((m) => m.holdout?.metrics.mape ?? null), color: "#56b4e9" },
      { name: "Walk-forward WAPE", values: ordered.map((m) => m.walkForward?.metrics.wape ?? null), color: "#e69f00" },
      { name: "Walk-forward MAPE", values: ordered.map((m) => m.walkForward?.metrics.mape ?? null), color: "#f5cf85" },
    ];
    return series.map<Data>((s) => ({
      type: "bar",
      name: s.name,
      x,
      y: s.values,
      marker: { color: s.color },
      hovertemplate: `${s.name}: %{y:.2f}%<extra></extra>`,
    }));
  }, [res]);

  return (
    <PlotlyChart
      data={data}
      height={360}
      filename="bevcast_metric_comparison"
      ariaLabel="Grouped bar chart comparing MAPE and WAPE on the hold-out and walk-forward validation for each model"
      layout={{ barmode: "group", bargap: 0.25, xaxis: { type: "category", title: { text: "Model (ranked best to worst)" }, tickangle: -30 }, yaxis: { title: { text: "Error (%)" }, ticksuffix: "%", rangemode: "tozero" }, hovermode: "x unified", legend: { orientation: "h", x: 0, y: 1.02, xanchor: "left", yanchor: "bottom" }, margin: { l: 64, r: 16, t: 48, b: 64 } }}
    />
  );
}
