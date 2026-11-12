import type { Interpretation, Recommendation, Snapshot } from "./schema";
import { formatPeriod } from "@/lib/data/parseDates";

/**
 * Deterministic, rule-based analyst. Produces the same schema as the LLM from the same snapshot,
 * so the AI Analyst tab is never empty. Every figure it quotes is copied from the snapshot.
 */

const P = (p: string | undefined | null) => (p ? formatPeriod(p, "short") : "n/a");
const int = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : "n/a");
const pc = (v: number | null | undefined, signed = false) => (typeof v === "number" && Number.isFinite(v) ? `${signed && v > 0 ? "+" : ""}${v.toFixed(2)}%` : "n/a");
const num = (v: number | null | undefined, d = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "n/a");

const DRIVER_MODELS = new Set(["Regression", "Random Forest", "Gradient Boosting"]);
const FLAT_MODELS = new Set(["Naive", "Moving Avg"]);

export function ruleBasedInterpretation(s: Snapshot): Interpretation {
  const ss = s.summary_stats;
  const fitted = s.leaderboard.filter((r) => r.rank !== null);
  const best = fitted[0];
  const naive = s.leaderboard.find((r) => r.model === "Naive");
  const second = fitted[1];
  const f0 = s.forecast[0];
  const metricName = s.ranking_metric;
  const bestMetric = best ? (metricName === "MAPE" ? best.holdout_mape : best.holdout_wape) : null;
  const sel = s.selected_model?.name ?? best?.model ?? "the selected model";
  const r = ss.temp_sales_pearson_r;
  const topRegion = [...s.regional_allocation].sort((a, b) => b.share_pct - a.share_pct)[0];
  const lastChange = ss.last3_change_pct;
  const declining = typeof lastChange === "number" && lastChange < 0;

  // Executive summary (3 sentences)
  const s1 =
    ss.peak && ss.launch_to_peak_growth_pct !== null
      ? `Sales grew ${pc(ss.launch_to_peak_growth_pct)} from launch to a peak of ${int(ss.peak.units)} units in ${P(ss.peak.period)}${typeof lastChange === "number" ? `, and the last 3 months changed ${pc(lastChange, true)} overall` : ""}.`
      : `The series has ${s.n_periods} months totalling ${int(ss.total)} units.`;
  const s2 = best
    ? `${best.model} is the most accurate model on the ${s.split.holdout_size}-month hold-out (${metricName} ${pc(bestMetric)}${best.model !== "Naive" && best.wape_gap_vs_naive_pts !== null ? `, ${num(Math.abs(best.wape_gap_vs_naive_pts))} WAPE points ${best.wape_gap_vs_naive_pts >= 0 ? "better" : "worse"} than Naive` : ""}), and ${sel} forecasts ${int(s.forecast_total)} units over the next ${s.forecast.length} month(s).`
    : "No model could be scored on the hold-out.";
  const s3 = f0
    ? `Plan ${int(f0.recommended_production)} units for ${P(f0.period)} (forecast ${int(f0.forecast)} plus ${int(f0.safety_stock)} safety stock at a ${s.service_level_pct}% service level)${s.cost_of_error && s.cost_of_error.saved_aed > 0 ? `, an approach that cut forecast-error cost by AED ${int(s.cost_of_error.saved_aed)} versus naive planning on the test months` : ""}.`
    : "No forecast is available yet.";

  // Seasonality verdict
  let verdict: Interpretation["seasonality_and_trend"]["verdict"] = "partially captured";
  let explanation: string;
  const bestBias = best?.bias_pct ?? null;
  if (s.n_periods >= 24 && best && (best.model === "Seasonal Naive" || /\[12\]/.test(s.best_model?.label ?? "")) && (bestMetric ?? 100) < 10) {
    verdict = "captured";
    explanation = `With ${s.n_periods} months the yearly cycle can be estimated, and ${best.model} (${s.best_model?.label}) reaches a hold-out ${metricName} of ${pc(bestMetric)}, so the seasonal pattern is being reproduced.`;
  } else if (best && FLAT_MODELS.has(best.model)) {
    verdict = "not captured";
    explanation = `The winning model, ${best.model}, holds a flat level, so it captures neither trend nor seasonality; it wins because the test months (${s.split.test_range}) sit on a plateau after the ${ss.peak ? P(ss.peak.period) : "summer"} peak. With only ${s.n_periods} months, one launch year cannot separate seasonality from launch growth${typeof r === "number" ? `, even though temperature and sales are strongly linked (r = ${num(r, 3)})` : ""}.`;
  } else if (best && DRIVER_MODELS.has(best.model)) {
    verdict = Math.abs(bestBias ?? 100) < 10 ? "partially captured" : "not captured";
    explanation = `${best.model} uses temperature and promo as drivers, which proxies the seasonal cycle${typeof r === "number" ? ` (temperature-sales r = ${num(r, 3)})` : ""}; its hold-out bias of ${pc(bestBias, true)} shows how well the turn after the peak was anticipated. True yearly seasonality needs at least 24 months to confirm.`;
  } else {
    explanation = `${best?.model ?? "The best model"} follows the trend (hold-out bias ${pc(bestBias, true)}), but with ${s.n_periods} months the yearly seasonal shape cannot be identified separately from launch growth.`;
  }

  // Comparison
  const families = new Map<string, (typeof fitted)[number]>();
  for (const row of fitted) if (!families.has(row.family)) families.set(row.family, row);
  const famText = Array.from(families.values()).map((row) => `${row.family} best: ${row.model} (${pc(metricName === "MAPE" ? row.holdout_mape : row.holdout_wape)})`).join("; ");
  const wfBest = [...fitted].filter((row) => row.wf_wape !== null).sort((a, b) => (a.wf_wape ?? 1e9) - (b.wf_wape ?? 1e9))[0];
  const mlRows = fitted.filter((row) => row.family === "Machine Learning");
  const comparison = `${famText}. ${wfBest && best && wfBest.model !== best.model ? `On one-step walk-forward validation ${wfBest.model} is best (WAPE ${pc(wfBest.wf_wape)}), so the ranking depends on the evaluation window. ` : ""}${mlRows.length ? `The machine-learning models (${mlRows.map((m) => `${m.model} ${pc(m.holdout_wape)}`).join(", ")}) learned only the growth phase, so recursive multi-step forecasts over the hold-out overshoot when demand turns.` : ""}`.trim();

  // Recommendations
  const recs: Recommendation[] = [];
  if (f0) {
    recs.push({
      action: `Schedule ${int(f0.recommended_production)} units of production for ${P(f0.period)}.`,
      rationale: `Covers the ${sel} forecast of ${int(f0.forecast)} plus ${int(f0.safety_stock)} safety stock, sized for a ${s.service_level_pct}% service level from walk-forward error.`,
      metric_cited: `Forecast ${int(f0.forecast)}; ${s.confidence_level_pct}% range ${int(f0.lower)} to ${int(f0.upper)}`,
      priority: "high",
      owner: "Production",
    });
  }
  if (topRegion && f0) {
    recs.push({
      action: `Allocate about ${int(topRegion.next_month_units)} units to ${topRegion.region} in ${P(f0.period)} and split the rest by recent share.`,
      rationale: `${topRegion.region} holds ${pc(topRegion.share_pct)} of recent volume, so stock-outs there cost the most margin.`,
      metric_cited: `${topRegion.region} share ${pc(topRegion.share_pct)}`,
      priority: "high",
      owner: "Distribution",
    });
  }
  const decPromo = s.scenario.future_promo.find((p) => p.period.endsWith("-12"));
  if (ss.promo_lift_pct !== null) {
    recs.push({
      action: ss.promo_lift_pct > 0 ? `Keep the planned promotions${decPromo && decPromo.promo === 1 ? " including December" : ""} to cushion the seasonal slowdown.` : "Review the promo calendar: promotions are not lifting volume after controlling for trend and temperature.",
      rationale: `The driver regression estimates a promo month changes volume by ${pc(ss.promo_lift_pct)} of an average month.`,
      metric_cited: `Promo lift ${pc(ss.promo_lift_pct)}`,
      priority: "medium",
      owner: "Marketing",
    });
  }
  if (s.cost_of_error) {
    recs.push({
      action: `Plan with ${best?.model ?? sel} rather than last-month (naive) volumes.`,
      rationale: `On the ${s.cost_of_error.test_months} test months its forecast errors cost AED ${int(s.cost_of_error.best_model_cost_aed)} versus AED ${int(s.cost_of_error.naive_cost_aed)} for naive planning.`,
      metric_cited: `AED ${int(s.cost_of_error.saved_aed)} saved (${pc(s.cost_of_error.saved_pct)})`,
      priority: "medium",
      owner: "Production",
    });
  }
  recs.push({
    action: "Retrain monthly as each new actual arrives and track WAPE against this baseline.",
    rationale: `Only ${s.n_periods} months are available, so each new month materially changes the model ranking and the seasonal estimate.`,
    metric_cited: `${metricName} of best model ${pc(bestMetric)}`,
    priority: "medium",
    owner: "Data/Analytics",
  });
  if (typeof r === "number" && Math.abs(r) >= 0.4) {
    recs.push({
      action: "Feed 3-month temperature outlooks into the Scenario Planner before each production run.",
      rationale: `Temperature is a key demand driver in this data (r = ${num(r, 3)}), so weather surprises translate directly into forecast error.`,
      metric_cited: `Pearson r ${num(r, 3)}`,
      priority: "low",
      owner: "Data/Analytics",
    });
  }
  while (recs.length < 4) {
    recs.push({
      action: "Hold a monthly S&OP review of the forecast against actuals.",
      rationale: "Joint review between production and sales catches demand shifts earlier than the model alone.",
      metric_cited: `Hold-out ${metricName} ${pc(bestMetric)}`,
      priority: "low",
      owner: "Production",
    });
  }

  // Risks
  const risks: string[] = [];
  if (f0) risks.push(`Wide uncertainty: the ${s.confidence_level_pct}% interval for ${P(f0.period)} spans ${int(f0.lower)} to ${int(f0.upper)} units, so under-stocking is possible even with safety stock.`);
  if (declining) risks.push(`Demand is falling: the last 3 months changed ${pc(lastChange, true)}, and a cooler winter could push volumes below the ${sel} forecast.`);
  if (typeof bestBias === "number" && Math.abs(bestBias) >= 5) risks.push(`${best?.model} showed a ${pc(bestBias, true)} bias on the hold-out, so it systematically ${bestBias > 0 ? "over" : "under"}-forecasts.`);
  if (s.data_quality_warnings.length) risks.push(`Data quality: ${s.data_quality_warnings[0]}`);
  if (risks.length < 2) risks.push(`Model risk: with ${s.split.holdout_size} test month(s), the accuracy estimate itself is uncertain.`);
  if (risks.length < 2) risks.push("Competitive or pricing changes are not in the data and could shift demand.");

  const limitations: string[] = [
    `${s.n_periods} months of history: one launch year cannot identify true yearly seasonality separately from launch-phase growth.`,
    "Lag features consume the first 2 months, so tree models train on fewer rows than the statistical models.",
    "Hold-out scores use realised temperatures for the test months; real forecasts rely on temperature assumptions.",
  ];
  if (/sample|simulated/i.test(s.dataset_label)) limitations.unshift("The sample dataset is simulated, so conclusions illustrate the method rather than real market behaviour.");
  for (const w of s.data_quality_warnings.slice(0, 2)) limitations.push(w);

  const nextSteps = [
    "Add each new month with the \"Add next month's actual\" form and let the models retrain.",
    "Collect a second year of data, then enable Seasonal Naive and seasonal ARIMA to test the yearly cycle.",
    "Add price, distribution points and competitor activity as drivers in the regression and tree models.",
    "Replace historical-average temperatures with official 3-month weather outlooks in the Scenario Planner.",
  ];

  return {
    executive_summary: [s1, s2, s3].join(" "),
    seasonality_and_trend: { verdict, explanation },
    best_model: {
      name: best?.model ?? "None",
      why: best
        ? `${best.model} has the lowest hold-out ${metricName} (${pc(bestMetric)})${second ? `, ahead of ${second.model} (${pc(metricName === "MAPE" ? second.holdout_mape : second.holdout_wape)})` : ""}. ${s.best_model?.why ?? ""}`.trim()
        : "No model could be fitted.",
      caveats: `The hold-out covers only ${s.split.holdout_size} month(s) (${s.split.test_range}), so the ranking is fragile${naive && best && naive.model !== best.model ? `; Naive scored ${pc(naive.holdout_wape)} WAPE on the same months` : ""}.${best?.model === "Ensemble" ? " The ensemble's members and weights were chosen on the same hold-out, so its score is optimistic." : ""}`,
    },
    model_comparison_insight: comparison || "Only one model could be compared.",
    recommendations: recs.slice(0, 6),
    risks: risks.slice(0, 4),
    data_limitations: limitations.slice(0, 8),
    next_steps: nextSteps,
  };
}

