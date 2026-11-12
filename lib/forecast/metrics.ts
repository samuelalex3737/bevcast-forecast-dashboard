export interface Metrics {
  n: number;
  mape: number | null;
  /** number of zero actuals skipped by MAPE */
  mapeSkipped: number;
  wape: number | null;
  bias: number | null;
  rmse: number | null;
  mae: number | null;
  mase: number | null;
}

/** Mean absolute one-step naive error on the training data (the MASE denominator). */
export function naiveScale(train: number[]): number | null {
  if (train.length < 2) return null;
  let s = 0;
  for (let i = 1; i < train.length; i++) s += Math.abs(train[i] - train[i - 1]);
  const v = s / (train.length - 1);
  return v > 0 ? v : null;
}

/**
 * MAPE  = (100/m) * sum |A-F| / |A| over A != 0 (zero actuals are skipped and counted)
 * WAPE  = 100 * sum |A-F| / sum |A|
 * Bias% = 100 * sum (F-A) / sum A  (positive = over-forecasting)
 * RMSE, MAE, and MASE = MAE / in-sample naive MAE.
 */
export function computeMetrics(actual: number[], forecast: number[], scale: number | null = null): Metrics {
  const n = Math.min(actual.length, forecast.length);
  if (n === 0) return { n: 0, mape: null, mapeSkipped: 0, wape: null, bias: null, rmse: null, mae: null, mase: null };
  let absErr = 0;
  let sqErr = 0;
  let sumA = 0;
  let sumAbsA = 0;
  let sumErr = 0;
  let apeSum = 0;
  let apeN = 0;
  let skipped = 0;
  for (let i = 0; i < n; i++) {
    const a = actual[i];
    const f = forecast[i];
    const e = f - a;
    absErr += Math.abs(e);
    sqErr += e * e;
    sumErr += e;
    sumA += a;
    sumAbsA += Math.abs(a);
    if (a !== 0) {
      apeSum += Math.abs(e) / Math.abs(a);
      apeN += 1;
    } else skipped += 1;
  }
  const fin = (v: number) => (Number.isFinite(v) ? v : null);
  const mae = absErr / n;
  return {
    n,
    mape: apeN > 0 ? fin((100 * apeSum) / apeN) : null,
    mapeSkipped: skipped,
    wape: sumAbsA > 0 ? fin((100 * absErr) / sumAbsA) : null,
    bias: sumA !== 0 ? fin((100 * sumErr) / sumA) : null,
    rmse: fin(Math.sqrt(sqErr / n)),
    mae: fin(mae),
    mase: scale !== null && scale > 0 ? fin(mae / scale) : null,
  };
}
