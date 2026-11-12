"use client";

import { ArrowRight } from "lucide-react";
import type { EngineResult } from "@/lib/forecast";
import { fmtInt } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

/** Task 1: before/after counts for every preprocessing step. */
export function PipelineStepper({ res }: { res: EngineResult }) {
  return (
    <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {res.pipeline.map((s, i) => {
        const changed = s.before !== s.after;
        return (
          <li key={s.id} className="relative flex flex-col gap-1.5 rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-brand-foreground">{i + 1}</span>
              <span className="text-[13px] font-semibold">{s.label}</span>
            </div>
            <div className="tabular flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">{fmtInt(s.before)}</span>
              <ArrowRight className="size-3.5 text-muted-foreground" aria-label="becomes" />
              <span className={cn("font-semibold", changed && "text-brand")}>{fmtInt(s.after)}</span>
              <span className="text-xs text-muted-foreground">{s.unit}</span>
            </div>
            <p className="text-[12px] leading-snug text-muted-foreground">{s.detail}</p>
          </li>
        );
      })}
    </ol>
  );
}
