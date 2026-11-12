import type { EngineResult, ModelRun } from "@/lib/forecast";
import { formatPeriod } from "@/lib/data/parseDates";
import { fmtInt, fmtPct, fmtAed, fmtNum, isNum } from "@/lib/utils/format";
import { shortName } from "@/lib/forecast/models/registry";

export type CaptionKey =
  | "hero"
  | "kpis"
  | "plan"
  | "regional"
  | "holdout"
  | "split"
  | "scenario"
  | "leaderboard"
  | "metricBars"
  | "residuals"
  | "importance"
  | "modelCards"
  | "health"
  | "pipeline"
  | "features"
  | "dualAxis"
  | "scatter"
  | "momGrowth"
  | "regionShare";

export type Captions = Record<CaptionKey, string>;

const P = (p: string | undefined | null) => (p ? formatPeriod(p, "short") : "n/a");

function metric(r: ModelRun | undefined, key: "wape" | "mape"): number | null {
  return r?.holdout?.metrics[key] ?? null;
}

function trendSentence(res: EngineResult): string {
  const s = res.summary;
  if (!s.first || !s.peak || !s.latest) return "No sales history in the current scope yet.";
  const parts: string[] = [];
  if (isNum(s.launchToPeakPct) && s.peak.period !== s.first.period) {
    parts.push(`Sales grew ${fmtPct(s.launchToPeakPct, 0)} from ${fmtInt(s.first.value)} units at launch (${P(s.first.period)}) to a peak of ${fmtInt(s.peak.value)} in ${P(s.peak.period)}`);
  } else {
    parts.push(`Sales peaked at ${fmtInt(s.peak.value)} units in ${P(s.peak.period)}`);
  }
  const n = res.points.length;
  const afterPeak = res.points.findIndex((p) => p.period === s.peak?.period);
  const monthsSincePeak = n - 1 - afterPeak;
  if (monthsSincePeak >= 1 && isNum(s.latest.value) && s.peak.value > 0) {
    const decline = (100 * (s.latest.value - s.peak.value)) / s.peak.value;
    let tempPart = "";
    if (isNum(s.peakTemp) && isNum(s.latestTemp) && Math.abs(s.peakTemp - s.latestTemp) >= 1) {
      tempPart = ` as average temperatures ${s.latestTemp < s.peakTemp ? "fell" : "rose"} from ${fmtNum(s.peakTemp, 1)} to ${fmtNum(s.latestTemp, 1)} °C`;
    }
    parts.push(`; the ${monthsSincePeak} month(s) since then ${decline < 0 ? "declined" : "changed"} ${fmtPct(Math.abs(decline), 1)}${tempPart}.`);
  } else {
    parts.push(isNum(s.latest.momPct) ? `, and the latest month moved ${fmtPct(s.latest.momPct, 1, true)} month on month.` : ".");
  }
  return parts.join("");
}

