import type { Cell, DataRow } from "./schema";
import { PERIOD_REGEX } from "./schema";
import { addMonths, periodToIndex, indexToPeriod } from "./parseDates";

/* ------------------------------------------------------------------ */
/* Cell cleaning                                                       */
/* ------------------------------------------------------------------ */

const NULL_TOKENS = new Set(["", "-", "--", "na", "n/a", "nan", "null", "none", "missing", "#n/a", "?"]);

/**
 * Convert a messy cell to a number. Strips currency codes and symbols, thousands separators,
 * whitespace and trailing units. Accounting negatives "(1,200)" become -1200.
 * Returns null for blank or non-numeric content.
 */
export function cleanNumber(cell: Cell): number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "boolean") return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  let s = String(cell).trim();
  if (NULL_TOKENS.has(s.toLowerCase())) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Remove currency codes / words and symbols.
  s = s.replace(/(aed|dhs|dh|usd|eur|gbp|sar|inr|units|unit|pcs|cases|case)/gi, "");
  s = s.replace(/د\.إ/g, "");
  s = s.replace(/[$€£¥₹]/g, "");
  s = s.replace(/\s+/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (s === "") return null;
  // European format 1.234.567,89
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  if (!/^\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Convert promo-like content to 0/1. Unknown text becomes null. */
export function cleanPromo(cell: Cell): 0 | 1 | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "boolean") return cell ? 1 : 0;
  if (typeof cell === "number") return Number.isFinite(cell) ? (cell > 0 ? 1 : 0) : null;
  const s = String(cell).trim().toLowerCase();
  if (NULL_TOKENS.has(s)) return null;
  if (["1", "yes", "y", "true", "t", "on", "promo", "x"].includes(s)) return 1;
  if (["0", "no", "n", "false", "f", "off"].includes(s)) return 0;
  const n = cleanNumber(s);
  if (n !== null) return n > 0 ? 1 : 0;
  return null;
}

export function cleanRegion(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  return String(cell).replace(/\s+/g, " ").trim().slice(0, 80);
}

/* ------------------------------------------------------------------ */
/* Preprocessing pipeline (Task 1)                                      */
/* ------------------------------------------------------------------ */

export interface SeriesPoint {
  period: string;
  y: number;
  temp: number | null;
  promo: 0 | 1 | null;
  interpolated: boolean;
  outlier: boolean;
  robustZ: number | null;
}

export interface PipelineStep {
  id: string;
  label: string;
  before: number;
  after: number;
  unit: string;
  detail: string;
}

export interface PrepDiagnostics {
  invalidRows: number;
  duplicatesMerged: number;
  duplicateKeys: string[];
  wasUnsorted: boolean;
  missingPeriods: string[];
  blankUnits: number;
  interpolatedPeriods: string[];
  lateLaunchRegions: string[];
  carriedForward: string[];
  zeroPeriods: string[];
  outlierPeriods: { period: string; z: number; value: number }[];
  emptyScopeFallback: boolean;
}

export interface PreparedData {
  points: SeriesPoint[];
  regions: string[];
  scopeRegions: string[];
  /** In-scope region values aligned to points[].period (after gap handling). */
  regionMatrix: Record<string, number[]>;
  pipeline: PipelineStep[];
  diagnostics: PrepDiagnostics;
  hasTemp: boolean;
  hasPromo: boolean;
}

export interface PrepOptions {
  /** null or empty = all regions summed */
  scope: string[] | null;
  fillGaps: boolean;
}

