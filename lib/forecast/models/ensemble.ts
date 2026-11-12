import { ModelFitError, type ForecastModel, type ModelId } from "../types";

export const ENSEMBLE_WHY =
  "Combines the three best fitted models, weighting each by the inverse of its hold-out WAPE so more accurate models count more. Averaging models that make different kinds of mistakes usually cancels part of the error. Caveat: members and weights are chosen on the hold-out itself, so its hold-out score is optimistic; its walk-forward score is the fairer check.";

export interface EnsembleMember {
  model: ForecastModel;
  weight: number;
}

/** Inverse-WAPE weights (WAPE floored at 0.5% so a perfect fit cannot dominate with infinite weight). */
export function inverseWapeWeights(wapes: number[]): number[] {
  const inv = wapes.map((w) => 1 / Math.max(0.5, w));
  const s = inv.reduce((a, b) => a + b, 0);
  return inv.map((v) => v / s);
}

/** Generic ensemble model built from already-chosen members (used by tests and reproducibility checks). */
export function makeEnsembleModel(members: EnsembleMember[]): ForecastModel {
  return {
    id: "ensemble",
    name: "Ensemble (inverse-WAPE weighted)",
    family: "Ensemble",
    minObs: 8,
    minTrain: Math.max(...members.map((m) => m.model.minTrain)),
    needsExog: false,
    why: ENSEMBLE_WHY,
    fit(train, cfg) {
      if (members.length < 2) throw new ModelFitError("needs at least 2 fitted member models");
      const fitted = members.map((m) => ({ fit: m.model.fit(train, cfg), weight: m.weight, id: m.model.id as ModelId }));
      const params: Record<string, number | string> = {};
      for (const f of fitted) params[`weight_${f.id}`] = f.weight;
      return {
        predict: (h, ex) => {
          const out = new Array<number>(h).fill(0);
          for (const f of fitted) f.fit.predict(h, ex).forEach((v, k) => (out[k] += f.weight * v));
          return out;
        },
        params,
        label: `Ensemble of ${fitted.map((f) => f.id).join(", ")}`,
      };
    },
  };
}

export const ENSEMBLE_INFO = {
  id: "ensemble" as const,
  name: "Ensemble (inverse-WAPE weighted)",
  family: "Ensemble" as const,
  minObs: 8,
  why: ENSEMBLE_WHY,
};
