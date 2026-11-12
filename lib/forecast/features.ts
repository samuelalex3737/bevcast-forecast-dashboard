import type { SeriesPoint, ModelConfig, FutureExog } from "./types";
import { monthOfPeriod } from "@/lib/data/parseDates";

export const ALL_FEATURES = [
  "lag_1",
  "lag_2",
  "roll_mean_3",
  "log_growth_1",
  "month_sin",
  "month_cos",
  "quarter",
  "trend_t",
  "temp",
  "temp_delta",
  "promo",
  "promo_delta",
] as const;
export type FeatureName = (typeof ALL_FEATURES)[number];

export const FEATURE_DESCRIPTIONS: Record<FeatureName, string> = {
  lag_1: "Units sold in the previous month (y[t-1])",
  lag_2: "Units sold two months earlier (y[t-2])",
  roll_mean_3: "Mean of up to the 3 previous months (2 available for the first usable row)",
  log_growth_1: "Last month-on-month log growth: ln(y[t-1]+1) - ln(y[t-2]+1)",
  month_sin: "sin(2 pi m / 12): smooth calendar position",
  month_cos: "cos(2 pi m / 12): smooth calendar position",
  quarter: "Calendar quarter 1 to 4",
  trend_t: "Months since the first observation",
  temp: "Average temperature in the month (°C)",
  temp_delta: "Temperature change vs previous month (°C)",
  promo: "Promotion running this month (0/1)",
  promo_delta: "Promo switched on (+1) or off (-1) vs previous month",
};

/** The minimum number of prior months needed before a feature row exists. */
export const LAG_ROWS_LOST = 2;

export function activeFeatures(cfg: Pick<ModelConfig, "useTemp" | "usePromo">): FeatureName[] {
  return ALL_FEATURES.filter((f) => {
    if (!cfg.useTemp && (f === "temp" || f === "temp_delta")) return false;
    if (!cfg.usePromo && (f === "promo" || f === "promo_delta")) return false;
    return true;
  });
}

export interface HistoryPoint {
  period: string;
  y: number;
  temp: number | null;
  promo: 0 | 1 | null;
}

const ln1 = (v: number) => Math.log(Math.max(0, v) + 1);

/**
 * Feature values for position t using only information known at the start of month t:
 * lags of y (t-1, t-2, t-3) plus calendar and exogenous values for month t itself.
 */
export function featureRow(hist: HistoryPoint[], t: number): Record<FeatureName, number> {
  const y1 = hist[t - 1].y;
  const y2 = hist[t - 2].y;
  const prev = [hist[t - 1].y, hist[t - 2].y, ...(t >= 3 ? [hist[t - 3].y] : [])];
  const m = monthOfPeriod(hist[t].period);
  const temp = hist[t].temp ?? hist[t - 1].temp ?? 0;
  const tempPrev = hist[t - 1].temp ?? temp;
  const promo = hist[t].promo ?? 0;
  const promoPrev = hist[t - 1].promo ?? 0;
  return {
    lag_1: y1,
    lag_2: y2,
    roll_mean_3: prev.reduce((a, b) => a + b, 0) / prev.length,
    log_growth_1: ln1(y1) - ln1(y2),
    month_sin: Math.sin((2 * Math.PI * m) / 12),
    month_cos: Math.cos((2 * Math.PI * m) / 12),
    quarter: Math.ceil(m / 3),
    trend_t: t,
    temp,
    temp_delta: temp - tempPrev,
    promo,
    promo_delta: promo - promoPrev,
  };
}

export function toHistory(points: SeriesPoint[]): HistoryPoint[] {
  return points.map((p) => ({ period: p.period, y: p.y, temp: p.temp, promo: p.promo }));
}

export interface TrainingSet {
  X: number[][];
  /** target: month-on-month log growth ln(y[t]+1) - ln(y[t-1]+1) */
  g: number[];
  names: FeatureName[];
  periods: string[];
}

export function buildTrainingSet(points: SeriesPoint[], cfg: ModelConfig): TrainingSet {
  const names = activeFeatures(cfg);
  const hist = toHistory(points);
  const X: number[][] = [];
  const g: number[] = [];
  const periods: string[] = [];
  for (let t = LAG_ROWS_LOST; t < hist.length; t++) {
    const row = featureRow(hist, t);
    X.push(names.map((n) => row[n]));
    g.push(ln1(hist[t].y) - ln1(hist[t - 1].y));
    periods.push(hist[t].period);
  }
  return { X, g, names, periods };
}

/**
 * Recursive multi-step forecast for growth-target models: predict growth, compound it onto the
 * last level, append the prediction to the history and repeat. Exogenous values come from the
 * scenario. Levels are floored at 0.
 */
export function recursiveGrowthForecast(
  points: SeriesPoint[],
  h: number,
  futureExog: FutureExog[],
  names: FeatureName[],
  predictGrowth: (x: number[]) => number,
): number[] {
  const hist = toHistory(points);
  const out: number[] = [];
  for (let k = 0; k < h; k++) {
    const ex = futureExog[k];
    const last = hist[hist.length - 1];
    hist.push({
      period: ex?.period ?? last.period,
      y: Number.NaN,
      temp: ex?.temp ?? last.temp,
      promo: ex?.promo ?? 0,
    });
    const t = hist.length - 1;
    const row = featureRow(hist, t);
    const growth = predictGrowth(names.map((n) => row[n]));
    const level = Math.max(0, Math.exp(ln1(hist[t - 1].y) + (Number.isFinite(growth) ? growth : 0)) - 1);
    hist[t].y = level;
    out.push(level);
  }
  return out;
}

export interface FeatureTableRow {
  period: string;
  y: number;
  values: Record<FeatureName, number | null>;
  target_growth: number | null;
  usable: boolean;
}

/** Engineered features for every month, for display in the Data Studio (Task 1). */
export function buildFeatureTable(points: SeriesPoint[], cfg: Pick<ModelConfig, "useTemp" | "usePromo">): { rows: FeatureTableRow[]; names: FeatureName[] } {
  const names = activeFeatures(cfg);
  const hist = toHistory(points);
  const rows: FeatureTableRow[] = hist.map((p, t) => {
    const values = Object.fromEntries(ALL_FEATURES.map((f) => [f, null])) as Record<FeatureName, number | null>;
    const m = monthOfPeriod(p.period);
    values.month_sin = Math.sin((2 * Math.PI * m) / 12);
    values.month_cos = Math.cos((2 * Math.PI * m) / 12);
    values.quarter = Math.ceil(m / 3);
    values.trend_t = t;
    if (cfg.useTemp) values.temp = p.temp;
    if (cfg.usePromo) values.promo = p.promo;
    if (t >= 1) {
      values.lag_1 = hist[t - 1].y;
      if (cfg.useTemp && p.temp !== null && hist[t - 1].temp !== null) values.temp_delta = p.temp - (hist[t - 1].temp as number);
      if (cfg.usePromo) values.promo_delta = (p.promo ?? 0) - (hist[t - 1].promo ?? 0);
    }
    if (t >= LAG_ROWS_LOST) {
      const full = featureRow(hist, t);
      for (const n of names) values[n] = full[n];
    }
    return {
      period: p.period,
      y: p.y,
      values,
      target_growth: t >= 1 ? ln1(p.y) - ln1(hist[t - 1].y) : null,
      usable: t >= LAG_ROWS_LOST,
    };
  });
  return { rows, names };
}
