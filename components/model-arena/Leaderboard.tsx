"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Download, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberCell } from "@/components/shared/NumberCell";
import { useAppStore } from "@/lib/store/useAppStore";
import type { EngineResult, ModelRun } from "@/lib/forecast";
import { MODEL_COLORS } from "@/lib/insights/palette";
import { fmtNum, fmtPct } from "@/lib/utils/format";
import { downloadText, metricsCsv, yyyymmdd } from "@/lib/utils/download";
import { cn } from "@/lib/utils";

type SortKey = "rank" | "name" | "family" | "hMape" | "hWape" | "bias" | "rmse" | "mase" | "wMape" | "wWape";

const COLS: { key: SortKey; label: string; title: string; numeric: boolean }[] = [
  { key: "rank", label: "#", title: "Rank by the primary metric on the hold-out", numeric: true },
  { key: "name", label: "Model", title: "Model", numeric: false },
  { key: "family", label: "Family", title: "Model family", numeric: false },
  { key: "hMape", label: "MAPE", title: "Hold-out MAPE (%)", numeric: true },
  { key: "hWape", label: "WAPE", title: "Hold-out WAPE (%)", numeric: true },
  { key: "bias", label: "Bias", title: "Hold-out bias % (positive = over-forecast)", numeric: true },
  { key: "rmse", label: "RMSE", title: "Hold-out RMSE (units)", numeric: true },
  { key: "mase", label: "MASE", title: "Hold-out MASE (< 1 beats in-sample naive)", numeric: true },
  { key: "wMape", label: "WF MAPE", title: "Walk-forward one-step MAPE (%)", numeric: true },
  { key: "wWape", label: "WF WAPE", title: "Walk-forward one-step WAPE (%)", numeric: true },
];

function value(m: ModelRun, key: SortKey, rank: number | null): number | string | null {
  switch (key) {
    case "rank": return rank;
    case "name": return m.shortName;
    case "family": return m.family;
    case "hMape": return m.holdout?.metrics.mape ?? null;
    case "hWape": return m.holdout?.metrics.wape ?? null;
    case "bias": return m.holdout?.metrics.bias ?? null;
    case "rmse": return m.holdout?.metrics.rmse ?? null;
    case "mase": return m.holdout?.metrics.mase ?? null;
    case "wMape": return m.walkForward?.metrics.mape ?? null;
    case "wWape": return m.walkForward?.metrics.wape ?? null;
  }
}

export function Leaderboard({ res }: { res: EngineResult }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "rank", dir: 1 });
  const setSettings = useAppStore((s) => s.setSettings);
  const rankOf = (id: ModelRun["id"]) => {
    const i = res.ranking.indexOf(id);
    return i >= 0 ? i + 1 : null;
  };
  const rows = [...res.models].sort((a, b) => {
    const va = value(a, sort.key, rankOf(a.id));
    const vb = value(b, sort.key, rankOf(b.id));
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * sort.dir;
    return (sort.key === "bias" ? Math.abs(va) - Math.abs(vb) : va - vb) * sort.dir;
  });

  const choose = (m: ModelRun) => {
    if (m.status !== "ok") {
      toast.message(`${m.shortName} cannot be selected`, { description: m.reason ?? "It was not fitted." });
      return;
    }
    setSettings({ selectedModel: m.id });
    toast.success(`${m.shortName} now drives the forecast, plan and AI analysis`);
  };

  const pctCell = (v: number | null | undefined, reason: string) => <NumberCell value={v} format={(x) => fmtPct(x, 2)} naReason={reason} />;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted-foreground">Click a row to use that model everywhere. Sorting by Bias uses its absolute value.</p>
        <div className="flex gap-2">
          {res.settings.selectedModel !== "auto" ? (
            <Button size="sm" variant="ghost" onClick={() => setSettings({ selectedModel: "auto" })}>
              Back to Auto
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => (downloadText(`bevcast_metrics_${yyyymmdd()}.csv`, metricsCsv(res)) ? toast.success("Metrics downloaded") : toast.error("Download failed"))}
          >
            <Download className="size-3.5" aria-hidden />
            Metrics CSV
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table className="tabular text-[13px]">
          <TableHeader>
            <TableRow className="bg-muted/40">
              {COLS.map((c) => (
                <TableHead key={c.key} className={cn(c.numeric && c.key !== "rank" ? "text-right" : "", c.key === "family" && "hidden md:table-cell")}>
                  <button
                    type="button"
                    title={c.title}
                    className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                    onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? ((s.dir * -1) as 1 | -1) : 1 }))}
                    aria-label={`Sort by ${c.title}`}
                  >
                    {c.label}
                    {sort.key === c.key ? sort.dir === 1 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : <ArrowUpDown className="size-3 opacity-40" aria-hidden />}
                  </button>
                </TableHead>
              ))}
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => {
              const rank = rankOf(m.id);
              const best = m.id === res.bestId;
              const selected = m.id === res.selectedId;
              const na = m.status === "ok" ? "Not computable (for example zero actuals or too few origins)" : m.reason ?? "Model not fitted";
              return (
                <TableRow
                  key={m.id}
                  onClick={() => choose(m)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), choose(m))}
                  tabIndex={0}
                  aria-selected={selected}
                  className={cn("cursor-pointer", best && "bg-success-soft/60 hover:bg-success-soft", selected && "ring-2 ring-brand ring-inset", m.status !== "ok" && "opacity-60")}
                >
                  <TableCell className="font-medium">{rank ?? "-"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <span className="size-2.5 rounded-full" style={{ background: MODEL_COLORS[m.id] }} aria-hidden />
                      <span className="font-medium">{m.shortName}</span>
                      {best ? <Trophy className="size-3.5 text-success" aria-label="Best model" /> : null}
                      {selected ? <Check className="size-3.5 text-brand" aria-label="Selected model" /> : null}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{m.family}</TableCell>
                  <TableCell className="text-right">{pctCell(m.holdout?.metrics.mape, na)}</TableCell>
                  <TableCell className="text-right font-semibold">{pctCell(m.holdout?.metrics.wape, na)}</TableCell>
                  <TableCell className="text-right">{<NumberCell value={m.holdout?.metrics.bias} format={(x) => fmtPct(x, 1, true)} naReason={na} />}</TableCell>
                  <TableCell className="text-right"><NumberCell value={m.holdout?.metrics.rmse} format={(x) => Math.round(x).toLocaleString("en-US")} naReason={na} /></TableCell>
                  <TableCell className="text-right"><NumberCell value={m.holdout?.metrics.mase} format={(x) => fmtNum(x, 2)} naReason={m.status === "ok" ? "In-sample naive error is zero" : na} /></TableCell>
                  <TableCell className="text-right">{pctCell(m.walkForward?.metrics.mape, m.status === "ok" ? "Too few walk-forward origins" : na)}</TableCell>
                  <TableCell className="text-right">{pctCell(m.walkForward?.metrics.wape, m.status === "ok" ? "Too few walk-forward origins" : na)}</TableCell>
                  <TableCell>
                    {m.status === "ok" ? (
                      <Badge variant="secondary" className="bg-success-soft text-success">
                        Fitted{m.holdout && m.holdout.metrics.mapeSkipped > 0 ? `, MAPE skipped ${m.holdout.metrics.mapeSkipped} zero` : ""}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="block max-w-[240px] justify-start truncate text-left" title={m.reason ?? undefined}>
                        {m.status === "failed" ? m.reason : m.status === "disabled" ? "Off" : m.reason}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
