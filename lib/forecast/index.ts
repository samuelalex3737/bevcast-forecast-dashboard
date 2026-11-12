import type { DataRow, IngestNotice, RejectedRow } from "@/lib/data/schema";
import { preprocess, type PipelineStep, type PrepDiagnostics, type SeriesPoint } from "@/lib/data/clean";
import { buildHealthChecks, type HealthCheck } from "@/lib/data/health";
import { addMonths, monthOfPeriod, formatPeriod } from "@/lib/data/parseDates";
import { BASE_MODELS, shortName, MODEL_INFO } from "./models/registry";
import { ENSEMBLE_WHY, inverseWapeWeights } from "./models/ensemble";
import { fitDriverRegression } from "./models/regression";
import { naiveModel } from "./models/naive";
import { holdoutEval, walkForwardEval, walkForwardOrigins, combine, exogFromPoints, type EvalSeries, type WalkForwardSeries } from "./evaluate";
import { computeMetrics, naiveScale } from "./metrics";
import { estimateSigma, band, type SigmaSource } from "./intervals";
import { productionPlan, regionalAllocation, compareCost, type RegionalAllocation, type CostComparison } from "./business";
import { buildFeatureTable, LAG_ROWS_LOST, type FeatureName, type FeatureTableRow } from "./features";
import { sanitizeSettings, maxHoldout, Z_TWO_SIDED, Z_ONE_SIDED, type Settings } from "./settings";
import { pearson, mean } from "./linalg";
import type { FutureExog, ModelConfig, ModelFamily, ModelId, ForecastModel, FittedModel } from "./types";

export type ScenarioOverrides = Record<string, { temp?: number | null; promo?: 0 | 1 | null }>;

export interface EngineInput {
  rows: DataRow[];
  settings: Settings;
  scenario: ScenarioOverrides;
  ingestNotices: IngestNotice[];
  rejected: RejectedRow[];
}

export type ModelStatus = "ok" | "failed" | "ineligible" | "disabled";

export interface ModelRun {
  id: ModelId;
  name: string;
  shortName: string;
  family: ModelFamily;
  why: string;
  minObs: number;
  status: ModelStatus;
  reason: string | null;
  label: string | null;
  params: Record<string, number | string>;
  importance: Record<string, number> | null;
  holdout: EvalSeries | null;
  walkForward: WalkForwardSeries | null;
  forecast: number[] | null;
  baseForecast: number[] | null;
  sigma: number | null;
  sigmaSource: SigmaSource | null;
  weights: Partial<Record<ModelId, number>> | null;
}

export interface ForecastRow {
  period: string;
  forecast: number;
  lower: number;
  upper: number;
  lower80: number;
  upper80: number;
  lower95: number;
  upper95: number;
  sigma: number;
  safetyStock: number;
  recommended: number;
  base: number;
  delta: number;
  temp: number | null;
  promo: 0 | 1 | null;
}

export interface SummaryStats {
  total: number;
  mean: number;
  first: { period: string; value: number } | null;
  latest: { period: string; value: number; momPct: number | null } | null;
  peak: { period: string; value: number } | null;
  trough: { period: string; value: number } | null;
  launchToPeakPct: number | null;
  last3MomPct: { period: string; pct: number | null }[];
  last3ChangePct: number | null;
  momGrowth: { period: string; pct: number | null }[];
  tempSalesR: number | null;
  promoLiftPct: number | null;
  promoMonths: number;
  peakTemp: number | null;
  latestTemp: number | null;
}

export interface EngineResult {
  status: "ok" | "insufficient" | "empty";
  message: string | null;
  n: number;
  points: SeriesPoint[];
  regions: string[];
  scopeRegions: string[];
  regionMatrix: Record<string, number[]>;
  hasTemp: boolean;
  hasPromo: boolean;
  pipeline: PipelineStep[];
  health: HealthCheck[];
  diagnostics: PrepDiagnostics;
  features: { rows: FeatureTableRow[]; names: FeatureName[]; rowsLost: number; trainingRows: number };
  holdoutSize: number;
  maxHoldout: number;
  horizon: number;
  split: { trainPeriods: string[]; testPeriods: string[]; futurePeriods: string[] };
  wfOrigins: string[];
  models: ModelRun[];
  ranking: ModelId[];
  bestId: ModelId | null;
  selectedId: ModelId | null;
  selectionNote: string | null;
  forecast: ForecastRow[];
  scenario: FutureExog[];
  scenarioDefaults: FutureExog[];
  regional: RegionalAllocation | null;
  cost: CostComparison | null;
  summary: SummaryStats;
  warnings: string[];
  floorNote: string | null;
  settings: Settings;
  computeMs: number;
}

