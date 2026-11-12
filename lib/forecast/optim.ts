export interface NelderMeadOptions {
  maxIter?: number;
  tol?: number;
  step?: number[] | number;
}

export interface NelderMeadResult {
  x: number[];
  fx: number;
  iterations: number;
  converged: boolean;
}

/**
 * Nelder-Mead simplex minimiser (reflection 1, expansion 2, contraction 0.5, shrink 0.5).
 * Non-finite objective values are treated as +Infinity, so penalty constraints are safe.
 */
export function nelderMead(f: (x: number[]) => number, x0: number[], opts: NelderMeadOptions = {}): NelderMeadResult {
  const n = x0.length;
  const maxIter = opts.maxIter ?? 250 * Math.max(1, n);
  const tol = opts.tol ?? 1e-10;
  const safe = (x: number[]) => {
    const v = f(x);
    return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
  };
  if (n === 0) return { x: [], fx: safe([]), iterations: 0, converged: true };

  const steps = Array.isArray(opts.step) ? opts.step : new Array<number>(n).fill(opts.step ?? 0.1);
  let simplex: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const p = x0.slice();
    p[i] = p[i] + (steps[i] !== 0 ? steps[i] : 0.1);
    simplex.push(p);
  }
  let values = simplex.map(safe);
  let iter = 0;
  let converged = false;

  while (iter < maxIter) {
    iter++;
    const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    simplex = order.map((i) => simplex[i]);
    values = order.map((i) => values[i]);

    const best = values[0];
    const worst = values[n];
    if (Number.isFinite(worst) && Math.abs(worst - best) <= tol * (Math.abs(best) + tol)) {
      let spread = 0;
      for (const p of simplex) for (let j = 0; j < n; j++) spread = Math.max(spread, Math.abs(p[j] - simplex[0][j]));
      if (spread < 1e-8) {
        converged = true;
        break;
      }
    }

    const centroid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;

    const reflect = centroid.map((c, j) => c + (c - simplex[n][j]));
    const fr = safe(reflect);
    if (fr < values[0]) {
      const expand = centroid.map((c, j) => c + 2 * (c - simplex[n][j]));
      const fe = safe(expand);
      if (fe < fr) {
        simplex[n] = expand;
        values[n] = fe;
      } else {
        simplex[n] = reflect;
        values[n] = fr;
      }
      continue;
    }
    if (fr < values[n - 1]) {
      simplex[n] = reflect;
      values[n] = fr;
      continue;
    }
    const outside = fr < values[n];
    const contract = outside
      ? centroid.map((c, j) => c + 0.5 * (reflect[j] - c))
      : centroid.map((c, j) => c + 0.5 * (simplex[n][j] - c));
    const fc = safe(contract);
    if (fc < (outside ? fr : values[n])) {
      simplex[n] = contract;
      values[n] = fc;
      continue;
    }
    for (let i = 1; i <= n; i++) {
      simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
      values[i] = safe(simplex[i]);
    }
  }
  let bi = 0;
  for (let i = 1; i < values.length; i++) if (values[i] < values[bi]) bi = i;
  return { x: simplex[bi], fx: values[bi], iterations: iter, converged };
}
