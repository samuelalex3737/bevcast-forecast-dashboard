import { ModelFitError, type ForecastModel } from "../types";

export const driftModel: ForecastModel = {
  id: "drift",
  name: "Drift",
  family: "Baseline",
  minObs: 4,
  minTrain: 2,
  needsExog: false,
  why: "Draws a straight line from the first to the last observation and extends it. It is the simplest way to carry a launch-phase growth trend forward, and it shows what happens if we assume the average historical growth simply continues.",
  fit(train) {
    if (train.length < 2) throw new ModelFitError("needs at least 2 observations");
    const first = train[0].y;
    const last = train[train.length - 1].y;
    const slope = (last - first) / (train.length - 1);
    return {
      predict: (h) => Array.from({ length: h }, (_, k) => Math.max(0, last + slope * (k + 1))),
      inSample: train.map((_, i) => (i === 0 ? null : train[i - 1].y + slope)),
      params: { slope_per_month: slope, last_value: last },
      label: `Drift (${slope >= 0 ? "+" : ""}${Math.round(slope).toLocaleString("en-US")} units/month)`,
    };
  },
};
