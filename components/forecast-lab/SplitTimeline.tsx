"use client";

import type { EngineResult } from "@/lib/forecast";
import { formatPeriod } from "@/lib/data/parseDates";
import { cn } from "@/lib/utils";

/** Train / test / forecast blocks with month labels (chronological split, never random). */
export function SplitTimeline({ res }: { res: EngineResult }) {
  const blocks = [
    ...res.split.trainPeriods.map((p) => ({ p, kind: "train" as const })),
    ...res.split.testPeriods.map((p) => ({ p, kind: "test" as const })),
    ...res.split.futurePeriods.map((p) => ({ p, kind: "future" as const })),
  ];
  const wfSet = new Set(res.wfOrigins);
  const style = {
    train: "bg-muted-foreground/20 text-foreground",
    test: "bg-chart-2/80 text-black",
    future: "border-2 border-dashed border-brand bg-brand-soft text-brand",
  };
  const legend = [
    { k: "train", label: `Train (${res.split.trainPeriods.length})`, c: "bg-muted-foreground/30" },
    { k: "test", label: `Test / hold-out (${res.split.testPeriods.length})`, c: "bg-chart-2/80" },
    { k: "future", label: `Forecast (${res.split.futurePeriods.length})`, c: "border-2 border-dashed border-brand bg-brand-soft" },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs">
        {legend.map((l) => (
          <span key={l.k} className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded-sm", l.c)} aria-hidden />
            {l.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-brand" aria-hidden />
          Walk-forward origin ({res.wfOrigins.length})
        </span>
      </div>
      <div className="overflow-x-auto pb-1">
        <ol className="flex min-w-max gap-1" aria-label="Chronological split timeline">
          {blocks.map((b) => (
            <li
              key={`${b.kind}-${b.p}`}
              className={cn("relative flex h-12 w-14 flex-col items-center justify-center rounded-md text-[11px] leading-tight font-medium", style[b.kind])}
              aria-label={`${formatPeriod(b.p, "long")}: ${b.kind === "future" ? "forecast" : b.kind}${wfSet.has(b.p) ? ", walk-forward origin" : ""}`}
            >
              <span>{formatPeriod(b.p).split(" ")[0]}</span>
              <span className="text-[10px] opacity-75">{b.p.slice(0, 4)}</span>
              {wfSet.has(b.p) ? <span className="absolute top-1 right-1 size-1.5 rounded-full bg-brand" aria-hidden /> : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
