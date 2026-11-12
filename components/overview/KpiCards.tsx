"use client";

import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Boxes, CalendarRange, Coins, Mountain, Trophy, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EngineResult } from "@/lib/forecast";
import { formatPeriod } from "@/lib/data/parseDates";
import { fmtAed, fmtCompact, fmtInt, fmtPct, isNum } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

function Sparkline({ values, highlight, splitAt, label }: { values: number[]; highlight?: number; splitAt?: number; label: string }) {
  const clean = values.filter(isNum);
  if (clean.length < 2) return <div className="h-9" aria-hidden />;
  const w = 120;
  const h = 36;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const path = (from: number, to: number) => pts.slice(from, to).map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const cut = splitAt ?? values.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" role="img" aria-label={label} preserveAspectRatio="none">
      <path d={path(0, cut)} fill="none" stroke="currentColor" strokeWidth={1.8} className="text-brand" vectorEffect="non-scaling-stroke" />
      {cut < values.length ? <path d={path(cut - 1, values.length)} fill="none" stroke="currentColor" strokeWidth={1.8} strokeDasharray="3 3" className="text-chart-2" vectorEffect="non-scaling-stroke" /> : null}
      {highlight !== undefined && pts[highlight] ? <circle cx={pts[highlight][0]} cy={pts[highlight][1]} r={2.8} className="fill-chart-2" /> : null}
    </svg>
  );
}

