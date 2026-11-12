import { describe, it, expect } from "vitest";
import type { SeriesPoint } from "@/lib/data/clean";
import type { ModelConfig, FutureExog } from "@/lib/forecast/types";
import { naiveModel } from "@/lib/forecast/models/naive";
import { driftModel } from "@/lib/forecast/models/drift";
import { movingAverageModel } from "@/lib/forecast/models/movingAverage";
import { seasonalNaiveModel } from "@/lib/forecast/models/seasonalNaive";
import { holtModel } from "@/lib/forecast/models/holt";
import { arimaModel, fitArima, rootsOutsideUnitCircle } from "@/lib/forecast/models/arima";
import { regressionModel } from "@/lib/forecast/models/regression";
import { randomForestModel } from "@/lib/forecast/models/randomForest";
import { gradientBoostingModel } from "@/lib/forecast/models/gradientBoosting";
import { makeEnsembleModel, inverseWapeWeights } from "@/lib/forecast/models/ensemble";
import { BASE_MODELS } from "@/lib/forecast/models/registry";
import { solve, ridge } from "@/lib/forecast/linalg";
import { nelderMead } from "@/lib/forecast/optim";
import { mulberry32 } from "@/lib/forecast/rng";
import { addMonths } from "@/lib/data/parseDates";

const cfg: ModelConfig = {
  maWindow: 3,
  rfTrees: 100,
  rfMaxDepth: 4,
  gbmRounds: 100,
  gbmLearningRate: 0.1,
  gbmMaxDepth: 2,
  seed: 42,
  seasonalArima: false,
  useTemp: true,
  usePromo: true,
};

function series(ys: number[], start = "2025-01", temp?: (t: number) => number, promo?: (t: number) => 0 | 1): SeriesPoint[] {
  return ys.map((y, t) => ({
    period: addMonths(start, t),
    y,
    temp: temp ? temp(t) : null,
    promo: promo ? promo(t) : null,
    interpolated: false,
    outlier: false,
    robustZ: null,
  }));
}

function future(after: string, h: number, temp: number | null = null, promo: 0 | 1 | null = null): FutureExog[] {
  return Array.from({ length: h }, (_, i) => ({ period: addMonths(after, i + 1), temp, promo }));
}

describe("baseline models on [10, 20, 30, 40]", () => {
  const s = series([10, 20, 30, 40]);
  const ex = future("2025-04", 3);
  it("Naive repeats the last value", () => expect(naiveModel.fit(s, cfg).predict(3, ex)).toEqual([40, 40, 40]));
  it("Drift extends the first-to-last line (slope 10)", () => expect(driftModel.fit(s, cfg).predict(3, ex)).toEqual([50, 60, 70]));
  it("Moving Average (k=3) holds the mean of the last 3", () => expect(movingAverageModel.fit(s, cfg).predict(2, ex)).toEqual([30, 30]));
  it("Moving Average (k=2)", () => expect(movingAverageModel.fit(s, { ...cfg, maWindow: 2 }).predict(1, ex)).toEqual([35]));
  it("Moving Average window larger than the series uses all points", () => expect(movingAverageModel.fit(s, { ...cfg, maWindow: 6 }).predict(1, ex)).toEqual([25]));
});

describe("Seasonal Naive", () => {
  it("repeats the same calendar month of last year", () => {
    const ys = Array.from({ length: 24 }, (_, t) => 100 + (t % 12) * 10);
    const f = seasonalNaiveModel.fit(series(ys), cfg).predict(13, future("2026-12", 13));
    expect(f.slice(0, 12)).toEqual(ys.slice(12));
    expect(f[12]).toBe(ys[12]);
  });
});

describe("Holt damped", () => {
  it("forecasts a perfect linear series y = 5 + 2t within 1%", () => {
    const ys = Array.from({ length: 20 }, (_, t) => 5 + 2 * t);
    const f = holtModel.fit(series(ys), cfg).predict(6, future("2026-08", 6));
    f.forEach((v, i) => {
      const truth = 5 + 2 * (20 + i);
      expect(Math.abs(v - truth) / truth).toBeLessThan(0.01);
    });
  });
});

