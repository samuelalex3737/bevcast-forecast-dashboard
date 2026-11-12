"use client";

import { Panel } from "@/components/shared/Panel";
import { DataUploader } from "@/components/data-studio/DataUploader";
import { EditableGrid } from "@/components/data-studio/EditableGrid";
import { DataHealth } from "@/components/data-studio/DataHealth";
import { PipelineStepper } from "@/components/data-studio/PipelineStepper";
import { FeatureTable } from "@/components/data-studio/FeatureTable";
import { DriverCharts } from "@/components/data-studio/DriverCharts";
import { useCaptions, useResult } from "@/lib/store/useResult";

/** Always usable, even when there is too little data to forecast. */
export default function DataStudioTab() {
  const res = useResult();
  const captions = useCaptions();
  return (
    <>
      <Panel title="Load and edit data" description="Upload, paste, edit any cell, add next month's actual, reset or download. Every change retrains everything.">
        <DataUploader />
      </Panel>
      {res && captions ? (
        <>
          <Panel id="health" title="Data Health" caption={captions.health}>
            <DataHealth res={res} />
          </Panel>
          <Panel id="pipeline" title="Preprocessing pipeline" description="Row counts before and after every step (Task 1)" caption={captions.pipeline}>
            <PipelineStepper res={res} />
          </Panel>
        </>
      ) : null}
      <Panel id="grid" title="Data grid" description="Click any cell to edit. Blank units become missing months.">
        <EditableGrid />
      </Panel>
      {res && captions && res.n > 0 ? (
        <>
          <Panel id="features" title="Engineered features" description="Values per month; hover a column name for its definition" caption={captions.features}>
            <FeatureTable res={res} />
          </Panel>
          <DriverCharts res={res} captions={captions} />
        </>
      ) : null}
    </>
  );
}
