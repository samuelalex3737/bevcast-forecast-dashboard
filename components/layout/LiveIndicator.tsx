"use client";

import { Loader2 } from "lucide-react";
import { useAppStore } from "@/lib/store/useAppStore";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function hhmmss(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((v) => String(v).padStart(2, "0")).join(":");
}

export function LiveIndicator() {
  const computing = useAppStore((s) => s.computing);
  const progress = useAppStore((s) => s.progress);
  const last = useAppStore((s) => s.lastRetrained);
  const ms = useAppStore((s) => s.result?.computeMs);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            role="status"
            aria-live="polite"
            className="flex h-8 shrink-0 items-center gap-2 rounded-full border bg-card px-2.5 text-xs whitespace-nowrap"
          />
        }
      >
        {computing ? (
          <>
            <Loader2 className="size-3.5 animate-spin text-brand" aria-hidden />
            <span className="sr-only font-medium sm:not-sr-only">Retraining...</span>
            {progress ? <span className="hidden text-muted-foreground lg:inline">{progress.stage}</span> : null}
          </>
        ) : (
          <>
            <span className="live-dot size-2 rounded-full bg-success" aria-hidden />
            <span className="sr-only font-medium sm:not-sr-only">Live</span>
            <span className="hidden text-muted-foreground sm:inline">{last ? `Last retrained ${hhmmss(last)}` : "Waiting for data"}</span>
          </>
        )}
      </TooltipTrigger>
      <TooltipContent>
        {computing
          ? `Models are retraining in a background worker (${progress?.pct ?? 0}%). The previous results stay on screen until the new ones are ready.`
          : last
            ? `All models retrained at ${hhmmss(last)} in ${Math.round(ms ?? 0)} ms. Any edit to data or controls retrains everything.`
            : "The engine starts once data is loaded."}
      </TooltipContent>
    </Tooltip>
  );
}
