import { ModelFitError, type ForecastModel } from "../types";

export const naiveModel: ForecastModel = {
  id: "naive",
  name: "Naive",
  family: "Baseline",
  minObs: 4,
  minTrain: 1,
  needsExog: false,
  why: "The benchmark every model must beat: next month equals the last observed month. If a sophisticated model cannot beat Naive on WAPE, its complexity is not paying for itself. MASE is scaled by this model's in-sample error.",
  fit(train) {
    if (train.length < 1) throw new ModelFitError("needs at least 1 observation");
    const last = train[train.length - 1].y;
    return {
      predict: (h) => new Array<number>(h).fill(Math.max(0, last)),
      inSample: train.map((_, i) => (i === 0 ? null : train[i - 1].y)),
      params: { last_value: last },
      label: "Naive (last value)",
    };
  },
};