export interface ProgressEvent {
  stage: string;
  pct: number;
}

/* ------------------------------------------------------------------ */

function pct(a: number, b: number): number | null {
  if (!(Math.abs(b) > 0)) return null;
  const v = (100 * (a - b)) / b;
  return Number.isFinite(v) ? v : null;
}

export function computeSummary(points: SeriesPoint[], hasTemp: boolean, hasPromo: boolean): SummaryStats {
  const ys = points.map((p) => p.y);
  const n = points.length;
  const momGrowth = points.map((p, i) => ({ period: p.period, pct: i === 0 ? null : pct(p.y, points[i - 1].y) }));
  if (n === 0) {
    return { total: 0, mean: 0, first: null, latest: null, peak: null, trough: null, launchToPeakPct: null, last3MomPct: [], last3ChangePct: null, momGrowth, tempSalesR: null, promoLiftPct: null, promoMonths: 0, peakTemp: null, latestTemp: null };
  }
  let pi = 0;
  let ti = 0;
  ys.forEach((v, i) => {
    if (v > ys[pi]) pi = i;
    if (v < ys[ti]) ti = i;
  });
  let promoLiftPct: number | null = null;
  const promoMonths = points.filter((p) => p.promo === 1).length;
  if (hasPromo && n >= 4 && promoMonths > 0 && promoMonths < n) {
    const reg = fitDriverRegression(points, hasTemp, true);
    const idx = reg.names.indexOf("promo");
    const m = mean(ys);
    if (idx >= 0 && m > 0) {
      const v = (100 * reg.fit.coef[idx]) / m;
      promoLiftPct = Number.isFinite(v) ? v : null;
    }
  }
  const temps = points.map((p) => p.temp);
  const tempSalesR = hasTemp && temps.every((t) => t !== null) ? pearson(temps as number[], ys) : null;
  return {
    total: ys.reduce((a, b) => a + b, 0),
    mean: mean(ys),
    first: { period: points[0].period, value: ys[0] },
    latest: { period: points[n - 1].period, value: ys[n - 1], momPct: n > 1 ? pct(ys[n - 1], ys[n - 2]) : null },
    peak: { period: points[pi].period, value: ys[pi] },
    trough: { period: points[ti].period, value: ys[ti] },
    launchToPeakPct: pct(ys[pi], ys[0]),
    last3MomPct: momGrowth.slice(Math.max(1, n - 3)),
    last3ChangePct: n >= 4 ? pct(ys[n - 1], ys[n - 4]) : null,
    momGrowth,
    tempSalesR,
    promoLiftPct,
    promoMonths,
    peakTemp: points[pi].temp,
    latestTemp: points[n - 1].temp,
  };
}

/** Future drivers: same calendar month in the history (else the nearest calendar months); promo 0 except December. */
export function defaultScenario(points: SeriesPoint[], futurePeriods: string[], hasTemp: boolean, hasPromo: boolean): FutureExog[] {
  const byMonth = new Map<number, number[]>();
  for (const p of points) {
    if (p.temp === null) continue;
    const m = monthOfPeriod(p.period);
    byMonth.set(m, [...(byMonth.get(m) ?? []), p.temp]);
  }
  const lastTemp = [...points].reverse().find((p) => p.temp !== null)?.temp ?? null;
  return futurePeriods.map((period) => {
    const m = monthOfPeriod(period);
    let temp: number | null = null;
    if (hasTemp) {
      const same = byMonth.get(m);
      if (same && same.length) temp = mean(same);
      else if (byMonth.size > 0) {
        let best = 13;
        for (const k of byMonth.keys()) best = Math.min(best, Math.min(Math.abs(k - m), 12 - Math.abs(k - m)));
        const near = Array.from(byMonth.entries()).filter(([k]) => Math.min(Math.abs(k - m), 12 - Math.abs(k - m)) === best).flatMap(([, v]) => v);
        temp = near.length ? mean(near) : lastTemp;
      } else temp = lastTemp;
      if (temp !== null) temp = Math.round(temp * 10) / 10;
    }
    return { period, temp, promo: hasPromo ? (m === 12 ? 1 : 0) : null };
  });
}

