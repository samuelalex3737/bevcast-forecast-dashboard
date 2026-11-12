import type { EngineResult } from "@/lib/forecast";
import { tableToCsv } from "@/lib/data/ingest";
import { round } from "./format";

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8"): boolean {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

export function yyyymmdd(d = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function regionSlug(res: EngineResult): string {
  if (res.scopeRegions.length === res.regions.length) return "all-markets";
  return res.scopeRegions
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "selection";
}

export function forecastCsv(res: EngineResult): string {
  const sel = res.models.find((m) => m.id === res.selectedId);
  const header = ["month", "model", "forecast_units", `lower_${res.settings.confidence}`, `upper_${res.settings.confidence}`, "lower_80", "upper_80", "lower_95", "upper_95", "sigma_h", `safety_stock_sl${res.settings.serviceLevel}`, "recommended_production", "base_case_units", "scenario_delta_units", "temp_c", "promo"];
  const rows = res.forecast.map((f) => [f.period, sel?.shortName ?? "", round(f.forecast), round(f.lower), round(f.upper), round(f.lower80), round(f.upper80), round(f.lower95), round(f.upper95), round(f.sigma), round(f.safetyStock), f.recommended, round(f.base), round(f.delta), f.temp, f.promo]);
  let csv = tableToCsv(header, rows);
  if (res.regional) {
    csv += "\n\n" + tableToCsv(["month", ...res.regional.regions.map((r) => `${r}_units`), ...res.regional.regions.map((r) => `${r}_recommended`)], res.regional.rows.map((r) => [r.period, ...r.values.map((v) => round(v)), ...r.recommended]));
  }
  return csv;
}

export function metricsCsv(res: EngineResult): string {
  const header = ["rank", "model", "family", "status", "holdout_mape", "holdout_wape", "holdout_bias_pct", "holdout_rmse", "holdout_mae", "holdout_mase", "mape_zero_skipped", "wf_mape", "wf_wape", "wf_rmse", "label"];
  const rows = res.models.map((m) => {
    const h = m.holdout?.metrics;
    const w = m.walkForward?.metrics;
    const rank = res.ranking.indexOf(m.id);
    const r4 = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? round(v, 4) : null);
    return [rank >= 0 ? rank + 1 : null, m.shortName, m.family, m.status === "ok" ? "fitted" : `${m.status}: ${m.reason ?? ""}`, r4(h?.mape), r4(h?.wape), r4(h?.bias), r4(h?.rmse), r4(h?.mae), r4(h?.mase), h?.mapeSkipped ?? null, r4(w?.mape), r4(w?.wape), r4(w?.rmse), m.label];
  });
  return tableToCsv(header, rows);
}
