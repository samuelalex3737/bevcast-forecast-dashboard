import type { ForecastModel, ModelFamily, ModelId } from "../types";
import { naiveModel } from "./naive";
import { driftModel } from "./drift";
import { movingAverageModel } from "./movingAverage";
import { seasonalNaiveModel } from "./seasonalNaive";
import { holtModel } from "./holt";
import { arimaModel } from "./arima";
import { regressionModel } from "./regression";
import { randomForestModel } from "./randomForest";
import { gradientBoostingModel } from "./gradientBoosting";
import { ENSEMBLE_INFO } from "./ensemble";

/** Every single (non-ensemble) model, in display order. */
export const BASE_MODELS: ForecastModel[] = [
  naiveModel,
  driftModel,
  movingAverageModel,
  seasonalNaiveModel,
  holtModel,
  arimaModel,
  regressionModel,
  randomForestModel,
  gradientBoostingModel,
];

export interface ModelInfo {
  id: ModelId;
  name: string;
  family: ModelFamily;
  minObs: number;
  why: string;
}

export const MODEL_INFO: ModelInfo[] = [
  ...BASE_MODELS.map((m) => ({ id: m.id, name: m.name, family: m.family, minObs: m.minObs, why: m.why })),
  ENSEMBLE_INFO,
];

export function modelInfo(id: ModelId): ModelInfo {
  const found = MODEL_INFO.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown model ${id}`);
  return found;
}

export function shortName(id: ModelId): string {
  switch (id) {
    case "naive": return "Naive";
    case "drift": return "Drift";
    case "ma": return "Moving Avg";
    case "snaive": return "Seasonal Naive";
    case "holt": return "Holt (damped)";
    case "arima": return "ARIMA";
    case "regression": return "Regression";
    case "rf": return "Random Forest";
    case "gbm": return "Gradient Boosting";
    case "ensemble": return "Ensemble";
  }
}
