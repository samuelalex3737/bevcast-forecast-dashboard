"use client";

import { Panel } from "@/components/shared/Panel";
import { Ready } from "@/components/layout/TabShell";
import { InterpretationPanel, StatusBar } from "@/components/ai-analyst/InterpretationPanel";
import { AskAnalyst } from "@/components/ai-analyst/AskAnalyst";
import { PayloadViewer } from "@/components/ai-analyst/PayloadViewer";

export default function AiAnalystTab() {
  return (
    <Ready>
      {() => (
        <>
          <StatusBar />
          <div id="interpretation" className="scroll-mt-28">
            <InterpretationPanel />
          </div>
          <Panel title="Ask the Analyst" description="Free-text questions answered from the same live snapshot">
            <AskAnalyst />
          </Panel>
          <PayloadViewer />
        </>
      )}
    </Ready>
  );
}
