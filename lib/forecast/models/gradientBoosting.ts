import { ModelFitError, type ForecastModel } from "../types";
import { buildTrainingSet, recursiveGrowthForecast } from "../features";
import { buildTree, predictTree, normaliseImportance, type TreeNode } from "../trees";
import { mulberry32, deriveSeed, sampleWithoutReplacement } from "../rng";

export const gradientBoostingModel: ForecastModel = {
  id: "gbm",
  name: "Gradient Boosting (XGBoost-style, implemented from scratch)",
  family: "Machine Learning",
  minObs: 8,
  minTrain: 5,
  needsExog: false,
  why: "Builds shallow trees one after another, each correcting the errors of the previous ones, using XGBoost's second-order split gain with L2-regularised leaf weights (lambda = 1), shrinkage, and 80% row and column subsampling. It usually beats a forest on tabular data but overfits small samples easily, which the hold-out and walk-forward scores reveal. Like the forest, it predicts log growth so it can extrapolate a trend.",
  fit(train, cfg) {
    const ts = buildTrainingSet(train, cfg);
    if (ts.X.length < 3) throw new ModelFitError("needs at least 3 feature rows (5 months)");
    const rand = mulberry32(deriveSeed(cfg.seed, "gbm", train.length, cfg.gbmRounds, cfg.gbmMaxDepth, cfg.gbmLearningRate));
    const n = ts.X.length;
    const p = ts.names.length;
    const base = ts.g.reduce((a, b) => a + b, 0) / n;
    const pred = new Array<number>(n).fill(base);
    const gain = new Array<number>(p).fill(0);
    const trees: TreeNode[] = [];
    const rowsPerTree = Math.max(2, Math.round(0.8 * n));
    const colsPerTree = Math.max(1, Math.round(0.8 * p));
    for (let r = 0; r < cfg.gbmRounds; r++) {
      // squared loss: gradient = pred - y, hessian = 1
      const grad = pred.map((v, i) => v - ts.g[i]);
      const rows = sampleWithoutReplacement(n, rowsPerTree, rand);
      const cols = sampleWithoutReplacement(p, colsPerTree, rand);
      const tree = buildTree(ts.X, grad, rows, { maxDepth: cfg.gbmMaxDepth, minLeaf: 2, mtry: cols.length, rand, mode: "xgb", lambda: 1, gamma: 0, allowedFeatures: cols }, gain);
      trees.push(tree);
      for (let i = 0; i < n; i++) pred[i] += cfg.gbmLearningRate * predictTree(tree, ts.X[i]);
    }
    const predictGrowth = (x: number[]) => base + cfg.gbmLearningRate * trees.reduce((s, t) => s + predictTree(t, x), 0);
    return {
      predict: (h, futureExog) => recursiveGrowthForecast(train, h, futureExog, ts.names, predictGrowth),
      params: {
        rounds: cfg.gbmRounds,
        learning_rate: cfg.gbmLearningRate,
        max_depth: cfg.gbmMaxDepth,
        lambda: 1,
        gamma: 0,
        subsample: 0.8,
        colsample: 0.8,
        target: "MoM log growth",
        training_rows: n,
        seed: cfg.seed,
      },
      importance: normaliseImportance(gain, ts.names),
      label: `Gradient Boosting (${cfg.gbmRounds} rounds, lr ${cfg.gbmLearningRate}, depth ${cfg.gbmMaxDepth})`,
    };
  },
};
