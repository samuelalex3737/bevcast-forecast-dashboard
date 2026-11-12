import { ModelFitError, type ForecastModel } from "../types";

export const movingAverageModel: ForecastModel = {
  id: "ma",
  name: "Moving Average",
  family: "Baseline",
  minObs: 4,
  minTrain: 2,
  needsExog: false,
  why: "Averages the last k months and holds that level flat. Averaging smooths one-off spikes (a promo month, a heatwave), so it is a robust planning baseline when the series has plateaued, but it lags behind a trend.",
  fit(train, cfg) {
    if (train.length < 2) throw new ModelFitError("needs at least 2 observations");
    const k = Math.max(1, Math.min(cfg.maWindow, train.length));
    const window = train.slice(-k).map((p) => p.y);
    const level = window.reduce((a, b) => a + b, 0) / k;
    return {
      predict: (h) => new Array<number>(h).fill(Math.max(0, level)),
      inSample: train.map((_, i) => {
        if (i < 1) return null;
        const w = train.slice(Math.max(0, i - k), i).map((p) => p.y);
        return w.reduce((a, b) => a + b, 0) / w.length;
      }),
      params: { window_k: k, level },
      label: `Moving Average (k = ${k})`,
    };
  },
};
