"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import type { Data } from "plotly.js";
import { PlotlyChart } from "@/components/shared/PlotlyChart";
import type { EngineResult } from "@/lib/forecast";
import { chartTheme, MODEL_COLORS } from "@/lib/insights/palette";
import { px } from "@/lib/insights/chartUtils";

/** One-step walk-forward residuals (actual - forecast) per model; only the selected model is shown by default. */
export function ResidualChart({ res }: { res: EngineResult }) {
  const { resolvedTheme } = useTheme();
  const t = chartTheme(resolvedTheme === "dark");
  const data = useMemo(() => {
    const traces: Data[] = [];
    for (const m of res.models) {
      if (m.status !== "ok" || !m.walkForward || !m.walkForward.residuals.length) continue;
      const selected = m.id === res.selectedId;
      traces.push({
        type: "scatter",
        mode: "lines+markers",
        name: m.shortName,
        x: m.walkForward.periods.map(px),
        y: m.walkForward.residuals,
        visible: selected || m.id === "naive" ? true : "legendonly",
        line: { color: MODEL_COLORS[m.id], width: selected ? 3 : 1.6 },
        marker: { size: selected ? 8 : 5 },
        customdata: m.walkForward.predicted.map((p, i) => [p, m.walkForward?.actual[i] ?? 0]),
        hovertemplate: `${m.shortName}: %{y:,.0f} units<br>forecast %{customdata[0]:,.0f} vs actual %{customdata[1]:,.0f}<extra></extra>`,
      });
    }
    return traces;
  }, [res]);

  return (
    <PlotlyChart
      data={data}
      height={320}
      filename="bevcast_walk_forward_residuals"
      ariaLabel="Walk-forward one-step residuals by model over time"
      layout={{
        xaxis: { type: "date", title: { text: "Forecast origin month" }, tickformat: "%b %Y", hoverformat: "%B %Y" },
        yaxis: { title: { text: "Residual (actual - forecast, units)" }, tickformat: ",.0f", zeroline: true, zerolinecolor: t.muted, zerolinewidth: 1.5 },
      }}
    />
  );
}
