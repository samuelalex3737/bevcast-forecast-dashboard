import { ModelFitError, type ForecastModel } from "../types";

export interface HoltParams {
  alpha: number;
  beta: number;
  phi: number;
  level: number;
  trend: number;
  sse: number;
}

/** Run damped Holt recursions and return one-step SSE, final state and fitted values. */
export function holtFilter(y: number[], alpha: number, beta: number, phi: number) {
  let l = y[0];
  let b = y.length > 1 ? y[1] - y[0] : 0;
  let sse = 0;
  const fitted: (number | null)[] = [null];
  for (let t = 1; t < y.length; t++) {
    const f = l + phi * b;
    fitted.push(f);
    const e = y[t] - f;
    sse += e * e;
    const lNew = alpha * y[t] + (1 - alpha) * (l + phi * b);
    b = beta * (lNew - l) + (1 - beta) * phi * b;
    l = lNew;
  }
  return { l, b, sse, fitted };
}

export function fitHolt(y: number[]): HoltParams & { fitted: (number | null)[] } {
  let best: (HoltParams & { fitted: (number | null)[] }) | null = null;
  const phis = [0.8, 0.9, 0.98, 1.0];
  for (let ai = 1; ai <= 19; ai++) {
    const alpha = Math.round(ai * 5) / 100;
    for (let bi = 1; bi <= 19; bi++) {
      const beta = Math.round(bi * 5) / 100;
      for (const phi of phis) {
        const r = holtFilter(y, alpha, beta, phi);
        if (!Number.isFinite(r.sse)) continue;
        if (!best || r.sse < best.sse - 1e-9 * Math.max(1, best.sse)) {
          best = { alpha, beta, phi, level: r.l, trend: r.b, sse: r.sse, fitted: r.fitted };
        }
      }
    }
  }
  if (!best) throw new ModelFitError("grid search found no finite solution");
  return best;
}

export const holtModel: ForecastModel = {
  id: "holt",
  name: "Holt's Linear Trend (damped)",
  family: "Statistical",
  minObs: 4,
  minTrain: 3,
  needsExog: false,
  why: "Exponential smoothing that tracks a level and a trend, with recent months weighted more. The damping factor phi bends the trend flat over the horizon, which suits a launch product whose growth must slow as it matures. alpha, beta and phi are chosen by grid search on one-step-ahead error.",
  fit(train) {
    if (train.length < 3) throw new ModelFitError("needs at least 3 observations");
    const y = train.map((p) => p.y);
    const p = fitHolt(y);
    return {
      predict: (h) => {
        const out: number[] = [];
        let damp = 0;
        let pw = 1;
        for (let k = 1; k <= h; k++) {
          pw *= p.phi;
          damp += pw;
          out.push(Math.max(0, p.level + damp * p.trend));
        }
        return out;
      },
      inSample: p.fitted,
      params: { alpha: p.alpha, beta: p.beta, phi: p.phi, level: p.level, trend: p.trend },
      label: `Holt damped (alpha ${p.alpha.toFixed(2)}, beta ${p.beta.toFixed(2)}, phi ${p.phi.toFixed(2)})`,
    };
  },
};
