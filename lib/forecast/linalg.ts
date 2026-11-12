/**
 * Solve A x = b with Gaussian elimination and partial pivoting.
 * Throws a readable error when the matrix is numerically singular.
 */
export function solve(A: number[][], b: number[]): number[] {
  const n = A.length;
  if (n === 0) return [];
  if (A.some((r) => r.length !== n) || b.length !== n) throw new Error("solve: matrix must be square and match the right-hand side");
  const M = A.map((row, i) => [...row, b[i]]);
  let scale = 1e-300;
  for (const row of A) for (const v of row) scale = Math.max(scale, Math.abs(v));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12 * scale) throw new Error("solve: matrix is singular");
    if (pivot !== col) {
      const tmp = M[pivot];
      M[pivot] = M[col];
      M[col] = tmp;
    }
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

export interface RidgeFit {
  intercept: number;
  /** coefficients on the ORIGINAL scale of each column */
  coef: number[];
  /** standardised coefficients (effect of a 1 standard deviation change) */
  stdCoef: number[];
  means: number[];
  sds: number[];
  dropped: boolean[];
}

/**
 * Ridge regression on standardised features; the intercept is not penalised.
 * Constant columns are dropped (coefficient 0). lambda > 0 keeps X'X + lambda*n*I invertible even
 * when columns are perfectly collinear, so a singular design never throws.
 */
export function ridge(X: number[][], y: number[], lambda = 1e-3): RidgeFit {
  const n = X.length;
  const p = n > 0 ? X[0].length : 0;
  const yMean = y.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const means: number[] = [];
  const sds: number[] = [];
  const dropped: boolean[] = [];
  for (let j = 0; j < p; j++) {
    const col = X.map((r) => r[j]);
    const m = col.reduce((a, b) => a + b, 0) / Math.max(1, n);
    const sd = Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
    means.push(m);
    sds.push(sd);
    dropped.push(!(sd > 1e-12));
  }
  const keep = dropped.map((d, j) => (d ? -1 : j)).filter((j) => j >= 0);
  const Z = X.map((r) => keep.map((j) => (r[j] - means[j]) / sds[j]));
  const k = keep.length;
  const stdCoef = new Array<number>(p).fill(0);
  if (k > 0 && n > 0) {
    const A: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    const rhs = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < k; a++) {
        rhs[a] += Z[i][a] * (y[i] - yMean);
        for (let c = 0; c < k; c++) A[a][c] += Z[i][a] * Z[i][c];
      }
    }
    // lambda is scaled by n so its strength does not depend on the sample size
    for (let a = 0; a < k; a++) A[a][a] += Math.max(lambda, 1e-10) * Math.max(1, n);
    let beta: number[];
    try {
      beta = solve(A, rhs);
    } catch {
      for (let a = 0; a < k; a++) A[a][a] += 1e-6 * Math.max(1, n);
      beta = solve(A, rhs);
    }
    keep.forEach((j, a) => {
      stdCoef[j] = beta[a];
    });
  }
  const coef = stdCoef.map((b, j) => (dropped[j] ? 0 : b / sds[j]));
  const intercept = yMean - coef.reduce((s, c, j) => s + c * means[j], 0);
  return { intercept, coef, stdCoef, means, sds, dropped };
}

export function ridgePredict(fit: RidgeFit, x: number[]): number {
  return fit.intercept + fit.coef.reduce((s, c, j) => s + c * x[j], 0);
}

export function mean(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

export function variance(v: number[]): number {
  if (v.length < 2) return 0;
  const m = mean(v);
  return v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1);
}

export function pearson(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (!(sxx > 0) || !(syy > 0)) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Ordinary least squares line y = a + b x (used for scatter fit lines). */
export function lineFit(x: number[], y: number[]): { a: number; b: number } | null {
  const n = Math.min(x.length, y.length);
  if (n < 2) return null;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  if (!(sxx > 0)) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}
