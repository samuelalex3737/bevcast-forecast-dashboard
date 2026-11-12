import type { SeriesPoint } from "@/lib/data/clean";

export type { SeriesPoint };

export const MODEL_IDS = ["naive", "drift", "ma", "snaive", "holt", "arima", "regression", "rf", "gbm", "ensemble"] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export type ModelFamily = "Baseline" | "Statistical" | "Machine Learning" | "Ensemble";

export interface FutureExog {
  period: string;
  temp: number | null;
  promo: 0 | 1 | null;
}

export interface ModelConfig {
  maWindow: number;
  rfTrees: number;
  rfMaxDepth: number;
  gbmRounds: number;
  gbmLearningRate: number;
  gbmMaxDepth: number;
  seed: number;
  seasonalArima: boolean;
  useTemp: boolean;
  usePromo: boolean;
}

export interface FittedModel {
  /** h-step recursive forecast; must return h finite numbers */
  predict(h: number, futureExog: FutureExog[]): number[];
  inSample?: (number | null)[];
  params: Record<string, number | string>;
  importance?: Record<string, number>;
  /** short display label, e.g. "ARIMA(1,1,0) + drift" */
  label?: string;
}

export interface ForecastModel {
  id: ModelId;
  name: string;
  family: ModelFamily;
  /** minimum number of monthly periods in the full series for the model to be offered */
  minObs: number;
  /** minimum training-window length the fit routine accepts */
  minTrain: number;
  needsExog: boolean;
  why: string;
  fit(train: SeriesPoint[], cfg: ModelConfig): FittedModel;
}

export class ModelFitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelFitError";
  }
}

export function assertFinite(values: number[], what: string): number[] {
  for (const v of values) if (!Number.isFinite(v)) throw new ModelFitError(`${what} produced a non-finite value`);
  return values;
}
