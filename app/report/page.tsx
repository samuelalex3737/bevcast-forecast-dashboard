"use client";

import Link from "next/link";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HeroForecastChart } from "@/components/overview/HeroForecastChart";
import { InsightCaption } from "@/components/shared/InsightCaption";
import { useAppStore } from "@/lib/store/useAppStore";
import { useEngine, useRehydrate, useSampleBootstrap } from "@/lib/store/useEngine";
import { useAiController, useInterpretationView } from "@/lib/store/useAiAnalyst";
import { useCaptions, useResult } from "@/lib/store/useResult";
import { checkGrounding, interpretationTexts } from "@/lib/llm/grounding";
import { formatPeriod } from "@/lib/data/parseDates";
import { fmtAed, fmtInt, fmtNum, fmtPct } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-6 mb-2 border-b pb-1 text-[15px] font-semibold">{children}</h2>;
}

export default function ReportPage() {
  useRehydrate();
  useSampleBootstrap();
  useEngine();
  useAiController();
  const res = useResult();
  const captions = useCaptions();
  const label = useAppStore((s) => s.datasetLabel);
  const computing = useAppStore((s) => s.computing);
  const { response, snapshot, stale, loading } = useInterpretationView();
  const interp = !stale ? response?.interpretation : undefined;
  const grounding = interp && snapshot ? checkGrounding(interpretationTexts(interp), snapshot) : null;

  if (!res || !captions) {
    return (
      <div className="flex min-h-dvh items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Preparing the report...
      </div>
    );
  }
  const sel = res.models.find((m) => m.id === res.selectedId);
  const best = res.models.find((m) => m.id === res.bestId);
  const ranked = res.ranking.map((id) => res.models.find((m) => m.id === id)).filter((m) => m !== undefined);

  return (
    <div className="mx-auto max-w-[900px] bg-background px-6 py-6 text-[13px] print:max-w-none print:px-0 print:py-0">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3">
        <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <ArrowLeft className="size-3.5" aria-hidden />
          Back to dashboard
        </Link>
        <p className="text-xs text-muted-foreground">{computing || loading ? "Updating with the latest data..." : "Use Print and choose Save as PDF (A4)."}</p>
        <Button size="sm" onClick={() => window.print()} disabled={res.status !== "ok"}>
          <Printer className="size-3.5" aria-hidden />
          Print / Save PDF
        </Button>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">BevCast forecast report</h1>
          <p className="text-muted-foreground">AI Demand Forecasting - New Flavored Water Launch</p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p>{label}</p>
          <p>Scope: {res.scopeRegions.length === res.regions.length ? "All markets" : res.scopeRegions.join(", ")}</p>
          <p>Generated {new Date().toLocaleString("en-GB")}</p>
        </div>
      </header>

      {res.status !== "ok" ? (
        <p className="mt-8 rounded-lg border border-dashed p-6 text-center">{res.message}</p>
      ) : (
        <>
          <section className="print-avoid mt-5 grid grid-cols-3 gap-2">
            {[
              { l: "Total units", v: fmtInt(res.summary.total), s: `${res.n} months` },
              { l: "Latest month", v: fmtInt(res.summary.latest?.value), s: `${res.summary.latest ? formatPeriod(res.summary.latest.period) : ""} ${fmtPct(res.summary.latest?.momPct, 1, true)} MoM` },
              { l: "Peak month", v: fmtInt(res.summary.peak?.value), s: res.summary.peak ? formatPeriod(res.summary.peak.period) : "" },
              { l: "Best model", v: best?.shortName ?? "n/a", s: `Hold-out WAPE ${fmtPct(best?.holdout?.metrics.wape, 2)}` },
              { l: `Next ${res.horizon} months`, v: fmtInt(res.forecast.reduce((a, f) => a + f.forecast, 0)), s: sel?.shortName ?? "" },
              { l: "Saved vs naive", v: fmtAed(res.cost?.savings), s: `on ${res.cost?.periods.length ?? 0} test months` },
            ].map((k) => (
              <div key={k.l} className="rounded-lg border p-2.5">
                <p className="text-[11px] text-muted-foreground">{k.l}</p>
                <p className="tabular text-lg font-semibold">{k.v}</p>
                <p className="text-[11px] text-muted-foreground">{k.s}</p>
              </div>
            ))}
          </section>

          <H2>Demand history and forecast</H2>
          <div className="print-avoid">
            <HeroForecastChart res={res} height={320} />
            <InsightCaption text={captions.hero} className="mt-2" />
          </div>

          <H2>Model leaderboard (hold-out {res.holdoutSize} months, walk-forward {res.wfOrigins.length} origins)</H2>
          <Table className="tabular print-avoid text-[12px]">
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">MAPE</TableHead>
                <TableHead className="text-right">WAPE</TableHead>
                <TableHead className="text-right">Bias</TableHead>
                <TableHead className="text-right">MASE</TableHead>
                <TableHead className="text-right">WF WAPE</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranked.map((m, i) => (
                <TableRow key={m.id} className={cn(m.id === res.bestId && "bg-success-soft/60 font-medium")}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>{m.shortName}</TableCell>
                  <TableCell className="text-right">{fmtPct(m.holdout?.metrics.mape, 2)}</TableCell>
                  <TableCell className="text-right">{fmtPct(m.holdout?.metrics.wape, 2)}</TableCell>
                  <TableCell className="text-right">{fmtPct(m.holdout?.metrics.bias, 1, true)}</TableCell>
                  <TableCell className="text-right">{fmtNum(m.holdout?.metrics.mase, 2)}</TableCell>
                  <TableCell className="text-right">{fmtPct(m.walkForward?.metrics.wape, 2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <InsightCaption text={captions.leaderboard} className="mt-2" />

          <H2>Production and distribution plan ({sel?.shortName}, {res.settings.serviceLevel}% service level)</H2>
          <Table className="tabular print-avoid text-[12px]">
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Forecast</TableHead>
                <TableHead className="text-right">{res.settings.confidence}% range</TableHead>
                <TableHead className="text-right">Safety stock</TableHead>
                <TableHead className="text-right">Produce</TableHead>
                {res.regional?.regions.map((r) => (
                  <TableHead key={r} className="text-right">
                    {r}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {res.forecast.map((f, i) => (
                <TableRow key={f.period}>
                  <TableCell>{formatPeriod(f.period)}</TableCell>
                  <TableCell className="text-right">{fmtInt(f.forecast)}</TableCell>
                  <TableCell className="text-right">
                    {fmtInt(f.lower)} to {fmtInt(f.upper)}
                  </TableCell>
                  <TableCell className="text-right">{fmtInt(f.safetyStock)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtInt(f.recommended)}</TableCell>
                  {res.regional?.rows[i]?.values.map((v, j) => (
                    <TableCell key={j} className="text-right">
                      {fmtInt(v)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <InsightCaption text={captions.plan} className="mt-2" />

          <div className="print-break" />
          <H2>AI interpretation{response ? ` (${response.source === "llm" ? `${response.provider}/${response.model}` : "rule-based engine"})` : ""}</H2>
          {interp ? (
            <div className="space-y-3">
              {grounding ? <p className="text-xs text-muted-foreground">Grounding: {grounding.verified} of {grounding.total} figures verified against the live data (snapshot {response?.snapshot_id}).</p> : null}
              <p className="text-[14px] leading-relaxed">{interp.executive_summary}</p>
              <div className="print-avoid">
                <p className="font-semibold">How well did the model capture seasonality or trends? ({interp.seasonality_and_trend.verdict})</p>
                <p>{interp.seasonality_and_trend.explanation}</p>
              </div>
              <div className="print-avoid">
                <p className="font-semibold">Which model performed best and why? {interp.best_model.name}</p>
                <p>{interp.best_model.why}</p>
                <p className="text-muted-foreground">Caveats: {interp.best_model.caveats}</p>
                <p className="mt-1">{interp.model_comparison_insight}</p>
              </div>
              <div className="print-avoid">
                <p className="font-semibold">What should the company do?</p>
                <ol className="list-decimal space-y-1 pl-5">
                  {interp.recommendations.map((r, i) => (
                    <li key={i}>
                      <span className="font-medium">[{r.priority}, {r.owner}]</span> {r.action} {r.rationale} <span className="text-muted-foreground">({r.metric_cited})</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="print-avoid grid grid-cols-2 gap-4">
                <div>
                  <p className="font-semibold">Risks</p>
                  <ul className="list-disc pl-5">
                    {interp.risks.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-semibold">Data limitations</p>
                  <ul className="list-disc pl-5">
                    {interp.data_limitations.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Generating the interpretation for the current data...
            </p>
          )}
          <p className="mt-6 text-[11px] text-muted-foreground">All figures computed at runtime from the dataset above by the BevCast engine. {res.n < 24 ? `With ${res.n} months, yearly seasonality cannot be fully identified.` : ""} {label.toLowerCase().includes("sample") ? "The sample dataset is simulated." : ""}</p>
        </>
      )}
    </div>
  );
}
