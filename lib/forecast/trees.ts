import { sampleWithoutReplacement } from "./rng";

export type TreeNode =
  | { leaf: true; value: number }
  | { leaf: false; feature: number; threshold: number; left: TreeNode; right: TreeNode };

export interface TreeOptions {
  maxDepth: number;
  minLeaf: number;
  /** number of candidate features drawn at each split (mtry) */
  mtry: number;
  rand: () => number;
  /** "variance": CART regression (Random Forest). "xgb": second-order gain with L2 leaf weights. */
  mode: "variance" | "xgb";
  lambda?: number;
  gamma?: number;
  /** restrict splits to these feature indices (column subsampling) */
  allowedFeatures?: number[];
}

/**
 * Build one regression tree.
 * - variance mode: target = y, leaf = mean, gain = SSE reduction.
 * - xgb mode: target = gradient g (hessian 1 for squared loss), leaf = -G/(H+lambda),
 *   gain = 0.5 * [GL^2/(HL+lambda) + GR^2/(HR+lambda) - G^2/(H+lambda)] - gamma.
 * Total split gain per feature is accumulated in gainAcc for feature importance.
 */
export function buildTree(X: number[][], target: number[], rows: number[], opts: TreeOptions, gainAcc: number[], depth = 0): TreeNode {
  const lambda = opts.lambda ?? 1;
  const gamma = opts.gamma ?? 0;
  const sum = rows.reduce((s, i) => s + target[i], 0);
  const count = rows.length;
  const leafValue = opts.mode === "variance" ? sum / Math.max(1, count) : -sum / (count + lambda);
  if (depth >= opts.maxDepth || count < 2 * opts.minLeaf) return { leaf: true, value: leafValue };

  const p = X[0]?.length ?? 0;
  const pool = opts.allowedFeatures ?? Array.from({ length: p }, (_, i) => i);
  const candidates = opts.mtry >= pool.length ? pool : sampleWithoutReplacement(pool.length, opts.mtry, opts.rand).map((k) => pool[k]);

  const sumSq = rows.reduce((s, i) => s + target[i] * target[i], 0);
  const parentScore = opts.mode === "variance" ? sumSq - (sum * sum) / count : (sum * sum) / (count + lambda);

  let bestGain = 1e-12;
  let bestFeature = -1;
  let bestThreshold = 0;
  for (const f of candidates) {
    const sorted = [...rows].sort((a, b) => X[a][f] - X[b][f]);
    let leftSum = 0;
    let leftSq = 0;
    for (let k = 0; k < sorted.length - 1; k++) {
      const i = sorted[k];
      leftSum += target[i];
      leftSq += target[i] * target[i];
      const nl = k + 1;
      const nr = count - nl;
      if (nl < opts.minLeaf || nr < opts.minLeaf) continue;
      const xv = X[i][f];
      const xn = X[sorted[k + 1]][f];
      if (xn <= xv) continue;
      const rightSum = sum - leftSum;
      let gain: number;
      if (opts.mode === "variance") {
        const rightSq = sumSq - leftSq;
        const sseL = leftSq - (leftSum * leftSum) / nl;
        const sseR = rightSq - (rightSum * rightSum) / nr;
        gain = parentScore - sseL - sseR;
      } else {
        gain = 0.5 * ((leftSum * leftSum) / (nl + lambda) + (rightSum * rightSum) / (nr + lambda) - parentScore) - gamma;
      }
      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = f;
        bestThreshold = (xv + xn) / 2;
      }
    }
  }
  if (bestFeature < 0) return { leaf: true, value: leafValue };
  gainAcc[bestFeature] += bestGain;
  const leftRows = rows.filter((i) => X[i][bestFeature] <= bestThreshold);
  const rightRows = rows.filter((i) => X[i][bestFeature] > bestThreshold);
  return {
    leaf: false,
    feature: bestFeature,
    threshold: bestThreshold,
    left: buildTree(X, target, leftRows, opts, gainAcc, depth + 1),
    right: buildTree(X, target, rightRows, opts, gainAcc, depth + 1),
  };
}

export function predictTree(node: TreeNode, x: number[]): number {
  let n = node;
  while (!n.leaf) n = x[n.feature] <= n.threshold ? n.left : n.right;
  return n.value;
}

export function normaliseImportance(gain: number[], names: string[]): Record<string, number> {
  const total = gain.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  names.forEach((n, i) => {
    out[n] = total > 0 ? (100 * gain[i]) / total : 0;
  });
  return out;
}
