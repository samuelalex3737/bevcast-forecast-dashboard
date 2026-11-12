"use client";

import { ArrowRight, CheckCircle2, CircleDashed } from "lucide-react";
import type { EngineResult } from "@/lib/forecast";
import type { TabId } from "@/lib/store/useAppStore";
import { goTo } from "@/lib/store/navigation";
import { useInterpretationView } from "@/lib/store/useAiAnalyst";
import { fmtPct } from "@/lib/utils/format";
import { shortName } from "@/lib/forecast/models/registry";

interface Item {
  id: string;
  task: string;
  done: boolean;
  evidence: string;
  tab: TabId;
  anchor: string;
  where: string;
}

export function TaskChecklist({ res }: { res: EngineResult }) {
  const { response } = useInterpretationView();
  const fitted = res.models.filter((m) => m.status === "ok");
  const families = new Set(fitted.map((m) => m.family));
  const best = res.models.find((m) => m.id === res.bestId);
  const items: Item[] = [
    { id: "t1", task: "Task 1 - Preprocess: lag features and seasonal indicators", done: res.pipeline.length > 0 && res.features.names.length > 0, evidence: `${res.pipeline.length} pipeline steps; ${res.features.names.length} features incl. lag_1, lag_2, roll_mean_3, month_sin/cos, quarter, trend, drivers.`, tab: "data-studio", anchor: "pipeline", where: "Data Studio: Preprocessing pipeline and Engineered features" },
    { id: "t2", task: "Task 2 - Choose forecasting models (Naive, ARIMA, ML)", done: fitted.length >= 2, evidence: `${fitted.length} models fitted across ${families.size} families (${Array.from(families).join(", ")}), each with a written justification.`, tab: "model-arena", anchor: "model-cards", where: "Model Arena: model cards" },
    { id: "t3", task: "Task 3 - Train and test with an appropriate split", done: res.split.testPeriods.length > 0, evidence: `Chronological hold-out of ${res.holdoutSize} month(s) plus ${res.wfOrigins.length} expanding-window walk-forward origins.`, tab: "forecast-lab", anchor: "split", where: "Forecast Lab: split timeline" },
    { id: "t4", task: "Task 4 - Forecast the next 3 months", done: res.forecast.length > 0, evidence: `${res.forecast.length}-month recursive forecast with ${res.settings.confidence}% intervals from ${shortName(res.selectedId ?? "naive")}, refit on all ${res.n} months.`, tab: "overview", anchor: "hero", where: "Overview: hero chart and production plan" },
    { id: "t5", task: "Task 5 - Evaluate with MAPE and WAPE", done: Boolean(best?.holdout), evidence: `Best hold-out WAPE ${fmtPct(best?.holdout?.metrics.wape, 2)}, MAPE ${fmtPct(best?.holdout?.metrics.mape, 2)}; plus Bias, RMSE, MAE and MASE for every model.`, tab: "model-arena", anchor: "leaderboard", where: "Model Arena: leaderboard" },
    { id: "t6", task: "Task 6 - Plot actual vs predicted", done: fitted.length > 0, evidence: "Interactive Plotly charts of history, hold-out predictions per model and the future forecast with 80% and 95% bands.", tab: "forecast-lab", anchor: "holdout", where: "Forecast Lab: actual vs predicted" },
    { id: "t7", task: "Task 7 - Interpret: seasonality, best model, recommendations", done: Boolean(response?.interpretation), evidence: "A data-driven caption under every chart, plus the AI Analyst answering the three questions explicitly.", tab: "ai-analyst", anchor: "interpretation", where: "AI Analyst tab and every chart caption" },
    { id: "llm", task: "LLM interpretation based on real-time data", done: Boolean(response?.interpretation), evidence: response ? `${response.source === "llm" ? `${response.provider}/${response.model}` : "Rule-based fallback"} on snapshot ${response.snapshot_id}; regenerates whenever the data or controls change, and every figure is grounding-checked.` : "Waiting for the first interpretation.", tab: "ai-analyst", anchor: "interpretation", where: "AI Analyst tab and Overview summary" },
  ];
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 gap-2.5">
            {it.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-label="Satisfied" /> : <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-label="Pending" />}
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold">{it.task}</p>
              <p className="text-[12.5px] text-muted-foreground">{it.evidence}</p>
            </div>
          </div>
          <button type="button" onClick={() => goTo(it.tab, it.anchor)} className="inline-flex shrink-0 items-center gap-1 self-start rounded-md px-2 py-1 text-[12.5px] font-medium text-brand hover:bg-brand-soft sm:self-center">
            {it.where}
            <ArrowRight className="size-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}