export function buildCaptions(res: EngineResult): Captions {
  const best = res.models.find((m) => m.id === res.bestId);
  const selected = res.models.find((m) => m.id === res.selectedId);
  const naive = res.models.find((m) => m.id === "naive");
  const metricKey = res.settings.rankMetric;
  const metricLabel = metricKey.toUpperCase();
  const ok = res.status === "ok" && !!selected;
  const blocked = res.status !== "ok" ? res.message ?? "At least 4 months are needed to forecast." : "";
  const f = res.forecast;
  const horizonTotal = f.reduce((a, r) => a + r.forecast, 0);
  const s = res.summary;

  // hero
  let hero = trendSentence(res);
  if (ok && f.length) {
    const lastActual = s.latest?.value ?? 0;
    const change = lastActual > 0 ? (100 * (f[0].forecast - lastActual)) / lastActual : null;
    hero += ` ${selected?.shortName} forecasts ${fmtInt(f[0].forecast)} units for ${P(f[0].period)} (${fmtPct(change, 1, true)} vs ${P(s.latest?.period)}) and ${fmtInt(horizonTotal)} over the next ${f.length} month(s), with a ${res.settings.confidence}% range of ${fmtInt(f[0].lower)} to ${fmtInt(f[0].upper)} in the first month.`;
  } else if (!ok) hero += ` ${blocked}`;

  // kpis
  const kpis = ok
    ? `${shortName(res.bestId ?? "naive")} is the most accurate model on the hold-out (${metricLabel} ${fmtPct(metric(best, metricKey))}); planning with it instead of Naive would have saved ${fmtAed(res.cost?.savings)} on the test months.`
    : blocked;

  // plan
  let plan = blocked;
  if (ok && f.length) {
    const totalSS = f.reduce((a, r) => a + r.safetyStock, 0);
    const totalRec = f.reduce((a, r) => a + r.recommended, 0);
    plan = `Producing ${fmtInt(totalRec)} units over ${f.length} month(s) covers the forecast of ${fmtInt(horizonTotal)} plus ${fmtInt(totalSS)} units of safety stock for a ${res.settings.serviceLevel}% service level. Safety stock grows each month because uncertainty compounds with the horizon (sigma x sqrt(h)).`;
    if (res.floorNote) plan += ` ${res.floorNote}`;
  }

  // regional
  let regional = blocked;
  if (ok && res.regional && f.length) {
    const r = res.regional;
    const order = r.shares.map((sh, i) => ({ sh, i })).sort((a, b) => b.sh - a.sh);
    const top = order[0];
    regional =
      r.regions.length === 1
        ? `All ${fmtInt(f[0].forecast)} units for ${P(f[0].period)} go to ${r.regions[0]}, the only region in scope.`
        : `${r.regions[top.i]} takes the largest share (${fmtPct(top.sh * 100, 1)}) based on the ${r.basis}, so it should receive about ${fmtInt(r.rows[0].values[top.i])} of the ${fmtInt(f[0].forecast)} units forecast for ${P(f[0].period)}${order.length > 1 ? `; the smallest market, ${r.regions[order[order.length - 1].i]}, needs ${fmtInt(r.rows[0].values[order[order.length - 1].i])}` : ""}.`;
  }

  // holdout
  let holdout = blocked;
  if (ok && best?.holdout) {
    const nW = metric(naive, "wape");
    const bW = metric(best, "wape");
    const gap = isNum(nW) && isNum(bW) ? nW - bW : null;
    const biasDir = isNum(best.holdout.metrics.bias) ? (best.holdout.metrics.bias > 0 ? "over-forecast" : "under-forecast") : "";
    const worst = [...res.models].filter((m) => m.status === "ok" && m.holdout).sort((a, b) => (metric(b, "wape") ?? 0) - (metric(a, "wape") ?? 0))[0];
    holdout = `Trained on ${res.split.trainPeriods.length} months and tested on ${P(res.split.testPeriods[0])} to ${P(res.split.testPeriods[res.split.testPeriods.length - 1])}, ${best.shortName} has the lowest hold-out WAPE (${fmtPct(bW)})${best.id !== "naive" && isNum(gap) ? `, ${fmtNum(Math.abs(gap), 1)} points ${gap >= 0 ? "better" : "worse"} than Naive` : ""}${biasDir ? ` and a slight ${biasDir} bias of ${fmtPct(best.holdout.metrics.bias, 1, true)}` : ""}.${worst && worst.id !== best.id ? ` ${worst.shortName} is weakest (${fmtPct(metric(worst, "wape"))} WAPE).` : ""}`;
  }

  // split
  const split =
    res.n >= 1
      ? `${res.split.trainPeriods.length} training month(s) (${P(res.split.trainPeriods[0])} to ${P(res.split.trainPeriods[res.split.trainPeriods.length - 1])}), ${res.split.testPeriods.length} chronological test month(s) and a ${res.horizon}-month forecast (${P(res.split.futurePeriods[0])} to ${P(res.split.futurePeriods[res.split.futurePeriods.length - 1])}). The split is never random: the model never sees the future it is tested on.`
      : "No data in scope.";

  // scenario
  let scenario = blocked;
  if (ok && f.length) {
    const totalDelta = f.reduce((a, r) => a + r.delta, 0);
    const usesDrivers = selected?.id === "regression" || selected?.id === "rf" || selected?.id === "gbm" || (selected?.id === "ensemble" && Object.keys(selected.weights ?? {}).some((k) => k === "regression" || k === "rf" || k === "gbm"));
    if (!res.hasTemp && !res.hasPromo) scenario = "The dataset has no temperature or promo column, so there are no drivers to vary; forecasts depend on history only.";
    else if (!usesDrivers) {
      const reg = res.models.find((m) => m.id === "regression" && m.status === "ok" && m.forecast && m.baseForecast);
      const regDelta = reg ? (reg.forecast ?? []).reduce((a, v) => a + v, 0) - (reg.baseForecast ?? []).reduce((a, v) => a + v, 0) : null;
      scenario = `${selected?.shortName} does not use temperature or promo, so scenario edits do not move the production plan.${reg && isNum(regDelta) ? ` The driver regression responds: your scenario changes its ${f.length}-month forecast by ${regDelta >= 0 ? "+" : ""}${fmtInt(regDelta)} units.` : ""} Select a driver-based model in the Control Panel to plan with it.`;
    }
    else scenario = Math.abs(totalDelta) < 0.5 ? `The scenario matches the default assumptions, so the forecast equals the base case (${fmtInt(horizonTotal)} units over ${f.length} month(s)).` : `Your scenario changes the ${f.length}-month forecast by ${totalDelta >= 0 ? "+" : ""}${fmtInt(totalDelta)} units (${fmtPct((100 * totalDelta) / Math.max(1, horizonTotal - totalDelta), 1, true)}) vs the base case of ${fmtInt(horizonTotal - totalDelta)}.`;
  }

  // leaderboard & metric bars
  const okModels = res.models.filter((m) => m.status === "ok" && m.holdout);
  let leaderboard = blocked;
  let metricBars = blocked;
  if (ok && best) {
    const fam = new Map<string, ModelRun>();
    for (const m of okModels) {
      const cur = fam.get(m.family);
      if (!cur || (metric(m, metricKey) ?? Infinity) < (metric(cur, metricKey) ?? Infinity)) fam.set(m.family, m);
    }
    const famText = Array.from(fam.entries()).map(([k, m]) => `${k}: ${m.shortName} ${fmtPct(metric(m, metricKey))}`).join("; ");
    leaderboard = `Ranked by hold-out ${metricLabel} (tie-break: walk-forward WAPE), ${best.shortName} wins. Best per family: ${famText}. ${res.models.filter((m) => m.status === "ineligible" || m.status === "disabled").length} model(s) are not scored (see status).`;
    const wfBest = [...okModels].filter((m) => m.walkForward).sort((a, b) => (a.walkForward?.metrics.wape ?? Infinity) - (b.walkForward?.metrics.wape ?? Infinity))[0];
    metricBars =
      wfBest && wfBest.id !== best.id
        ? `Hold-out and walk-forward disagree: ${best.shortName} wins the ${res.holdoutSize}-month hold-out, but ${wfBest.shortName} has the lowest one-step walk-forward WAPE (${fmtPct(wfBest.walkForward?.metrics.wape)}). With so few test months, rankings are sensitive to which months are held out.`
        : `${best.shortName} leads on both the hold-out (${fmtPct(metric(best, "wape"))} WAPE) and the walk-forward check (${fmtPct(best.walkForward?.metrics.wape)}), which makes the choice more robust. MAPE and WAPE are close because monthly volumes are of similar size.`;
  }

  // residuals
  let residuals = blocked;
  if (ok && selected?.walkForward && selected.walkForward.residuals.length) {
    const r = selected.walkForward.residuals;
    const pos = r.filter((v) => v > 0).length;
    const meanR = r.reduce((a, b) => a + b, 0) / r.length;
    residuals = `${selected.shortName}'s one-step errors over ${r.length} walk-forward origins average ${fmtInt(meanR)} units; ${pos} of ${r.length} are positive (actual above forecast), so it ${pos > r.length / 2 ? "tends to under-forecast" : pos < r.length / 2 ? "tends to over-forecast" : "shows no systematic bias"}. Their spread sets the prediction interval width (sigma ${fmtInt(selected.sigma)}).`;
  } else if (ok) residuals = "Walk-forward residuals are not available for the selected model (too few origins).";

  // importance
  let importance = "Feature importance is available when Random Forest or Gradient Boosting is fitted (8+ months).";
  const tree = res.models.find((m) => m.id === "rf" && m.importance) ?? res.models.find((m) => m.id === "gbm" && m.importance);
  if (tree?.importance) {
    const top = Object.entries(tree.importance).sort((a, b) => b[1] - a[1]).slice(0, 3);
    importance = `For ${tree.shortName}, ${top.map(([k, v]) => `${k} (${fmtPct(v, 0)})`).join(", ")} carry the most split gain when predicting month-on-month growth. ${top.some(([k]) => k === "temp" || k === "temp_delta") ? "Temperature-related features matter, consistent with weather-driven demand." : "Lag and calendar features dominate, so history matters more than drivers here."}`;
  }

  // model cards
  const arima = res.models.find((m) => m.id === "arima" && m.status === "ok");
  const reg = res.models.find((m) => m.id === "regression" && m.status === "ok");
  let modelCards = ok ? `${okModels.length} model(s) fitted on the full ${res.n} months.` : blocked;
  if (ok) {
    if (arima?.label) modelCards += ` AICc selected ${arima.label}.`;
    if (reg && isNum(Number(reg.params.coef_temp))) modelCards += ` Regression: each extra °C is worth ${fmtInt(Number(reg.params.coef_temp))} units per month${isNum(Number(reg.params.coef_promo)) && "coef_promo" in reg.params ? ` and a promo month ${Number(reg.params.coef_promo) >= 0 ? "adds" : "removes"} ${fmtInt(Math.abs(Number(reg.params.coef_promo)))}` : ""}.`;
  }

  // health
  const warn = res.health.filter((h) => h.status === "warn").length;
  const fail = res.health.filter((h) => h.status === "fail").length;
  const health = `${res.health.length - warn - fail} of ${res.health.length} checks pass, ${warn} warn and ${fail} fail. ${fail > 0 ? res.health.filter((h) => h.status === "fail").map((h) => h.detail).join(" ") : warn > 0 ? `Main warning: ${res.health.find((h) => h.status === "warn")?.detail}` : "The data is ready for modelling."}`;

  // pipeline / features
  const raw = res.pipeline[0]?.before ?? 0;
  const pipeline = `${fmtInt(raw)} raw row(s) become ${res.n} monthly observation(s) and ${res.features.trainingRows} feature row(s) for the tree models (${res.features.rowsLost} lost to lags).`;
  const features = `${res.features.names.length} engineered features per month. ${res.hasTemp ? "Temperature and its month-on-month change are included." : "No temperature column, so temperature features are off."} ${res.hasPromo ? "The promo flag and its switch-on indicator are included." : "No promo column, so promo features are off."} The tree models learn log growth (last column), not levels.`;

  // drivers
  const r = s.tempSalesR;
  const dualAxis = res.hasTemp
    ? `Sales and temperature ${isNum(r) && r > 0.5 ? "move together" : isNum(r) && r < -0.5 ? "move in opposite directions" : "are only loosely related"} (Pearson r = ${fmtNum(r, 2)}). ${trendSentence(res)}`
    : `No temperature data was supplied. ${trendSentence(res)}`;
  const scatter = res.hasTemp
    ? `r = ${fmtNum(r, 3)}: ${isNum(r) ? `${Math.abs(r) >= 0.7 ? "a strong" : Math.abs(r) >= 0.4 ? "a moderate" : "a weak"} ${r >= 0 ? "positive" : "negative"} link, but with one launch year, heat and launch growth rise together, so correlation overstates causation.` : "not computable."}${isNum(s.promoLiftPct) ? ` Controlling for trend and temperature, a promo month lifts sales by about ${fmtPct(s.promoLiftPct, 1)} of average monthly volume.` : ""}`
    : "No temperature data, so the scatter cannot be drawn.";
  const growthVals = s.momGrowth.filter((g) => isNum(g.pct));
  const maxG = growthVals.reduce<{ period: string; pct: number | null } | null>((a, g) => (!a || (g.pct ?? -Infinity) > (a.pct ?? -Infinity) ? g : a), null);
  const negCount = growthVals.filter((g) => (g.pct ?? 0) < 0).length;
  const momGrowth = growthVals.length
    ? `The strongest month-on-month growth was ${fmtPct(maxG?.pct, 1, true)} in ${P(maxG?.period)}. ${negCount} of ${growthVals.length} months shrank${s.last3MomPct.length ? `; the last ${s.last3MomPct.length} months moved ${s.last3MomPct.map((g) => fmtPct(g.pct, 1, true)).join(", ")}` : ""}.`
    : "At least 2 months are needed to compute month-on-month growth.";
  const totals = res.scopeRegions.map((reg2) => ({ reg2, v: (res.regionMatrix[reg2] ?? []).reduce((a, b) => a + b, 0) }));
  const tot = totals.reduce((a, b) => a + b.v, 0);
  const topR = [...totals].sort((a, b) => b.v - a.v)[0];
  const regionShare = topR && tot > 0 ? `${topR.reg2} accounts for ${fmtPct((100 * topR.v) / tot, 1)} of ${fmtInt(tot)} units sold in scope${totals.length > 1 ? ` across ${totals.length} regions` : ""}.` : "No regional data in scope.";

  return { hero, kpis, plan, regional, holdout, split, scenario, leaderboard, metricBars, residuals, importance, modelCards, health, pipeline, features, dualAxis, scatter, momGrowth, regionShare };
}
