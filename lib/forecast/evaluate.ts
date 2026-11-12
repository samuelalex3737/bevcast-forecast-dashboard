import type { ForecastModel, ModelConfig, SeriesPoint, FutureExog } from "./types";
import { assertFinite } from "./types";
import { computeMetrics, naiveScale, type Metrics } from "./metrics";

export interface EvalSeries {
  periods: string[];
  actual: number[];
  predicted: number[];
  metrics: Metrics;
}

export interface WalkForwardSeries extends EvalSeries {
  residuals: number[];
}

export function exogFromPoints(points: SeriesPoint[]): FutureExog[] {
  return points.map((p) => ({ period: p.period, temp: p.temp, promo: p.promo }));
}

/**
 * Chronological hold-out: train on the first n-k periods and forecast the last k recursively
 * (multi-step, the honest setting for a 3-month plan). Test-month drivers are their realised values.
 */
export function holdoutEval(model: ForecastModel, points: SeriesPoint[], k: number, cfg: ModelConfig): EvalSeries {
  const n = points.length;
  const train = points.slice(0, n - k);
  const test = points.slice(n - k);
  const fitted = model.fit(train, cfg);
  const predicted = assertFinite(fitted.predict(k, exogFromPoints(test)), `${model.name} hold-out`);
  const actual = test.map((p) => p.y);
  return {
    periods: test.map((p) => p.period),
    actual,
    predicted,
    metrics: computeMetrics(actual, predicted, naiveScale(train.map((p) => p.y))),
  };
}

/**
 * Expanding-window walk-forward: for each origin t, train on points[0..t) and forecast t one step
 * ahead. Origins are shared across models so their scores are comparable.
 */
export function walkForwardEval(model: ForecastModel, points: SeriesPoint[], origins: number[], cfg: ModelConfig): WalkForwardSeries {
  const periods: string[] = [];
  const actual: number[] = [];
  const predicted: number[] = [];
  for (const t of origins) {
    const train = points.slice(0, t);
    const fitted = model.fit(train, cfg);
    const [f] = assertFinite(fitted.predict(1, exogFromPoints([points[t]])), `${model.name} walk-forward`);
    periods.push(points[t].period);
    actual.push(points[t].y);
    predicted.push(f);
  }
  const scale = origins.length ? naiveScale(points.slice(0, origins[0]).map((p) => p.y)) : null;
  return {
    periods,
    actual,
    predicted,
    residuals: actual.map((a, i) => a - predicted[i]),
    metrics: computeMetrics(actual, predicted, scale),
  };
}

export function walkForwardOrigins(n: number, minTrain: number): number[] {
  const start = Math.max(n - 6, minTrain, 2);
  const out: number[] = [];
  for (let t = start; t <= n - 1; t++) out.push(t);
  return out;
}

/** Combine member predictions with fixed weights (used for the ensemble). */
export function combine(series: number[][], weights: number[]): number[] {
  const len = Math.min(...series.map((s) => s.length));
  const out = new Array<number>(len).fill(0);
  series.forEach((s, j) => {
    for (let i = 0; i < len; i++) out[i] += weights[j] * s[i];
  });
  return out;
}
