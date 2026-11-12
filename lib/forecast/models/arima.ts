import { ModelFitError, type ForecastModel } from "../types";
import { nelderMead } from "../optim";
import { mean, variance } from "../linalg";

/** true when every root of 1 + c1 z + c2 z^2 lies strictly outside the unit circle */
export function rootsOutsideUnitCircle(c1: number, c2: number, margin = 1e-3): boolean {
  if (Math.abs(c2) < 1e-12) {
    if (Math.abs(c1) < 1e-12) return true;
    return Math.abs(c1) < 1 - margin;
  }
  const disc = c1 * c1 - 4 * c2;
  if (disc >= 0) {
    const s = Math.sqrt(disc);
    const r1 = (-c1 + s) / (2 * c2);
    const r2 = (-c1 - s) / (2 * c2);
    return Math.abs(r1) > 1 + margin && Math.abs(r2) > 1 + margin;
  }
  // complex pair: |z|^2 = 1 / c2
  return c2 > 0 && Math.sqrt(1 / c2) > 1 + margin;
}

function diff(x: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < x.length; i++) out.push(x[i] - x[i - 1]);
  return out;
}

export interface ArimaFit {
  p: number;
  d: number;
  q: number;
  D: number;
  includeMean: boolean;
  /** mean of the differenced series in original units (drift when d = 1) */
  mu: number;
  ar: number[];
  ma: number[];
  sigma2: number;
  aicc: number | null;
  /** residuals of the differenced series, standardised scale converted back */
  resid: number[];
  w: number[];
  levels: number[][];
  y: number[];
  label: string;
}

interface ArmaResult {
  mu: number;
  ar: number[];
  ma: number[];
  sse: number;
  resid: number[];
}

/** Conditional-sum-of-squares residuals on the common effective sample starting at `start`. */
function cssResiduals(z: number[], mu: number, ar: number[], ma: number[]): number[] {
  const e = new Array<number>(z.length).fill(0);
  const p = ar.length;
  for (let t = p; t < z.length; t++) {
    let pred = mu;
    for (let i = 0; i < p; i++) pred += ar[i] * (z[t - 1 - i] - mu);
    for (let j = 0; j < ma.length; j++) if (t - 1 - j >= 0) pred += ma[j] * e[t - 1 - j];
    e[t] = z[t] - pred;
  }
  return e;
}

function fitArma(z: number[], p: number, q: number, includeMean: boolean, start: number): ArmaResult | null {
  const unpack = (x: number[]) => {
    let k = 0;
    const mu = includeMean ? x[k++] : 0;
    const ar = x.slice(k, k + p);
    const ma = x.slice(k + p, k + p + q);
    return { mu, ar, ma };
  };
  const objective = (x: number[]) => {
    const { mu, ar, ma } = unpack(x);
    if (!rootsOutsideUnitCircle(-(ar[0] ?? 0), -(ar[1] ?? 0))) return 1e300;
    if (!rootsOutsideUnitCircle(ma[0] ?? 0, ma[1] ?? 0)) return 1e300;
    const e = cssResiduals(z, mu, ar, ma);
    let sse = 0;
    for (let t = start; t < z.length; t++) sse += e[t] * e[t];
    return sse;
  };
  const x0 = [...(includeMean ? [mean(z)] : []), ...new Array<number>(p).fill(0), ...new Array<number>(q).fill(0)];
  if (x0.length === 0) {
    const e = cssResiduals(z, 0, [], []);
    let sse = 0;
    for (let t = start; t < z.length; t++) sse += e[t] * e[t];
    return { mu: 0, ar: [], ma: [], sse, resid: e };
  }
  let r = nelderMead(objective, x0, { step: 0.2, maxIter: 600 });
  r = nelderMead(objective, r.x, { step: 0.05, maxIter: 600 });
  if (!(r.fx < 1e299)) return null;
  const { mu, ar, ma } = unpack(r.x);
  if (!rootsOutsideUnitCircle(-(ar[0] ?? 0), -(ar[1] ?? 0)) || !rootsOutsideUnitCircle(ma[0] ?? 0, ma[1] ?? 0)) return null;
  return { mu, ar, ma, sse: r.fx, resid: cssResiduals(z, mu, ar, ma) };
}

export interface ArimaOptions {
  seasonal: boolean;
  /** force an order (used by tests and for fixed-order fits); otherwise auto-selected */
  order?: { p: number; d: number; q: number; D?: number };
}

/**
 * Auto ARIMA:
 * 1. Optional seasonal difference at lag 12 (24+ months and the option enabled) if it cuts variance by more than 10%.
 * 2. d = number of regular differences while the variance drops by more than 10% (max 2).
 * 3. Grid p, q in 0..2 fitted by Conditional Sum of Squares with Nelder-Mead on a standardised
 *    series; non-stationary or non-invertible solutions are rejected via the polynomial roots.
 * 4. Selection by AICc computed on the same effective sample (t >= 2) for every candidate.
 */