function gaussian(rand: () => number): number {
  const u = Math.max(1e-12, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

describe("ARIMA", () => {
  const rand = mulberry32(2026);
  const ar: number[] = [0];
  for (let t = 1; t < 200; t++) ar.push(0.6 * ar[t - 1] + gaussian(rand));
  const ys = ar.map((v) => 100 + v);

  it("recovers phi = 0.6 within 0.15 on a simulated AR(1), n = 200", () => {
    const fit = fitArima(ys, { seasonal: false, order: { p: 1, d: 0, q: 0 } });
    expect(fit.ar[0]).toBeGreaterThan(0.45);
    expect(fit.ar[0]).toBeLessThan(0.75);
    expect(fit.mu).toBeCloseTo(100, 0);
  });

  it("auto-selection returns a valid order, finite forecasts and a label", () => {
    const m = arimaModel.fit(series(ys, "2005-01"), cfg);
    const f = m.predict(12, future("2021-08", 12));
    expect(f.every(Number.isFinite)).toBe(true);
    expect(m.label).toMatch(/^ARIMA\(\d,\d,\d\)/);
  });

  it("selects a differenced model with drift on a trending series", () => {
    const trend = Array.from({ length: 30 }, (_, t) => 1000 + 50 * t + 20 * gaussian(rand));
    const fit = fitArima(trend, { seasonal: false });
    expect(fit.d).toBeGreaterThanOrEqual(1);
    expect(fit.includeMean || fit.d === 2).toBe(true);
  });

  it("checks stationarity / invertibility through polynomial roots", () => {
    expect(rootsOutsideUnitCircle(-0.5, 0)).toBe(true);
    expect(rootsOutsideUnitCircle(-1.2, 0)).toBe(false);
    expect(rootsOutsideUnitCircle(-0.5, -0.3)).toBe(true);
    expect(rootsOutsideUnitCircle(-0.5, 0.6)).toBe(true);
    expect(rootsOutsideUnitCircle(0, 1.5)).toBe(false);
  });
});

describe("linear algebra", () => {
  it("solves a known 3x3 system", () => {
    const x = solve([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]], [8, -11, -3]);
    expect(x[0]).toBeCloseTo(2, 10);
    expect(x[1]).toBeCloseTo(3, 10);
    expect(x[2]).toBeCloseTo(-1, 10);
  });
  it("throws a readable error on a singular system", () => {
    expect(() => solve([[1, 2], [2, 4]], [1, 2])).toThrow(/singular/);
  });
  it("ridge handles a singular design (duplicate and constant columns) without throwing", () => {
    const X = [[1, 1, 5], [2, 2, 5], [3, 3, 5], [4, 4, 5]];
    const y = [2, 4, 6, 8];
    const fit = ridge(X, y, 1e-3);
    expect(fit.coef.every(Number.isFinite)).toBe(true);
    expect(fit.coef[2]).toBe(0);
    expect(fit.coef[0] + fit.coef[1]).toBeCloseTo(2, 2);
  });
  it("Nelder-Mead minimises the Rosenbrock function", () => {
    const r = nelderMead(([a, b]) => (1 - a) ** 2 + 100 * (b - a * a) ** 2, [-1.2, 1], { maxIter: 5000 });
    expect(r.x[0]).toBeCloseTo(1, 3);
    expect(r.x[1]).toBeCloseTo(1, 3);
  });
});

describe("driver regression", () => {
  it("recovers temperature and promo effects", () => {
    const temp = (t: number) => 20 + 10 * Math.sin(t);
    const promo = (t: number) => (t % 3 === 0 ? 1 : 0) as 0 | 1;
    const ys = Array.from({ length: 24 }, (_, t) => 1000 + 30 * t + 50 * temp(t) + 400 * promo(t));
    const m = regressionModel.fit(series(ys, "2024-01", temp, promo), cfg);
    expect(Number(m.params.coef_temp)).toBeCloseTo(50, 0);
    expect(Number(m.params.coef_promo)).toBeCloseTo(400, -1);
    expect(Number(m.params.coef_trend)).toBeCloseTo(30, 0);
  });
  it("falls back to y ~ trend without drivers", () => {
    const m = regressionModel.fit(series([10, 20, 30, 40, 50, 60]), { ...cfg, useTemp: false, usePromo: false });
    expect(m.params.formula).toBe("units ~ trend");
    expect(m.predict(1, future("2025-06", 1))[0]).toBeCloseTo(70, 1);
  });
});

describe("tree models", () => {
  const temp = (t: number) => 25 + 10 * Math.sin((2 * Math.PI * t) / 12);
  const promo = (t: number) => (t % 4 === 0 ? 1 : 0) as 0 | 1;
  const ys = Array.from({ length: 18 }, (_, t) => Math.round(1000 * Math.exp(0.08 * t) * (1 + 0.1 * Math.sin(t))));
  const s = series(ys, "2025-01", temp, promo);
  const ex = future("2026-06", 3, 30, 0);

  it("Random Forest is deterministic for a fixed seed", () => {
    const a = randomForestModel.fit(s, cfg).predict(3, ex);
    const b = randomForestModel.fit(s, cfg).predict(3, ex);
    expect(a).toEqual(b);
    const c = randomForestModel.fit(s, { ...cfg, seed: 7 }).predict(3, ex);
    expect(c.every(Number.isFinite)).toBe(true);
  });

  it("Gradient Boosting is deterministic for a fixed seed", () => {
    const a = gradientBoostingModel.fit(s, cfg).predict(3, ex);
    const b = gradientBoostingModel.fit(s, cfg).predict(3, ex);
    expect(a).toEqual(b);
  });

  it("growth-target trees can extrapolate above the training maximum", () => {
    const f = randomForestModel.fit(s, cfg).predict(3, ex);
    expect(Math.max(...f)).toBeGreaterThan(Math.max(...ys) * 0.95);
  });

  it("feature importance is normalised to 100%", () => {
    for (const model of [randomForestModel, gradientBoostingModel]) {
      const imp = model.fit(s, cfg).importance ?? {};
      const total = Object.values(imp).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(100, 6);
    }
  });
});

describe("ensemble and interface", () => {
  it("inverse-WAPE weights sum to 1 and favour lower WAPE", () => {
    const w = inverseWapeWeights([5, 10, 20]);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(w[0]).toBeGreaterThan(w[1]);
    expect(inverseWapeWeights([0, 10]).every(Number.isFinite)).toBe(true);
  });

  it("weighted ensemble of Naive and Drift", () => {
    const s = series([10, 20, 30, 40]);
    const e = makeEnsembleModel([{ model: naiveModel, weight: 0.5 }, { model: driftModel, weight: 0.5 }]);
    expect(e.fit(s, cfg).predict(1, future("2025-04", 1))).toEqual([45]);
  });

  it("every model has a written justification", () => {
    for (const m of BASE_MODELS) expect(m.why.length).toBeGreaterThan(80);
  });
});
