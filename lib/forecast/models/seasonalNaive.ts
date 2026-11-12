import { ModelFitError, type ForecastModel } from "../types";

export const seasonalNaiveModel: ForecastModel = {
  id: "snaive",
  name: "Seasonal Naive",
  family: "Baseline",
  minObs: 24,
  minTrain: 12,
  needsExog: false,
  why: "Next month equals the same calendar month last year. It is the seasonal benchmark: with 2+ years of history it tests whether the yearly cycle repeats. It is disabled below 24 months because one year of data cannot separate seasonality from launch growth.",
  fit(train) {
    if (train.length < 12) throw new ModelFitError("needs at least 12 training months");
    const ys = train.map((p) => p.y);
    return {
      predict: (h) => Array.from({ length: h }, (_, k) => Math.max(0, ys[ys.length - 12 + (k % 12)])),
      inSample: ys.map((_, i) => (i < 12 ? null : ys[i - 12])),
      params: { season_length: 12 },
      label: "Seasonal Naive (lag 12)",
    };
  },
};
