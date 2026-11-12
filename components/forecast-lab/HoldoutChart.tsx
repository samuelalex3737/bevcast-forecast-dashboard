"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import type { Data } from "plotly.js";
import { PlotlyChart } from "@/components/shared/PlotlyChart";
import type { EngineResult } from "@/lib/forecast";
import { chartTheme, MODEL_COLORS } from "@/lib/insights/palette";
import { px } from "@/lib/insights/chartUtils";

/** Actual vs predicted on the hold-out for every fitted model; the selected model is highlighted. */
export function HoldoutChart({ res }: { res: EngineResult }) {
  const { resolvedTheme } = useTheme();
  const t = chartTheme(resolvedTheme === "dark");
  const data = useMemo(() => {
    const n = res.points.length;
    const k = res.holdoutSize;
    const context = res.points.slice(Math.max(0, n - k - 6));
    const anchor = res.points[n - k - 1];
    const traces: Data[] = [
      {
        type: "scatter",
        mode: "lines+markers",
        name: "Actual units",
        x: context.map((p) => px(p.period)),
        y: context.map((p) => p.y),
        line: { color: t.actual, width: 3 },
        marker: { size: 7, color: context.map((p) => (p.interpolated ? "rgba(0,0,0,0)" : t.actual)), line: { color: t.actual, width: 2 } },
        hovertemplate: "Actual: %{y:,.0f}<extra></extra>",
      },
    ];
    for (const m of res.models) {
      if (m.status !== "ok" || !m.holdout) continue;
      const selected = m.id === res.selectedId;
      traces.push({
        type: "scatter",
        mode: "lines+markers",
        name: `${m.shortName}${selected ? " (selected)" : ""}`,
        x: [...(anchor ? [px(anchor.period)] : []), ...m.holdout.periods.map(px)],
        y: [...(anchor ? [anchor.y] : []), ...m.holdout.predicted],
        line: { color: MODEL_COLORS[m.id], width: selected ? 3.5 : 1.6, dash: selected ? "solid" : "dot" },
        marker: { size: selected ? 8 : 5 },
        opacity: selected ? 1 : 0.75,
        customdata: [...(anchor ? [null] : []), ...m.holdout.predicted.map((p, i) => (m.holdout ? ((100 * (p - m.holdout.actual[i])) / Math.max(1, m.holdout.actual[i])).toFixed(1) : "0"))],
        hovertemplate: `${m.shortName}: %{y:,.0f} (error %{customdata}%)<extra></extra>`,
      });
    }
    return traces;
  }, [res, t]);

  return (
    <PlotlyChart
      data={data}
      height={380}
      filename="bevcast_holdout_actual_vs_predicted"
      ariaLabel="Actual versus predicted units on the hold-out months for every model"
      layout={{
        xaxis: { type: "date", title: { text: "Month" }, tickformat: "%b %Y", hoverformat: "%B %Y" },
        yaxis: { title: { text: "Units sold" }, tickformat: ",.0f" },
        shapes: res.split.testPeriods.length
          ? [{ type: "rect", xref: "x", yref: "paper", x0: `${res.split.trainPeriods[res.split.trainPeriods.length - 1] ?? res.split.testPeriods[0]}-16`, x1: `${res.split.testPeriods[res.split.testPeriods.length - 1]}-16`, y0: 0, y1: 1, fillcolor: t.test, line: { width: 0 }, layer: "below" }]
          : [],
      }}
    />
  );
}
