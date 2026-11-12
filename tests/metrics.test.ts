import { describe, it, expect } from "vitest";
import { computeMetrics, naiveScale } from "@/lib/forecast/metrics";
import { band, estimateSigma } from "@/lib/forecast/intervals";
import { productionPlan, errorCost, regionalAllocation } from "@/lib/forecast/business";

describe("forecast metrics on hand-computed vectors", () => {
  // A = [100, 200, 300], F = [110, 180, 330]
  // absolute errors: 10, 20, 30 -> sum 60; sum A = 600
  // MAPE = (10/100 + 20/200 + 30/300) / 3 * 100 = (0.1 + 0.1 + 0.1) / 3 * 100 = 10%
  //   (the build brief quoted 8.3333%, but every percentage error here is exactly 10%, so MAPE is 10%)
  // WAPE = 60 / 600 * 100 = 10%
  // Bias = (10 - 20 + 30) / 600 * 100 = +3.3333%
  // MAE = 20; RMSE = sqrt((100 + 400 + 900) / 3) = 21.6025
  const A = [100, 200, 300];
  const F = [110, 180, 330];
  const m = computeMetrics(A, F, 50);

  it("MAPE", () => expect(m.mape).toBeCloseTo(10, 4));
  it("WAPE", () => expect(m.wape).toBeCloseTo(10, 4));
  it("Bias % (positive = over-forecast)", () => expect(m.bias).toBeCloseTo(3.3333, 4));
  it("MAE and RMSE", () => {
    expect(m.mae).toBeCloseTo(20, 6);
    expect(m.rmse).toBeCloseTo(21.6025, 4);
  });
  it("MASE = MAE / naive scale", () => expect(m.mase).toBeCloseTo(0.4, 6));

  it("MAPE skips zero actuals and reports the count; WAPE still uses them", () => {
    const z = computeMetrics([0, 100], [10, 90]);
    expect(z.mapeSkipped).toBe(1);
    expect(z.mape).toBeCloseTo(10, 6);
    expect(z.wape).toBeCloseTo(20, 6);
  });

  it("all-zero actuals give null (shown as n/a), never NaN or Infinity", () => {
    const z = computeMetrics([0, 0], [5, 5]);
    expect(z.mape).toBeNull();
    expect(z.wape).toBeNull();
    expect(z.bias).toBeNull();
    expect(z.rmse).toBe(5);
  });

  it("naive scale is the mean absolute first difference", () => {
    expect(naiveScale([10, 20, 30, 40])).toBe(10);
    expect(naiveScale([5])).toBeNull();
    expect(naiveScale([5, 5, 5])).toBeNull();
  });
});

describe("intervals and business layer", () => {
  it("bands widen with sqrt(h) and floor at zero", () => {
    const b = band([100, 100, 10], 20, 1.96);
    expect(b.upper[0]).toBeCloseTo(100 + 1.96 * 20, 6);
    expect(b.upper[1]).toBeCloseTo(100 + 1.96 * 20 * Math.SQRT2, 6);
    expect(b.lower[2]).toBe(0);
    expect(b.floored).toBe(true);
  });

  it("sigma prefers walk-forward residuals, then hold-out, then a fallback", () => {
    expect(estimateSigma([3, -4], [100], 1000)).toMatchObject({ source: "walk-forward" });
    expect(estimateSigma([3], [10, -10], 1000)).toMatchObject({ source: "hold-out", sigma: 10 });
    expect(estimateSigma(null, null, 1000)).toMatchObject({ source: "fallback", sigma: 100 });
  });

  it("production plan rounds forecast + safety stock up to the nearest 100", () => {
    const plan = productionPlan(["2026-11"], [1234], 100, 1.6449);
    expect(plan[0].safetyStock).toBeCloseTo(164.49, 2);
    expect(plan[0].recommended).toBe(1400);
  });

  it("cost of error separates waste and lost margin", () => {
    const c = errorCost([100, 100], [120, 90], 1.2, 3.5);
    expect(c.overUnits).toBe(20);
    expect(c.underUnits).toBe(10);
    expect(c.wasteCost).toBeCloseTo(24, 6);
    expect(c.lostMargin).toBeCloseTo(23, 6);
  });

  it("regional allocation uses last-3-month shares that sum to 1", () => {
    const plan = productionPlan(["2026-11"], [1000], 10, 1.6449);
    const r = regionalAllocation({ A: [1, 30, 30, 30], B: [1, 10, 10, 10] }, ["A", "B"], ["x", "y", "z"], plan);
    expect(r.shares[0]).toBeCloseTo(0.75, 6);
    expect(r.shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(r.rows[0].values[0]).toBeCloseTo(750, 6);
  });
});