export function ruleBasedAnswer(s: Snapshot, question: string): string {
  const q = question.toLowerCase();
  const f0 = s.forecast[0];
  const best = s.leaderboard.find((r) => r.rank === 1);
  if (/promo|december|campaign|discount/.test(q)) {
    const lift = s.summary_stats.promo_lift_pct;
    return lift === null
      ? "The dataset has no promo variation, so the promo effect cannot be estimated."
      : `Controlling for trend and temperature, a promo month is associated with a ${pc(lift)} change in volume relative to an average month. Toggle the promo for any future month in the Scenario Planner to see the forecast impact for driver-based models (Regression, Random Forest, Gradient Boosting).`;
  }
  if (/temp|weather|heat|cool|winter|summer/.test(q)) {
    const r = s.summary_stats.temp_sales_pearson_r;
    return r === null ? "No temperature data is available." : `Temperature and sales have a Pearson correlation of ${num(r, 3)}. Future temperatures assumed: ${s.scenario.future_temp.map((t) => `${P(t.period)} ${t.temp_c ?? "n/a"} °C`).join(", ")}.`;
  }
  if (/region|dubai|abu|sharjah|ain|allocat|distribut/.test(q)) {
    return `Next-month allocation: ${s.regional_allocation.map((a) => `${a.region} ${int(a.next_month_units)} units (${pc(a.share_pct)})`).join("; ")}.`;
  }
  if (/model|best|accura|wape|mape/.test(q)) {
    return best ? `${best.model} ranks first with hold-out WAPE ${pc(best.holdout_wape)} and MAPE ${pc(best.holdout_mape)}; walk-forward WAPE is ${pc(best.wf_wape)}.` : "No model has been scored yet.";
  }
  if (f0) return `For ${P(f0.period)} the forecast is ${int(f0.forecast)} units (${s.confidence_level_pct}% range ${int(f0.lower)} to ${int(f0.upper)}), with recommended production of ${int(f0.recommended_production)}. Configure an LLM key for free-form answers.`;
  return "Not enough data to answer yet. Add at least 4 months in the Data Studio.";
}
