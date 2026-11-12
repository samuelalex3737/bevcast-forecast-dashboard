"use client";

import { Panel } from "@/components/shared/Panel";
import { Ready } from "@/components/layout/TabShell";
import { HoldoutChart } from "@/components/forecast-lab/HoldoutChart";
import { SplitTimeline } from "@/components/forecast-lab/SplitTimeline";
import { ScenarioPlanner } from "@/components/forecast-lab/ScenarioPlanner";

export default function ForecastLabTab() {
  return (
    <Ready>
      {(r, c) => (
        <>
          <Panel id="holdout" title="Actual vs predicted on the hold-out" description="Every fitted model forecasting the hidden test months recursively. Click legend items to show or hide models." caption={c.holdout}>
            <HoldoutChart res={r} />
          </Panel>
          <Panel id="split" title="Train / test / forecast split" description="Chronological split with walk-forward origins" caption={c.split}>
            <SplitTimeline res={r} />
          </Panel>
          <Panel id="scenario" title="Scenario Planner" description="Edit future temperature and promo; driver-based models update live versus the base case" caption={c.scenario}>
            <ScenarioPlanner res={r} />
          </Panel>
        </>
      )}
    </Ready>
  );
}