function MiniBars({ values, labels, best }: { values: number[]; labels: string[]; best: number }) {
  const max = Math.max(...values.filter(isNum), 1);
  return (
    <div className="flex h-9 items-end gap-[3px]" role="img" aria-label={`Hold-out WAPE by model: ${labels.map((l, i) => `${l} ${values[i].toFixed(1)}%`).join(", ")}`}>
      {values.map((v, i) => (
        <div key={labels[i]} title={`${labels[i]}: ${v.toFixed(1)}%`} className={cn("flex-1 rounded-sm", i === best ? "bg-brand" : "bg-muted-foreground/25")} style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}

function Kpi({ icon, label, value, sub, help, children, tone }: { icon: ReactNode; label: string; value: string; sub: ReactNode; help: string; children: ReactNode; tone?: "up" | "down" }) {
  return (
    <Card size="sm" className="gap-2 px-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger render={<span tabIndex={0} className="flex min-w-0 cursor-help items-center gap-1.5 text-xs font-medium text-muted-foreground" />}>
            {icon}
            <span className="truncate">{label}</span>
          </TooltipTrigger>
          <TooltipContent>{help}</TooltipContent>
        </Tooltip>
        {tone ? tone === "up" ? <ArrowUpRight className="size-4 text-success" aria-hidden /> : <ArrowDownRight className="size-4 text-danger" aria-hidden /> : null}
      </div>
      <div className="tabular truncate text-lg leading-tight font-semibold tracking-tight sm:text-2xl">{value}</div>
      <div className="min-h-4 truncate text-xs text-muted-foreground">{sub}</div>
      {children}
    </Card>
  );
}

export function KpiCards({ res }: { res: EngineResult }) {
  const s = res.summary;
  const ys = res.points.map((p) => p.y);
  const best = res.models.find((m) => m.id === res.bestId);
  const selected = res.models.find((m) => m.id === res.selectedId);
  const fTotal = res.forecast.reduce((a, f) => a + f.forecast, 0);
  const peakIdx = res.points.findIndex((p) => p.period === s.peak?.period);
  const scored = res.models.filter((m) => m.status === "ok" && isNum(m.holdout?.metrics.wape));
  const mom = s.latest?.momPct ?? null;
  const metricLabel = res.settings.rankMetric.toUpperCase();
  const bestMetric = res.settings.rankMetric === "mape" ? best?.holdout?.metrics.mape : best?.holdout?.metrics.wape;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi icon={<Boxes className="size-3.5" aria-hidden />} label="Total units" value={fmtCompact(s.total)} sub={`${res.n} months from ${res.points[0] ? formatPeriod(res.points[0].period) : "n/a"}`} help={`Exact total: ${fmtInt(s.total)} units in scope (${res.scopeRegions.join(", ")}).`}>
        <Sparkline values={ys} label="Monthly units trend" />
      </Kpi>
      <Kpi
        icon={<CalendarRange className="size-3.5" aria-hidden />}
        label="Latest month"
        value={fmtCompact(s.latest?.value)}
        sub={<span>{s.latest ? formatPeriod(s.latest.period) : "n/a"} <span className={cn("font-medium", isNum(mom) && mom >= 0 ? "text-success" : "text-danger")}>{fmtPct(mom, 1, true)} MoM</span></span>}
        tone={isNum(mom) ? (mom >= 0 ? "up" : "down") : undefined}
        help="Units in the most recent month and its change versus the previous month."
      >
        <Sparkline values={ys.slice(-6)} label="Last 6 months" />
      </Kpi>
      <Kpi icon={<Mountain className="size-3.5" aria-hidden />} label="Peak month" value={fmtCompact(s.peak?.value)} sub={`${s.peak ? formatPeriod(s.peak.period) : "n/a"}, ${fmtPct(s.launchToPeakPct, 0, true)} vs launch`} help="Highest monthly volume and growth from the first month to the peak.">
        <Sparkline values={ys} highlight={peakIdx >= 0 ? peakIdx : undefined} label="Peak month marker" />
      </Kpi>
      <Kpi icon={<Trophy className="size-3.5" aria-hidden />} label="Best model" value={best?.shortName ?? "n/a"} sub={`Hold-out ${metricLabel} ${fmtPct(bestMetric, 2)}`} help={`Lowest hold-out ${metricLabel} over ${res.holdoutSize} test month(s). Bars show every fitted model's WAPE.`}>
        {scored.length ? <MiniBars values={scored.map((m) => m.holdout?.metrics.wape ?? 0)} labels={scored.map((m) => m.shortName)} best={scored.findIndex((m) => m.id === res.bestId)} /> : <div className="h-9" />}
      </Kpi>
      <Kpi icon={<TrendingUp className="size-3.5" aria-hidden />} label={`Next ${res.horizon}-month forecast`} value={fmtCompact(fTotal)} sub={`${selected?.shortName ?? "n/a"}${res.forecast[0] ? `, ${formatPeriod(res.forecast[0].period)} ${fmtCompact(res.forecast[0].forecast)}` : ""}`} help={`Sum of the ${res.horizon}-month forecast from ${selected?.name ?? "the selected model"} (exact: ${fmtInt(fTotal)} units).`}>
        <Sparkline values={[...ys.slice(-6), ...res.forecast.map((f) => f.forecast)]} splitAt={Math.min(6, ys.length)} label="Recent actuals and forecast" />
      </Kpi>
      <Kpi
        icon={<Coins className="size-3.5" aria-hidden />}
        label="AED saved vs naive"
        value={res.cost ? `AED ${fmtCompact(res.cost.savings)}` : "n/a"}
        sub={res.cost ? `${fmtPct(res.cost.savingsPct, 0)} lower error cost` : "needs a fitted model"}
        tone={res.cost ? (res.cost.savings >= 0 ? "up" : "down") : undefined}
        help={res.cost ? `Exact saving ${fmtAed(res.cost.savings)}. On the ${res.cost.periods.length} hold-out month(s): waste (over-forecast x AED ${res.cost.unitCost}) plus lost margin (under-forecast x AED ${(res.cost.unitPrice - res.cost.unitCost).toFixed(2)}). Naive costs ${fmtAed(res.cost.naive.total)}, ${selected?.shortName} costs ${fmtAed(res.cost.best.total)}.` : "Not available."}
      >
        {res.cost ? (
          <div className="flex h-9 flex-col justify-center gap-1" role="img" aria-label={`Naive cost ${fmtAed(res.cost.naive.total)}, model cost ${fmtAed(res.cost.best.total)}`}>
            {[
              { l: "Naive", v: res.cost.naive.total, c: "bg-muted-foreground/35" },
              { l: selected?.shortName ?? "Model", v: res.cost.best.total, c: "bg-brand" },
            ].map((b) => (
              <div key={b.l} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="w-12 truncate">{b.l}</span>
                <div className={cn("h-2 rounded-sm", b.c)} style={{ width: `${Math.max(4, (b.v / Math.max(res.cost?.naive.total ?? 1, res.cost?.best.total ?? 1, 1)) * 100)}%` }} />
              </div>
            ))}
          </div>
        ) : (
          <div className="h-9" />
        )}
      </Kpi>
    </div>
  );
}
