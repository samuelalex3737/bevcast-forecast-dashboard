"use client";

import { Badge } from "@/components/ui/badge";
import type { EngineResult, ModelRun } from "@/lib/forecast";
import { MODEL_COLORS } from "@/lib/insights/palette";
import { fmtInt, fmtNum, fmtPct } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

function fmtParam(k: string, v: number | string): string {
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return "n/a";
  if (k.startsWith("weight_")) return fmtPct(v * 100, 1);
  if (Math.abs(v) >= 100) return fmtInt(v);
  if (Number.isInteger(v)) return String(v);
  return fmtNum(v, 3);
}

function interpretParams(m: ModelRun): string[] {
  const p = m.params;
  const out: string[] = [];
  if (m.id === "regression") {
    const t = Number(p.coef_trend);
    if (Number.isFinite(t)) out.push(`Trend: ${t >= 0 ? "+" : ""}${fmtInt(t)} units per month, holding temperature and promo fixed.`);
    if ("coef_temp" in p) {
      const c = Number(p.coef_temp);
      out.push(`Temperature: each +1 °C ${c >= 0 ? "adds" : "removes"} about ${fmtInt(Math.abs(c))} units (${c >= 0 ? "positive" : "negative"} sign: ${c >= 0 ? "hotter months sell more" : "hotter months sell less"}).`);
    }
    if ("coef_promo" in p) {
      const c = Number(p.coef_promo);
      out.push(`Promo: a promo month is worth ${c >= 0 ? "+" : "-"}${fmtInt(Math.abs(c))} units versus a non-promo month.`);
    }
  }
  if (m.id === "holt") {
    out.push(`alpha ${fmtNum(Number(p.alpha), 2)}: ${Number(p.alpha) > 0.6 ? "the level reacts quickly to new months" : "the level is smoothed over many months"}.`);
    out.push(`phi ${fmtNum(Number(p.phi), 2)}: ${Number(p.phi) < 1 ? "the trend is damped and flattens over the horizon" : "the trend continues undamped"}.`);
  }
  if (m.id === "arima" && m.label) {
    out.push(`${m.label} was chosen by AICc among p, q in 0 to 2 with d = ${p.d} from the variance rule.`);
    if ("drift" in p) out.push(`Drift ${fmtInt(Number(p.drift))} units per month is the average change after differencing.`);
  }
  if (m.id === "ensemble" && m.weights) {
    out.push(`Weights ∝ 1 / hold-out WAPE: ${Object.entries(m.weights).map(([k, w]) => `${k} ${fmtPct((w ?? 0) * 100, 0)}`).join(", ")}.`);
  }
  if (m.id === "rf" || m.id === "gbm") out.push("Predicts month-on-month log growth, then compounds it back to units, so it can extrapolate beyond past volumes.");
  return out;
}

export function ModelCards({ res }: { res: EngineResult }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {res.models.map((m) => {
        const notes = m.status === "ok" ? interpretParams(m) : [];
        const params = Object.entries(m.params).filter(([k]) => !k.startsWith("std_coef_"));
        return (
          <article key={m.id} className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm", m.id === res.selectedId && "ring-2 ring-brand")}>
            <header className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: MODEL_COLORS[m.id] }} aria-hidden />
                  <h4 className="truncate text-sm font-semibold">{m.name}</h4>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {m.family} - needs {m.minObs}+ months
                </p>
              </div>
              <Badge variant={m.status === "ok" ? "secondary" : "outline"} className={cn(m.status === "ok" && "bg-success-soft text-success")}>
                {m.status === "ok" ? "Fitted" : m.status === "disabled" ? "Off" : m.status === "failed" ? "Not fitted" : "Unavailable"}
              </Badge>
            </header>
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Why this model</p>
              <p className="mt-1 text-[13px] leading-relaxed">{m.why}</p>
            </div>
            {m.status !== "ok" ? <p className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">{m.reason}</p> : null}
            {m.label && m.status === "ok" ? <p className="font-mono text-xs break-words text-brand">{m.label}</p> : null}
            {notes.length ? (
              <ul className="list-disc space-y-1 pl-4 text-[12.5px] text-foreground/90">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
            {params.length ? (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Fitted parameters ({params.length})</summary>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  {params.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="truncate text-muted-foreground">{k}</dt>
                      <dd className="tabular truncate text-right font-medium">{fmtParam(k, v)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
