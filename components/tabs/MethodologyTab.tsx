"use client";

import { Panel } from "@/components/shared/Panel";
import { Loading } from "@/components/layout/TabShell";
import { TaskChecklist } from "@/components/methodology/TaskChecklist";
import { Formulas } from "@/components/methodology/Formulas";
import { Limitations, ModelList, ValidationDesign, Assumptions } from "@/components/methodology/Limitations";
import { useResult } from "@/lib/store/useResult";

export default function MethodologyTab() {
  const res = useResult();
  if (!res) return <Loading />;
  return (
    <>
      <Panel title="Assignment checklist" description="Each task, the evidence computed from the live data, and where it lives">
        <TaskChecklist res={res} />
      </Panel>
      <Panel title="Metric and model formulas">
        <Formulas />
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Validation design">
          <ValidationDesign res={res} />
        </Panel>
        <Panel title="Assumptions">
          <Assumptions />
        </Panel>
      </div>
      <Panel title="Models">
        <ModelList />
      </Panel>
      <Panel title="Limitations">
        <Limitations res={res} />
      </Panel>
    </>
  );
}
