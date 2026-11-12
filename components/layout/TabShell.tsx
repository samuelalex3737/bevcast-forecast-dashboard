"use client";

import type { ReactNode } from "react";
import { BarChart3, Database, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store/useAppStore";
import { useCaptions, useResult } from "@/lib/store/useResult";
import type { EngineResult } from "@/lib/forecast";
import type { Captions } from "@/lib/insights/captions";

export function Loading({ label = "Training 9 models and an ensemble on the live data..." }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <Loader2 className="size-6 animate-spin text-brand" aria-hidden />
      {label}
    </div>
  );
}

function Blocked({ res }: { res: EngineResult }) {
  const setTab = useAppStore((s) => s.setActiveTab);
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center">
      <BarChart3 className="size-8 text-muted-foreground" aria-hidden />
      <p className="text-base font-semibold">{res.status === "empty" ? "No data in scope" : "At least 4 months are needed to forecast"}</p>
      <p className="max-w-md text-[13px] text-muted-foreground">{res.message} The Data Studio stays fully usable: add months, upload a file or reset to the sample.</p>
      <Button onClick={() => setTab("data-studio")}>
        <Database className="size-4" aria-hidden />
        Open Data Studio
      </Button>
    </div>
  );
}

/** Renders children only when a forecastable result exists; otherwise a loader or the blocking message. */
export function Ready({ children }: { children: (res: EngineResult, c: Captions) => ReactNode }) {
  const res = useResult();
  const captions = useCaptions();
  if (!res || !captions) return <Loading />;
  if (res.status !== "ok") return <Blocked res={res} />;
  return <>{children(res, captions)}</>;
}
