import { ModelFitError, type ForecastModel, type SeriesPoint, type FutureExog } from "../types";
import { ridge, ridgePredict, type RidgeFit } from "../linalg";

export interface DriverRegression {
  fit: RidgeFit;
  names: string[];
  formula: string;
}

/** y ~ trend + temp + promo (ridge, lambda 1e-3, standardised). Falls back to y ~ trend. */
export function fitDriverRegression(train: SeriesPoint[], useTemp: boolean, usePromo: boolean): DriverRegression {
  const names = ["trend", ...(useTemp ? ["temp"] : []), ...(usePromo ? ["promo"] : [])];
  const X = train.map((p, t) => [t, ...(useTemp ? [p.temp ?? 0] : []), ...(usePromo ? [p.promo ?? 0] : [])]);
  const y = train.map((p) => p.y);
  const fit = ridge(X, y, 1e-3);
  return { fit, names, formula: `units ~ ${names.join(" + ")}` };
}

export function regressionRow(t: number, ex: FutureExog | undefined, lastTemp: number, useTemp: boolean, usePromo: boolean): number[] {
  return [t, ...(useTemp ? [ex?.temp ?? lastTemp] : []), ...(usePromo ? [ex?.promo ?? 0] : [])];
}

export const regressionModel: ForecastModel = {
  id: "regression",
  name: "Regression with drivers",
  family: "Statistical",
  minObs: 8,
  minTrain: 5,
  needsExog: false,
  why: "Explains sales with business drivers: a linear trend, temperature and the promo flag (ridge-regularised so collinear drivers cannot blow up). It is the most interpretable model: each coefficient says how many extra units one degree or one promo month is worth, which is exactly what the scenario planner varies. Without driver columns it falls back to units ~ trend.",
  fit(train, cfg) {
    if (train.length < 3) throw new ModelFitError("needs at least 3 observations");
    const useTemp = cfg.useTemp && train.some((p) => p.temp !== null);
    const usePromo = cfg.usePromo && train.some((p) => p.promo !== null);
    const reg = fitDriverRegression(train, useTemp, usePromo);
    const lastTemp = train[train.length - 1].temp ?? 0;
    const params: Record<string, number | string> = { formula: reg.formula, intercept: reg.fit.intercept, lambda: 0.001 };
    reg.names.forEach((n, i) => {
      params[`coef_${n}`] = reg.fit.coef[i];
      params[`std_coef_${n}`] = reg.fit.stdCoef[i];
    });
    return {
      predict: (h, futureExog) =>
        Array.from({ length: h }, (_, k) => Math.max(0, ridgePredict(reg.fit, regressionRow(train.length + k, futureExog[k], lastTemp, useTemp, usePromo)))),
      inSample: train.map((p, t) => ridgePredict(reg.fit, [t, ...(useTemp ? [p.temp ?? 0] : []), ...(usePromo ? [p.promo ?? 0] : [])])),
      params,
      label: reg.formula,
    };
  },
};
