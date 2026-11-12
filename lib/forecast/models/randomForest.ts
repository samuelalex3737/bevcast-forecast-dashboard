import { ModelFitError, type ForecastModel } from "../types";
import { buildTrainingSet, recursiveGrowthForecast } from "../features";
import { buildTree, predictTree, normaliseImportance, type TreeNode } from "../trees";
import { mulberry32, deriveSeed } from "../rng";

export const randomForestModel: ForecastModel = {
  id: "rf",
  name: "Random Forest",
  family: "Machine Learning",
  minObs: 8,
  minTrain: 5,
  needsExog: false,
  why: "An ensemble of bootstrapped CART trees that captures non-linear effects (for example, temperature mattering more in summer) using lag, calendar and driver features. Key design choice: trees cannot predict outside the range they were trained on, so a forest trained on levels would cap a growing launch series at its past maximum. The target is therefore month-on-month log growth, and forecasts are compounded back to units step by step.",
  fit(train, cfg) {
    const ts = buildTrainingSet(train, cfg);
    if (ts.X.length < 3) throw new ModelFitError("needs at least 3 feature rows (5 months)");
    const rand = mulberry32(deriveSeed(cfg.seed, "rf", train.length, cfg.rfTrees, cfg.rfMaxDepth));
    const p = ts.names.length;
    const mtry = Math.max(1, Math.ceil(p / 2));
    const gain = new Array<number>(p).fill(0);
    const trees: TreeNode[] = [];
    const n = ts.X.length;
    for (let b = 0; b < cfg.rfTrees; b++) {
      const rows = Array.from({ length: n }, () => Math.floor(rand() * n));
      trees.push(buildTree(ts.X, ts.g, rows, { maxDepth: cfg.rfMaxDepth, minLeaf: 2, mtry, rand, mode: "variance" }, gain));
    }
    const predictGrowth = (x: number[]) => trees.reduce((s, t) => s + predictTree(t, x), 0) / trees.length;
    return {
      predict: (h, futureExog) => recursiveGrowthForecast(train, h, futureExog, ts.names, predictGrowth),
      params: { n_trees: cfg.rfTrees, max_depth: cfg.rfMaxDepth, mtry, min_leaf: 2, target: "MoM log growth", training_rows: n, seed: cfg.seed },
      importance: normaliseImportance(gain, ts.names),
      label: `Random Forest (${cfg.rfTrees} trees, depth ${cfg.rfMaxDepth}, growth target)`,
    };
  },
};