interface MergedRow {
  period: string;
  region: string;
  units: number | null;
  temps: number[];
  promo: 0 | 1 | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Robust outlier scores. Each point is compared with a running median of its log-level and its
 * neighbours (Tukey end-point rule at the edges), so a growing launch series is not flagged just
 * for growing. Scores use median/MAD; when MAD is 0 (a perfectly smooth series) the scaled mean
 * absolute deviation is used instead.
 */
export function robustZScores(values: number[]): (number | null)[] {
  const n = values.length;
  if (n < 5) return values.map(() => null);
  const l = values.map((v) => Math.log(Math.max(0, v) + 1));
  const resid = l.map((v, t) => {
    let neighbourhood: number[];
    if (t === 0) neighbourhood = [l[0], l[1], 2 * l[1] - l[2]];
    else if (t === n - 1) neighbourhood = [l[n - 1], l[n - 2], 2 * l[n - 2] - l[n - 3]];
    else neighbourhood = [l[t - 1], l[t], l[t + 1]];
    return v - median(neighbourhood);
  });
  const med = median(resid);
  const absDev = resid.map((r) => Math.abs(r - med));
  const mad = median(absDev);
  let scale = mad / 0.6745;
  if (!(scale > 1e-9)) {
    const meanAD = absDev.reduce((a, b) => a + b, 0) / n;
    scale = meanAD * 1.2533;
  }
  // Scale floor of 0.05 log points (about 5%): on a very smooth series the MAD collapses towards
  // zero, and without a floor ordinary 5-8% wiggles would be flagged. With the floor a month must
  // deviate by roughly 17%+ from its local trend (3.5 x 5%) before it can be called an outlier.
  scale = Math.max(scale, 0.05);
  return resid.map((r) => (r - med) / scale);
}

export const OUTLIER_Z = 3.5;

export function preprocess(rows: DataRow[], opts: PrepOptions): PreparedData {
  const pipeline: PipelineStep[] = [];
  const diag: PrepDiagnostics = {
    invalidRows: 0,
    duplicatesMerged: 0,
    duplicateKeys: [],
    wasUnsorted: false,
    missingPeriods: [],
    blankUnits: 0,
    interpolatedPeriods: [],
    lateLaunchRegions: [],
    carriedForward: [],
    zeroPeriods: [],
    outlierPeriods: [],
    emptyScopeFallback: false,
  };

  pipeline.push({ id: "raw", label: "Raw rows", before: rows.length, after: rows.length, unit: "rows", detail: "Rows in the current dataset (uploaded, pasted or edited)." });

  // 1. Validate
  const valid = rows.filter((r) => PERIOD_REGEX.test(r.period) && r.region.trim() !== "" && (r.units === null || (Number.isFinite(r.units) && r.units >= 0)));
  diag.invalidRows = rows.length - valid.length;
  pipeline.push({
    id: "validate",
    label: "Cleaned rows",
    before: rows.length,
    after: valid.length,
    unit: "rows",
    detail: diag.invalidRows > 0 ? `${diag.invalidRows} row(s) with an invalid period, region or negative units were removed.` : "Every row has a valid period, region and non-negative units.",
  });

  // 2. Sort check
  for (let i = 1; i < valid.length; i++) {
    const a = valid[i - 1];
    const b = valid[i];
    if (a.period > b.period) {
      diag.wasUnsorted = true;
      break;
    }
  }

  // 3. Merge duplicates (period + region)
  const merged = new Map<string, MergedRow>();
  for (const r of valid) {
    const region = r.region.trim();
    const key = `${r.period}|${region}`;
    if (r.units === null) diag.blankUnits += 1;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { period: r.period, region, units: r.units, temps: r.temp === null ? [] : [r.temp], promo: r.promo });
    } else {
      diag.duplicatesMerged += 1;
      if (!diag.duplicateKeys.includes(key)) diag.duplicateKeys.push(key);
      existing.units = existing.units === null ? r.units : r.units === null ? existing.units : existing.units + r.units;
      if (r.temp !== null) existing.temps.push(r.temp);
      existing.promo = existing.promo === 1 || r.promo === 1 ? 1 : existing.promo ?? r.promo;
    }
  }
  const mergedRows = Array.from(merged.values()).sort((a, b) => (a.period === b.period ? a.region.localeCompare(b.region) : a.period < b.period ? -1 : 1));
  pipeline.push({
    id: "dedupe",
    label: "Duplicates merged and sorted",
    before: valid.length,
    after: mergedRows.length,
    unit: "rows",
    detail:
      (diag.duplicatesMerged > 0 ? `${diag.duplicatesMerged} duplicate period/region row(s) were summed. ` : "No duplicate period/region rows. ") +
      (diag.wasUnsorted ? "Rows were not in date order and have been sorted." : "Rows were already in date order."),
  });

  // 4. Regions and scope
  const totals = new Map<string, number>();
  for (const r of mergedRows) totals.set(r.region, (totals.get(r.region) ?? 0) + (r.units ?? 0));
  const regions = Array.from(totals.keys()).sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || a.localeCompare(b));
  let scopeRegions = opts.scope && opts.scope.length > 0 ? regions.filter((r) => opts.scope?.includes(r)) : [...regions];
  if (scopeRegions.length === 0) {
    scopeRegions = [...regions];
    if (opts.scope && opts.scope.length > 0) diag.emptyScopeFallback = true;
  }
  const scoped = mergedRows.filter((r) => scopeRegions.includes(r.region));
  pipeline.push({
    id: "scope",
    label: "Region scope",
    before: mergedRows.length,
    after: scoped.length,
    unit: "rows",
    detail: scopeRegions.length === regions.length ? `All ${regions.length} region(s) are summed into one series.` : `Filtered to ${scopeRegions.join(", ")}.`,
  });

  if (scoped.length === 0) {
    pipeline.push({ id: "aggregate", label: "Monthly aggregation", before: 0, after: 0, unit: "months", detail: "No rows to aggregate." });
    return { points: [], regions, scopeRegions, regionMatrix: {}, pipeline, diagnostics: diag, hasTemp: false, hasPromo: false };
  }

  const hasTemp = scoped.some((r) => r.temps.length > 0);
  const hasPromo = scoped.some((r) => r.promo !== null);

  // 5. Build the full monthly grid
  const startIdx = periodToIndex(scoped[0].period);
  const endIdx = periodToIndex(scoped[scoped.length - 1].period);
  const grid: string[] = [];
  for (let i = startIdx; i <= endIdx; i++) grid.push(indexToPeriod(i));
  const periodsWithAnyRow = new Set(scoped.map((r) => r.period));
  const periodsWithData = new Set(scoped.filter((r) => r.units !== null).map((r) => r.period));
  diag.missingPeriods = grid.filter((p) => !periodsWithData.has(p));

  pipeline.push({
    id: "aggregate",
    label: "Monthly aggregation",
    before: scoped.length,
    after: periodsWithAnyRow.size,
    unit: "months",
    detail: `${scoped.length} row(s) summed into ${periodsWithAnyRow.size} monthly total(s) covering ${grid[0]} to ${grid[grid.length - 1]}.`,
  });

  // 6. Per-region series with gap handling
  const lookup = new Map<string, MergedRow>();
  for (const r of scoped) lookup.set(`${r.period}|${r.region}`, r);
  const regionRaw: Record<string, (number | null)[]> = {};
  const regionInterp: Record<string, boolean[]> = {};
  for (const region of scopeRegions) {
    const vals = grid.map((p) => lookup.get(`${p}|${region}`)?.units ?? null);
    const interp = grid.map(() => false);
    const firstIdx = vals.findIndex((v) => v !== null);
    let lastIdx = -1;
    for (let i = vals.length - 1; i >= 0; i--) if (vals[i] !== null) { lastIdx = i; break; }
    if (firstIdx === -1) {
      regionRaw[region] = grid.map(() => 0);
      regionInterp[region] = interp;
      continue;
    }
    // Leading gap: region launched later than others, so sales before launch are zero.
    if (firstIdx > 0) {
      for (let i = 0; i < firstIdx; i++) vals[i] = 0;
      diag.lateLaunchRegions.push(region);
    }
    if (opts.fillGaps) {
      for (let i = firstIdx + 1; i < lastIdx; i++) {
        if (vals[i] !== null) continue;
        let j = i;
        while (j < lastIdx && vals[j] === null) j++;
        const left = vals[i - 1] as number;
        const right = vals[j] as number;
        for (let k = i; k < j; k++) {
          vals[k] = left + ((right - left) * (k - i + 1)) / (j - i + 1);
          interp[k] = true;
        }
        i = j;
      }
      for (let i = lastIdx + 1; i < vals.length; i++) {
        vals[i] = vals[lastIdx];
        interp[i] = true;
        if (!diag.carriedForward.includes(`${region} ${grid[i]}`)) diag.carriedForward.push(`${region} ${grid[i]}`);
      }
    }
    regionRaw[region] = vals;
    regionInterp[region] = interp;
  }

  // 7. Aggregate across regions
  const aggUnits: (number | null)[] = grid.map((_, t) => {
    let sum = 0;
    for (const region of scopeRegions) {
      const v = regionRaw[region][t];
      if (v === null) return null;
      sum += v;
    }
    return sum;
  });
  const aggInterp = grid.map((_, t) => scopeRegions.some((r) => regionInterp[r][t]));

  const aggTemp: (number | null)[] = grid.map((p, t) => {
    let wSum = 0;
    let vSum = 0;
    let plain = 0;
    let count = 0;
    for (const region of scopeRegions) {
      const row = lookup.get(`${p}|${region}`);
      if (!row || row.temps.length === 0) continue;
      const temp = row.temps.reduce((a, b) => a + b, 0) / row.temps.length;
      const w = Math.max(0, regionRaw[region][t] ?? 0);
      wSum += w;
      vSum += w * temp;
      plain += temp;
      count += 1;
    }
    if (count === 0) return null;
    return wSum > 0 ? vSum / wSum : plain / count;
  });
  if (hasTemp) {
    // Fill temperature gaps linearly, carrying the nearest value at the edges.
    const known = aggTemp.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
    for (let t = 0; t < aggTemp.length; t++) {
      if (aggTemp[t] !== null) continue;
      const left = [...known].reverse().find((i) => i < t);
      const right = known.find((i) => i > t);
      if (left !== undefined && right !== undefined) {
        const lv = aggTemp[left] as number;
        const rv = aggTemp[right] as number;
        aggTemp[t] = lv + ((rv - lv) * (t - left)) / (right - left);
      } else if (left !== undefined) aggTemp[t] = aggTemp[left];
      else if (right !== undefined) aggTemp[t] = aggTemp[right];
    }
  }
  const aggPromo: (0 | 1 | null)[] = grid.map((p) => {
    if (!hasPromo) return null;
    let any: 0 | 1 = 0;
    for (const region of scopeRegions) if (lookup.get(`${p}|${region}`)?.promo === 1) any = 1;
    return any;
  });

  let points: SeriesPoint[] = grid.map((period, t) => ({
    period,
    y: aggUnits[t] ?? Number.NaN,
    temp: aggTemp[t],
    promo: aggPromo[t],
    interpolated: aggInterp[t],
    outlier: false,
    robustZ: null,
  }));
  const keepIdx = points.map((p, i) => (Number.isFinite(p.y) ? i : -1)).filter((i) => i >= 0);
  points = keepIdx.map((i) => points[i]);
  const regionMatrix: Record<string, number[]> = {};
  for (const region of scopeRegions) regionMatrix[region] = keepIdx.map((i) => regionRaw[region][i] ?? 0);

  diag.interpolatedPeriods = points.filter((p) => p.interpolated).map((p) => p.period);
  pipeline.push({
    id: "gaps",
    label: opts.fillGaps ? "Gaps interpolated" : "Gaps left open",
    before: periodsWithData.size,
    after: points.length,
    unit: "months",
    detail:
      diag.missingPeriods.length === 0
        ? "The monthly sequence is complete. Nothing to fill."
        : opts.fillGaps
          ? `${diag.interpolatedPeriods.length} month(s) filled by linear interpolation (${diag.interpolatedPeriods.join(", ")}). They are drawn as hollow markers.`
          : `${grid.length - points.length} month(s) left out (${diag.missingPeriods.join(", ")}). Models treat the remaining months as consecutive.`,
  });

  // 8. Outliers and zeros
  const z = robustZScores(points.map((p) => p.y));
  points = points.map((p, i) => {
    const zi = z[i];
    const outlier = zi !== null && Math.abs(zi) > OUTLIER_Z;
    if (outlier) diag.outlierPeriods.push({ period: p.period, z: zi, value: p.y });
    return { ...p, robustZ: zi, outlier };
  });
  diag.zeroPeriods = points.filter((p) => p.y === 0).map((p) => p.period);

  return { points, regions, scopeRegions, regionMatrix, pipeline, diagnostics: diag, hasTemp, hasPromo };
}

/** Utility used by the "Add next month" form. */
export function nextPeriodAfter(rows: DataRow[]): string | null {
  const periods = rows.map((r) => r.period).filter((p) => PERIOD_REGEX.test(p)).sort();
  if (periods.length === 0) return null;
  return addMonths(periods[periods.length - 1], 1);
}