export function fitArima(y: number[], opts: ArimaOptions): ArimaFit {
  if (y.length < 4) throw new ModelFitError("needs at least 4 observations");
  let x = y.slice();
  let D = 0;
  if (opts.order) {
    D = opts.order.D ?? 0;
    if (D === 1) x = y.slice(12).map((v, i) => v - y[i]);
  } else if (opts.seasonal && y.length >= 24) {
    const s = y.slice(12).map((v, i) => v - y[i]);
    if (variance(s) < 0.9 * variance(y)) {
      x = s;
      D = 1;
    }
  }

  const levels: number[][] = [x];
  let d = 0;
  if (opts.order) {
    d = opts.order.d;
    for (let k = 0; k < d; k++) levels.push(diff(levels[levels.length - 1]));
  } else {
    while (d < 2 && levels[d].length > 4) {
      const dx = diff(levels[d]);
      if (variance(dx) < 0.9 * variance(levels[d])) {
        levels.push(dx);
        d += 1;
      } else break;
    }
  }
  const w = levels[d];
  if (w.length < 3) throw new ModelFitError("too few observations after differencing");
  const includeMean = d + D < 2;

  const wMean = mean(w);
  const wSd = Math.sqrt(variance(w)) || 1;
  const z = w.map((v) => (v - wMean) / wSd);
  const start = 2;
  const m = z.length - start;

  type Cand = { p: number; q: number; res: ArmaResult; aicc: number | null };
  const cands: Cand[] = [];
  const orders = opts.order ? [[opts.order.p, opts.order.q]] : [0, 1, 2].flatMap((p) => [0, 1, 2].map((q) => [p, q]));
  for (const [p, q] of orders) {
    const k = p + q + (includeMean ? 1 : 0) + 1;
    const aiccValid = m - k - 1 > 0;
    if (!aiccValid && !opts.order && !(p === 0 && q === 0)) continue;
    const res = fitArma(z, p, q, includeMean, start);
    if (!res) continue;
    const sse = Math.max(res.sse, 1e-12 * Math.max(1, m));
    const aicc = aiccValid ? m * Math.log(sse / m) + 2 * k + (2 * k * (k + 1)) / (m - k - 1) : null;
    cands.push({ p, q, res, aicc });
  }
  if (cands.length === 0) throw new ModelFitError("no stationary and invertible ARMA solution found");
  const scored = cands.filter((c) => c.aicc !== null);
  const best = scored.length > 0 ? scored.reduce((a, b) => ((b.aicc as number) < (a.aicc as number) ? b : a)) : cands[0];

  const muOrig = best.res.mu * wSd + wMean;
  const residOrig = best.res.resid.map((e) => e * wSd);
  const effective = residOrig.slice(start);
  const sigma2 = effective.length ? effective.reduce((s, e) => s + e * e, 0) / effective.length : 0;
  const seasonalTag = D === 1 ? "(0,1,0)[12]" : "";
  const meanTag = includeMean ? (d + D === 0 ? " + mean" : " + drift") : "";
  return {
    p: best.p,
    d,
    q: best.q,
    D,
    includeMean,
    mu: includeMean ? muOrig : 0,
    ar: best.res.ar,
    ma: best.res.ma,
    sigma2,
    aicc: best.aicc,
    resid: residOrig,
    w,
    levels,
    y,
    label: `ARIMA(${best.p},${d},${best.q})${seasonalTag}${meanTag}`,
  };
}

/** Recursive forecast of the differenced series, then undo the differencing. */
export function forecastArima(fit: ArimaFit, h: number): number[] {
  const { ar, ma, mu, w, resid } = fit;
  const wExt = w.slice();
  const eExt = resid.slice();
  for (let k = 0; k < h; k++) {
    const t = wExt.length;
    let pred = mu;
    for (let i = 0; i < ar.length; i++) pred += ar[i] * ((wExt[t - 1 - i] ?? mu) - mu);
    for (let j = 0; j < ma.length; j++) pred += ma[j] * (eExt[t - 1 - j] ?? 0);
    wExt.push(pred);
    eExt.push(0);
  }
  let future = wExt.slice(w.length);
  for (let level = fit.d - 1; level >= 0; level--) {
    const base = fit.levels[level];
    let last = base[base.length - 1];
    future = future.map((v) => {
      last = last + v;
      return last;
    });
  }
  if (fit.D === 1) {
    const yExt = fit.y.slice();
    future = future.map((v) => {
      const val = v + yExt[yExt.length - 12];
      yExt.push(val);
      return val;
    });
  }
  return future.map((v) => (Number.isFinite(v) ? Math.max(0, v) : Number.NaN));
}

export const arimaModel: ForecastModel = {
  id: "arima",
  name: "ARIMA (auto, with drift)",
  family: "Statistical",
  minObs: 8,
  minTrain: 5,
  needsExog: false,
  why: "The classical statistical workhorse: differencing removes the trend, then autoregressive (p) and moving-average (q) terms model what is left. The order is chosen automatically by AICc, a criterion that penalises extra parameters, which matters on a short series. A drift term lets it keep a trend.",
  fit(train, cfg) {
    const y = train.map((p) => p.y);
    const fit = fitArima(y, { seasonal: cfg.seasonalArima });
    const params: Record<string, number | string> = { order: `(${fit.p},${fit.d},${fit.q})`, d: fit.d, seasonal_D: fit.D };
    fit.ar.forEach((v, i) => (params[`ar${i + 1}`] = v));
    fit.ma.forEach((v, i) => (params[`ma${i + 1}`] = v));
    if (fit.includeMean) params[fit.d + fit.D === 0 ? "mean" : "drift"] = fit.mu;
    params.sigma = Math.sqrt(fit.sigma2);
    if (fit.aicc !== null) params.aicc = fit.aicc;
    return {
      predict: (h) => {
        const f = forecastArima(fit, h);
        if (f.some((v) => !Number.isFinite(v))) throw new ModelFitError("forecast diverged");
        return f;
      },
      params,
      label: fit.label,
    };
  },
};