function applyOverrides(defaults: FutureExog[], overrides: ScenarioOverrides, hasTemp: boolean, hasPromo: boolean): FutureExog[] {
  return defaults.map((d) => {
    const o = overrides[d.period];
    if (!o) return d;
    const temp = hasTemp && typeof o.temp === "number" && Number.isFinite(o.temp) ? Math.min(70, Math.max(-60, o.temp)) : d.temp;
    const promo = hasPromo && (o.promo === 0 || o.promo === 1) ? o.promo : d.promo;
    return { period: d.period, temp, promo };
  });
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function emptyRun(m: { id: ModelId; name: string; family: ModelFamily; why: string; minObs: number }, status: ModelStatus, reason: string | null): ModelRun {
  return {
    id: m.id,
    name: m.name,
    shortName: shortName(m.id),
    family: m.family,
    why: m.why,
    minObs: m.minObs,
    status,
    reason,
    label: null,
    params: {},
    importance: null,
    holdout: null,
    walkForward: null,
    forecast: null,
    baseForecast: null,
    sigma: null,
    sigmaSource: null,
    weights: null,
  };
}

function ineligibleReason(model: { id: ModelId; minObs: number }, n: number): string | null {
  if (n >= model.minObs) return null;
  if (model.id === "snaive") return "Needs 24+ months to learn yearly seasonality";
  return `Needs at least ${model.minObs} months`;
}

/* ------------------------------------------------------------------ */

export function runEngine(input: EngineInput, onProgress?: (e: ProgressEvent) => void): EngineResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const settings = sanitizeSettings(input.settings);
  const report = (stage: string, p: number) => onProgress?.({ stage, pct: p });
  report("Preprocessing", 5);

  const prep = preprocess(input.rows, { scope: settings.regions, fillGaps: settings.fillGaps });
  const health = buildHealthChecks(prep, { ingestNotices: input.ingestNotices, rejected: input.rejected, fillGaps: settings.fillGaps });
  const points = prep.points;
  const n = points.length;
  const featureTable = buildFeatureTable(points, { useTemp: prep.hasTemp, usePromo: prep.hasPromo });
  const summary = computeSummary(points, prep.hasTemp, prep.hasPromo);
  const warnings = health.filter((h) => h.status !== "pass").map((h) => `${h.label}: ${h.detail}`);
  if (prep.diagnostics.emptyScopeFallback) warnings.unshift("None of the selected regions exist in the data, so all regions are shown.");

  const cfg: ModelConfig = {
    maWindow: settings.maWindow,
    rfTrees: settings.rfTrees,
    rfMaxDepth: settings.rfMaxDepth,
    gbmRounds: settings.gbmRounds,
    gbmLearningRate: settings.gbmLearningRate,
    gbmMaxDepth: settings.gbmMaxDepth,
    seed: settings.seed,
    seasonalArima: settings.seasonalArima && n >= 24,
    useTemp: prep.hasTemp,
    usePromo: prep.hasPromo,
  };

  const k = Math.min(Math.max(1, settings.holdout), maxHoldout(n));
  const h = settings.horizon;
  const lastPeriod = n > 0 ? points[n - 1].period : null;
  const futurePeriods = lastPeriod ? Array.from({ length: h }, (_, i) => addMonths(lastPeriod, i + 1)) : [];
  const scenarioDefaults = defaultScenario(points, futurePeriods, prep.hasTemp, prep.hasPromo);
  const scenario = applyOverrides(scenarioDefaults, input.scenario, prep.hasTemp, prep.hasPromo);

  const base: Omit<EngineResult, "status" | "message" | "models" | "ranking" | "bestId" | "selectedId" | "selectionNote" | "forecast" | "regional" | "cost" | "floorNote" | "computeMs" | "wfOrigins"> = {
    n,
    points,
    regions: prep.regions,
    scopeRegions: prep.scopeRegions,
    regionMatrix: prep.regionMatrix,
    hasTemp: prep.hasTemp,
    hasPromo: prep.hasPromo,
    pipeline: [
      ...prep.pipeline,
      {
        id: "features",
        label: "Feature rows",
        before: n,
        after: Math.max(0, n - LAG_ROWS_LOST),
        unit: "rows",
        detail: `${featureTable.names.length} features engineered. The first ${Math.min(n, LAG_ROWS_LOST)} month(s) are lost because lag_2 and log_growth_1 need two prior months; tree models train on the remaining ${Math.max(0, n - LAG_ROWS_LOST)} row(s).`,
      },
    ],
    health,
    diagnostics: prep.diagnostics,
    features: { rows: featureTable.rows, names: featureTable.names, rowsLost: Math.min(n, LAG_ROWS_LOST), trainingRows: Math.max(0, n - LAG_ROWS_LOST) },
    holdoutSize: k,
    maxHoldout: maxHoldout(n),
    horizon: h,
    split: {
      trainPeriods: points.slice(0, Math.max(0, n - k)).map((p) => p.period),
      testPeriods: points.slice(Math.max(0, n - k)).map((p) => p.period),
      futurePeriods,
    },
    scenario,
    scenarioDefaults,
    summary,
    warnings,
    settings,
  };

  const elapsed = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;

  if (n < 4) {
    const all = MODEL_INFO.map((m) => emptyRun(m, "ineligible", "At least 4 months are needed to forecast"));
    return {
      ...base,
      status: n === 0 ? "empty" : "insufficient",
      message: n === 0 ? "No data in scope. Upload, paste or add data in the Data Studio." : `At least 4 months are needed to forecast. The current scope has ${n}.`,
      models: all,
      ranking: [],
      bestId: null,
      selectedId: null,
      selectionNote: null,
      forecast: [],
      regional: null,
      cost: null,
      floorNote: null,
      computeMs: elapsed(),
      wfOrigins: [],
    };
  }

  const trainLen = n - k;
  const runnable = BASE_MODELS.filter((m) => settings.enabledModels[m.id] && n >= m.minObs && trainLen >= m.minTrain);
  const commonMinTrain = Math.max(2, ...runnable.map((m) => m.minTrain));
  const origins = walkForwardOrigins(n, commonMinTrain);
  const lastLevel = points[n - 1].y;

  const runs: ModelRun[] = [];
  const fittedFinal = new Map<ModelId, FittedModel>();
  BASE_MODELS.forEach((model, idx) => {
    report(`Training ${shortName(model.id)}`, 10 + Math.round((idx / BASE_MODELS.length) * 75));
    if (!settings.enabledModels[model.id]) {
      runs.push(emptyRun(model, "disabled", "Turned off in the Control Panel"));
      return;
    }
    const inel = ineligibleReason(model, n);
    if (inel) {
      runs.push(emptyRun(model, "ineligible", inel));
      return;
    }
    if (trainLen < model.minTrain) {
      runs.push(emptyRun(model, "ineligible", `Hold-out leaves ${trainLen} training months; this model needs ${model.minTrain}. Reduce the test size.`));
      return;
    }
    runs.push(evaluateModel(model, points, k, origins, cfg, scenario, scenarioDefaults, lastLevel, fittedFinal));
  });

  // Ensemble of the top 3 fitted models by hold-out WAPE
  report("Building ensemble", 88);
  const ensembleInfo = MODEL_INFO.find((m) => m.id === "ensemble");
  if (ensembleInfo) {
    if (!settings.enabledModels.ensemble) runs.push(emptyRun(ensembleInfo, "disabled", "Turned off in the Control Panel"));
    else if (n < ensembleInfo.minObs) runs.push(emptyRun(ensembleInfo, "ineligible", `Needs at least ${ensembleInfo.minObs} months`));
    else {
      const candidates = runs
        .filter((r) => r.status === "ok" && r.holdout?.metrics.wape !== null && r.holdout !== null && r.forecast && r.walkForward)
        .sort((a, b) => (a.holdout?.metrics.wape ?? Infinity) - (b.holdout?.metrics.wape ?? Infinity))
        .slice(0, 3);
      if (candidates.length < 2) runs.push(emptyRun(ensembleInfo, "ineligible", "Needs at least 2 fitted models with a hold-out WAPE"));
      else runs.push(buildEnsembleRun(ensembleInfo, candidates, points, k, origins, lastLevel));
    }
  }

  // Safety net: if no enabled model can run on this data, fall back to Naive so the plan never goes blank.
  let fallbackNote: string | null = null;
  if (!runs.some((r) => r.status === "ok" && r.forecast)) {
    const fb = evaluateModel(naiveModel, points, k, origins.length ? origins : walkForwardOrigins(n, 2), cfg, scenario, scenarioDefaults, lastLevel, fittedFinal);
    if (fb.status === "ok") {
      const idx = runs.findIndex((r) => r.id === "naive");
      fb.reason = "Fallback: none of the enabled models can run on this data";
      if (idx >= 0) runs[idx] = fb;
      else runs.unshift(fb);
      fallbackNote = "None of the enabled models can run on this data, so Naive is used as a fallback.";
    }
  }

  // Ranking: primary metric on hold-out, tie-break walk-forward WAPE
  const metricOf = (r: ModelRun) => {
    const v = settings.rankMetric === "mape" ? r.holdout?.metrics.mape : r.holdout?.metrics.wape;
    return v === null || v === undefined ? Infinity : v;
  };
  const ranked = runs
    .filter((r) => r.status === "ok" && r.holdout && r.forecast)
    .sort((a, b) => metricOf(a) - metricOf(b) || (a.walkForward?.metrics.wape ?? Infinity) - (b.walkForward?.metrics.wape ?? Infinity));
  const ranking = ranked.map((r) => r.id);
  const bestId = ranking[0] ?? null;
  let selectedId: ModelId | null = bestId;
  let selectionNote: string | null = fallbackNote;
  if (settings.selectedModel !== "auto" && !fallbackNote) {
    const chosen = runs.find((r) => r.id === settings.selectedModel);
    if (chosen && chosen.status === "ok" && chosen.forecast) selectedId = chosen.id;
    else if (bestId) {
      selectionNote = `${shortName(settings.selectedModel)} is not available (${chosen?.reason ?? "not fitted"}), so the best model ${shortName(bestId)} is used instead.`;
    }
  }

  report("Business layer", 94);
  let forecastRows: ForecastRow[] = [];
  let regional: RegionalAllocation | null = null;
  let cost: CostComparison | null = null;
  let floorNote: string | null = null;
  const selected = runs.find((r) => r.id === selectedId) ?? null;
  if (selected && selected.forecast && selected.sigma !== null) {
    const f = selected.forecast;
    const sig = selected.sigma;
    const zConf = Z_TWO_SIDED[settings.confidence];
    const bandSel = band(f, sig, zConf);
    const b80 = band(f, sig, Z_TWO_SIDED[80]);
    const b95 = band(f, sig, Z_TWO_SIDED[95]);
    const plan = productionPlan(futurePeriods, f, sig, Z_ONE_SIDED[settings.serviceLevel]);
    const baseF = selected.baseForecast ?? f;
    forecastRows = futurePeriods.map((period, i) => ({
      period,
      forecast: f[i],
      lower: bandSel.lower[i],
      upper: bandSel.upper[i],
      lower80: b80.lower[i],
      upper80: b80.upper[i],
      lower95: b95.lower[i],
      upper95: b95.upper[i],
      sigma: plan[i].sigma,
      safetyStock: plan[i].safetyStock,
      recommended: plan[i].recommended,
      base: baseF[i],
      delta: f[i] - baseF[i],
      temp: scenario[i]?.temp ?? null,
      promo: scenario[i]?.promo ?? null,
    }));
    const zeroForecasts = f.filter((v) => v === 0).length;
    if (zeroForecasts > 0 || bandSel.floored || b95.floored) {
      floorNote =
        zeroForecasts > 0
          ? `${zeroForecasts} forecast month(s) were floored at 0 because sales cannot be negative.`
          : "Lower interval bounds were floored at 0 because sales cannot be negative.";
    }
    const lastWindow = points.slice(Math.max(0, n - 3)).map((p) => formatPeriod(p.period));
    regional = regionalAllocation(prep.regionMatrix, prep.scopeRegions, lastWindow, plan);

    if (selected.holdout) {
      let naiveHold: number[] | null = runs.find((r) => r.id === "naive")?.holdout?.predicted ?? null;
      if (!naiveHold) {
        try {
          naiveHold = holdoutEval(naiveModel, points, k, cfg).predicted;
        } catch {
          naiveHold = null;
        }
      }
      if (naiveHold) cost = compareCost(selected.holdout.periods, selected.holdout.actual, selected.holdout.predicted, naiveHold, settings.unitCost, settings.unitPrice);
    }
  }

  report("Done", 100);
  return {
    ...base,
    status: "ok",
    message: ranking.length === 0 ? "No model could be fitted on the current data. Check the Model Arena for the reasons." : null,
    models: runs,
    ranking,
    bestId,
    selectedId,
    selectionNote,
    forecast: forecastRows,
    regional,
    cost,
    floorNote,
    computeMs: elapsed(),
    wfOrigins: origins.map((t) => points[t].period),
  };
}

