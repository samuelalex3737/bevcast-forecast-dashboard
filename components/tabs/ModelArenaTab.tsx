"use client";

import { Panel } from "@/components/shared/Panel";
import { Ready } from "@/components/layout/TabShell";
import { Leaderboard } from "@/components/model-arena/Leaderboard";
import { MetricBars } from "@/components/model-arena/MetricBars";
import { ResidualChart } from "@/components/model-arena/ResidualChart";
import { FeatureImportance } from "@/components/model-arena/FeatureImportance";
import { ModelCards } from "@/components/model-arena/ModelCards";

export default function ModelArenaTab() {
  return (
    <Ready>
      {(r, c) => (
        <>
          <Panel id="leaderboard" title="Leaderboard" description={`Hold-out (${r.holdoutSize} months) and walk-forward (${r.wfOrigins.length} origins) metrics. Best row highlighted in green.`} caption={c.leaderboard}>
            <Leaderboard res={r} />
          </Panel>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="MAPE vs WAPE, hold-out vs walk-forward" caption={c.metricBars}>
              <MetricBars res={r} />
            </Panel>
            <Panel title="Walk-forward residuals" description="Selected model and Naive shown; click the legend to add others" caption={c.residuals}>
              <ResidualChart res={r} />
            </Panel>
          </div>
          <Panel title="Feature importance" description="Share of total split gain, Random Forest and Gradient Boosting" caption={c.importance}>
            <FeatureImportance res={r} />
          </Panel>
          <Panel id="model-cards" title="Model cards" description="Why each model is in the arena, and its fitted parameters" caption={c.modelCards}>
            <ModelCards res={r} />
          </Panel>
        </>
      )}
    </Ready>
  );
}
