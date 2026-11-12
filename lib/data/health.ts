import type { PreparedData } from "./clean";
import type { IngestNotice, RejectedRow } from "./schema";
import { formatPeriod } from "./parseDates";

export type HealthStatus = "pass" | "warn" | "fail";

export interface HealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  detail: string;
}

export interface HealthContext {
  ingestNotices: IngestNotice[];
  rejected: RejectedRow[];
  fillGaps: boolean;
}

function list(items: string[], max = 4): string {
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")} and ${items.length - max} more`;
}

export function buildHealthChecks(prep: PreparedData, ctx: HealthContext): HealthCheck[] {
  const d = prep.diagnostics;
  const n = prep.points.length;
  const checks: HealthCheck[] = [];

  checks.push({
    id: "length",
    label: "Series length",
    status: n < 4 ? "fail" : n < 8 ? "warn" : "pass",
    detail:
      n < 4
        ? `${n} month(s) after preprocessing. At least 4 months are needed to forecast.`
        : n < 8
          ? `${n} months. Only Naive, Drift, Moving Average and Holt can run (8+ months unlock the rest).`
          : n < 24
            ? `${n} months. All non-seasonal models run. Seasonal Naive needs 24+ months.`
            : `${n} months. All models including Seasonal Naive and seasonal ARIMA are available.`,
  });

  const rejectedCount = ctx.rejected.length + d.invalidRows;
  checks.push({
    id: "rejected",
    label: "Rejected rows",
    status: rejectedCount > 0 ? "fail" : "pass",
    detail:
      rejectedCount > 0
        ? `${rejectedCount} row(s) rejected. ${ctx.rejected.slice(0, 3).map((r) => `Line ${r.line}: ${r.reason}`).join(" ")}`.trim()
        : "No rows were rejected.",
  });

  const ingestDup = ctx.ingestNotices.find((x) => x.code === "duplicates");
  checks.push({
    id: "duplicates",
    label: "Duplicate period/region",
    status: d.duplicatesMerged > 0 || ingestDup ? "warn" : "pass",
    detail:
      d.duplicatesMerged > 0
        ? `${d.duplicatesMerged} duplicate row(s) summed (${list(d.duplicateKeys.map((k) => k.replace("|", " / ")))}).`
        : ingestDup
          ? ingestDup.message
          : "Each period and region appears once.",
  });

  const ingestSort = ctx.ingestNotices.find((x) => x.code === "unsorted");
  checks.push({
    id: "sorted",
    label: "Chronological order",
    status: d.wasUnsorted || ingestSort ? "warn" : "pass",
    detail: d.wasUnsorted || ingestSort ? "Rows were out of date order and were sorted automatically." : "Rows are in date order.",
  });

  checks.push({
    id: "gaps",
    label: "Missing months",
    status: d.missingPeriods.length > 0 ? "warn" : "pass",
    detail:
      d.missingPeriods.length === 0
        ? "The monthly sequence has no gaps."
        : ctx.fillGaps
          ? `${d.missingPeriods.length} missing month(s) (${list(d.missingPeriods.map((p) => formatPeriod(p)))}) filled by linear interpolation.`
          : `${d.missingPeriods.length} missing month(s) (${list(d.missingPeriods.map((p) => formatPeriod(p)))}) left as gaps.`,
  });

  checks.push({
    id: "blank",
    label: "Blank or non-numeric units",
    status: d.blankUnits > 0 ? "warn" : "pass",
    detail: d.blankUnits > 0 ? `${d.blankUnits} row(s) had no usable sales value and were treated as missing months.` : "All sales values are numeric.",
  });

  checks.push({
    id: "zeros",
    label: "Zero-sales months",
    status: d.zeroPeriods.length > 0 ? "warn" : "pass",
    detail:
      d.zeroPeriods.length > 0
        ? `${d.zeroPeriods.length} zero month(s) (${list(d.zeroPeriods.map((p) => formatPeriod(p)))}). MAPE skips zero actuals; WAPE still uses them.`
        : "No zero-sales months, so MAPE uses every point.",
  });

  checks.push({
    id: "outliers",
    label: "Outliers (|robust z| > 3.5)",
    status: d.outlierPeriods.length > 0 ? "warn" : "pass",
    detail:
      d.outlierPeriods.length > 0
        ? `${d.outlierPeriods.map((o) => `${formatPeriod(o.period)} (z = ${o.z.toFixed(1)})`).join(", ")} flagged on the charts. Nothing was deleted.`
        : n < 5
          ? "Outlier screening needs at least 5 months."
          : "No month deviates strongly from its neighbours.",
  });

  checks.push({
    id: "exog",
    label: "Exogenous drivers",
    status: prep.hasTemp && prep.hasPromo ? "pass" : "warn",
    detail:
      prep.hasTemp && prep.hasPromo
        ? "Temperature and promo columns present. Regression, Random Forest and Gradient Boosting use them."
        : !prep.hasTemp && !prep.hasPromo
          ? "No temperature or promo columns. Driver-based models fall back to trend and lag features only."
          : !prep.hasTemp
            ? "No temperature column. Models use promo, trend and lag features only."
            : "No promo column. Models use temperature, trend and lag features only.",
  });

  if (d.lateLaunchRegions.length > 0) {
    checks.push({
      id: "late",
      label: "Late-launch regions",
      status: "warn",
      detail: `${list(d.lateLaunchRegions)} start later than the first month; earlier months are counted as zero sales.`,
    });
  }

  for (const notice of ctx.ingestNotices) {
    if (notice.code === "aggregated") checks.push({ id: "aggregated", label: "Frequency", status: "warn", detail: notice.message });
  }

  return checks;
}
