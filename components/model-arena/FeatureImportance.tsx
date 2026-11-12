"use client";

import { useMemo } from "react";
import type { Data } from "plotly.js";
import { PlotlyChart } from "@/components/shared/PlotlyChart";
import { EmptyState } from "@/components/shared/Panel";
import type { EngineResult } from "@/lib/forecast";
import { MODEL_COLORS } from "@/lib/insights/palette";
import { FEATURE_DESCRIPTIONS, type FeatureName } from "@/lib/forecast/features";

/** Total split gain per feature (normalised to 100%) for Random Forest and Gradient Boosting. */
export function FeatureImportance({ res }: { res: EngineResult }) {
  const models = res.models.filter((m) => (m.id === "rf" || m.id === "gbm") && m.status === "ok" && m.importance);
  const data = useMemo(() => {
    if (!models.length) return [];
    const features = Object.keys(models[0].importance ?? {});
    const avg = (f: string) => models.reduce((s, m) => s + (m.importance?.[f] ?? 0), 0) / models.length;
    const order = [...features].sort((a, b) => avg(a) - avg(b));
    return models.map<Data>((m) => ({
      type: "bar",
      orientation: "h",
      name: m.shortName,
      y: order,
      x: order.map((f) => m.importance?.[f] ?? 0),
      marker: { color: MODEL_COLORS[m.id] },
      customdata: order.map((f) => FEATURE_DESCRIPTIONS[f as FeatureName] ?? f),
      hovertemplate: `${m.shortName}: %{x:.1f}%<br>%{customdata}<extra></extra>`,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);

  if (!models.length) {
    return <EmptyState title="No tree model fitted">Random Forest and Gradient Boosting need at least 8 months and must be enabled in the Control Panel.</EmptyState>;
  }
  return (
    <PlotlyChart
      data={data}
      height={Math.max(300, 26 * Object.keys(models[0].importance ?? {}).length + 90)}
      filename="bevcast_feature_importance"
      ariaLabel="Horizontal bar chart of feature importance for the tree models"
      layout={{ barmode: "group", hovermode: "y unified", xaxis: { title: { text: "Share of total split gain (%)" }, ticksuffix: "%", rangemode: "tozero" }, yaxis: { title: { text: "Feature" }, type: "category" }, margin: { l: 110, r: 16, t: 8, b: 56 } }}
    />
  );
}