function evaluateModel(
  model: ForecastModel,
  points: SeriesPoint[],
  k: number,
  origins: number[],
  cfg: ModelConfig,
  scenario: FutureExog[],
  scenarioDefaults: FutureExog[],
  lastLevel: number,
  fittedFinal: Map<ModelId, FittedModel>,
): ModelRun {
  const run = emptyRun(model, "ok", null);
  try {
    run.holdout = holdoutEval(model, points, k, cfg);
  } catch (e) {
    return { ...run, status: "failed", reason: `Not fitted: ${errMessage(e)}` };
  }
  try {
    run.walkForward = origins.length ? walkForwardEval(model, points, origins, cfg) : null;
  } catch (e) {
    run.walkForward = null;
    run.reason = `Walk-forward skipped: ${errMessage(e)}`;
  }
  try {
    const fitted = model.fit(points, cfg);
    fittedFinal.set(model.id, fitted);
    const h = scenario.length;
    const f = fitted.predict(h, scenario);
    const b = fitted.predict(h, scenarioDefaults);
    if (f.some((v) => !Number.isFinite(v)) || b.some((v) => !Number.isFinite(v))) throw new Error("final forecast is not finite");
    run.forecast = f;
    run.baseForecast = b;
    run.params = fitted.params;
    run.importance = fitted.importance ?? null;
    run.label = fitted.label ?? model.name;
  } catch (e) {
    return { ...run, status: "failed", reason: `Not fitted: ${errMessage(e)}`, forecast: null, baseForecast: null };
  }
  const holdErr = run.holdout ? run.holdout.actual.map((a, i) => a - (run.holdout as EvalSeries).predicted[i]) : null;
  const s = estimateSigma(run.walkForward?.residuals ?? null, holdErr, lastLevel);
  run.sigma = s.sigma;
  run.sigmaSource = s.source;
  return run;
}

