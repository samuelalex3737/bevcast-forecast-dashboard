import { sigmaAt } from "./intervals";

export interface PlanRow {
  period: string;
  forecast: number;
  sigma: number;
  safetyStock: number;
  recommended: number;
}

/** Safety stock = z_service * sigma_h; production = forecast + safety stock, rounded up to 100 units. */
export function productionPlan(periods: string[], forecast: number[], sigma: number, zService: number): PlanRow[] {
  return periods.map((period, i) => {
    const s = sigmaAt(sigma, i + 1);
    const safetyStock = Math.max(0, zService * s);
    const recommended = Math.ceil((Math.max(0, forecast[i]) + safetyStock) / 100) * 100;
    return { period, forecast: forecast[i], sigma: s, safetyStock, recommended };
  });
}

export interface RegionalAllocation {
  regions: string[];
  shares: number[];
  basis: string;
  rows: { period: string; values: number[]; recommended: number[] }[];
}

/** Split each forecast by the region's share of units over the last 3 months. */
export function regionalAllocation(
  regionMatrix: Record<string, number[]>,
  regions: string[],
  lastPeriods: string[],
  plan: PlanRow[],
): RegionalAllocation {
  const window = Math.min(3, ...regions.map((r) => regionMatrix[r]?.length ?? 0));
  const sums = regions.map((r) => {
    const v = regionMatrix[r] ?? [];
    return v.slice(v.length - window).reduce((a, b) => a + b, 0);
  });
  const total = sums.reduce((a, b) => a + b, 0);
  const shares = total > 0 ? sums.map((s) => s / total) : regions.map(() => 1 / Math.max(1, regions.length));
  return {
    regions,
    shares,
    basis: lastPeriods.length ? `share of units in ${lastPeriods.join(", ")}` : "equal split",
    rows: plan.map((p) => ({
      period: p.period,
      values: shares.map((s) => s * p.forecast),
      recommended: shares.map((s) => Math.ceil((s * p.recommended) / 10) * 10),
    })),
  };
}

export interface ErrorCost {
  overUnits: number;
  underUnits: number;
  wasteCost: number;
  lostMargin: number;
  total: number;
}

/** Over-forecast units cost the unit cost (waste); under-forecast units cost the lost margin. */
export function errorCost(actual: number[], forecast: number[], unitCost: number, unitPrice: number): ErrorCost {
  let over = 0;
  let under = 0;
  actual.forEach((a, i) => {
    const e = forecast[i] - a;
    if (e > 0) over += e;
    else under += -e;
  });
  const margin = Math.max(0, unitPrice - unitCost);
  const wasteCost = over * unitCost;
  const lostMargin = under * margin;
  return { overUnits: over, underUnits: under, wasteCost, lostMargin, total: wasteCost + lostMargin };
}

export interface CostComparison {
  periods: string[];
  best: ErrorCost;
  naive: ErrorCost;
  savings: number;
  savingsPct: number | null;
  perMonthSavings: number;
  unitCost: number;
  unitPrice: number;
}

export function compareCost(periods: string[], actual: number[], best: number[], naive: number[], unitCost: number, unitPrice: number): CostComparison {
  const b = errorCost(actual, best, unitCost, unitPrice);
  const n = errorCost(actual, naive, unitCost, unitPrice);
  const savings = n.total - b.total;
  return {
    periods,
    best: b,
    naive: n,
    savings,
    savingsPct: n.total > 0 ? (100 * savings) / n.total : null,
    perMonthSavings: periods.length ? savings / periods.length : 0,
    unitCost,
    unitPrice,
  };
}
