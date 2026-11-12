export type SigmaSource = "walk-forward" | "hold-out" | "fallback";

export interface SigmaEstimate {
  sigma: number;
  source: SigmaSource;
  count: number;
}

function rms(values: number[]): number {
  return Math.sqrt(values.reduce((s, v) => s + v * v, 0) / values.length);
}

/**
 * One-step error scale. Uses walk-forward residuals (root mean square, so systematic bias also
 * widens the band). Falls back to hold-out errors, then to 10% of the latest level.
 */
export function estimateSigma(wfResiduals: number[] | null, holdoutErrors: number[] | null, lastLevel: number): SigmaEstimate {
  if (wfResiduals && wfResiduals.length >= 2) {
    const s = rms(wfResiduals);
    if (Number.isFinite(s) && s > 0) return { sigma: s, source: "walk-forward", count: wfResiduals.length };
  }
  if (holdoutErrors && holdoutErrors.length >= 1) {
    const s = rms(holdoutErrors);
    if (Number.isFinite(s) && s > 0) return { sigma: s, source: "hold-out", count: holdoutErrors.length };
  }
  return { sigma: Math.max(1, Math.abs(lastLevel) * 0.1), source: "fallback", count: 0 };
}

export interface Band {
  lower: number[];
  upper: number[];
  floored: boolean;
}

/** forecast +/- z * sigma * sqrt(h), floored at 0. */
export function band(forecast: number[], sigma: number, z: number): Band {
  let floored = false;
  const lower = forecast.map((f, i) => {
    const v = f - z * sigma * Math.sqrt(i + 1);
    if (v < 0) floored = true;
    return Math.max(0, v);
  });
  const upper = forecast.map((f, i) => Math.max(0, f + z * sigma * Math.sqrt(i + 1)));
  return { lower, upper, floored };
}

export function sigmaAt(sigma: number, h: number): number {
  return sigma * Math.sqrt(h);
}