function buildEnsembleRun(
  info: { id: ModelId; name: string; family: ModelFamily; why: string; minObs: number },
  members: ModelRun[],
  points: SeriesPoint[],
  k: number,
  origins: number[],
  lastLevel: number,
): ModelRun {
  const run = emptyRun({ ...info, why: ENSEMBLE_WHY }, "ok", null);
  try {
    const weights = inverseWapeWeights(members.map((m) => m.holdout?.metrics.wape ?? 100));
    const hold = members.map((m) => (m.holdout as EvalSeries).predicted);
    const holdPred = combine(hold, weights);
    const test = points.slice(points.length - k);
    const actual = test.map((p) => p.y);
    run.holdout = {
      periods: test.map((p) => p.period),
      actual,
      predicted: holdPred,
      metrics: computeMetrics(actual, holdPred, naiveScale(points.slice(0, points.length - k).map((p) => p.y))),
    };
    const wfMembers = members.map((m) => m.walkForward);
    if (wfMembers.every((w): w is WalkForwardSeries => w !== null && w.predicted.length === origins.length) && origins.length > 0) {
      const wfPred = combine(wfMembers.map((w) => w.predicted), weights);
      const wfAct = origins.map((t) => points[t].y);
      run.walkForward = {
        periods: origins.map((t) => points[t].period),
        actual: wfAct,
        predicted: wfPred,
        residuals: wfAct.map((a, i) => a - wfPred[i]),
        metrics: computeMetrics(wfAct, wfPred, naiveScale(points.slice(0, origins[0]).map((p) => p.y))),
      };
    }
    run.forecast = combine(members.map((m) => m.forecast as number[]), weights);
    run.baseForecast = combine(members.map((m) => (m.baseForecast ?? m.forecast) as number[]), weights);
    run.weights = Object.fromEntries(members.map((m, i) => [m.id, weights[i]]));
    run.params = Object.fromEntries(members.map((m, i) => [`weight_${m.id}`, weights[i]]));
    run.label = `Ensemble: ${members.map((m, i) => `${m.shortName} ${(weights[i] * 100).toFixed(0)}%`).join(", ")}`;
    const holdErr = actual.map((a, i) => a - holdPred[i]);
    const s = estimateSigma(run.walkForward?.residuals ?? null, holdErr, lastLevel);
    run.sigma = s.sigma;
    run.sigmaSource = s.source;
    return run;
  } catch (e) {
    return { ...run, status: "failed", reason: `Not fitted: ${errMessage(e)}` };
  }
}

export { exogFromPoints };
