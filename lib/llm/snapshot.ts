import type { EngineResult } from "@/lib/forecast";
import { hashString } from "@/lib/forecast/rng";
import { formatPeriod } from "@/lib/data/parseDates";
import { safeRound, isNum } from "@/lib/utils/format";
import type { Snapshot } from "./schema";

const r0 = (v: number | null | undefined) => safeRound(v, 0);
const r2 = (v: number | null | undefined) => safeRound(v, 2);
const n0 = (v: number | null | undefined) => r0(v) ?? 0;

/** Stable id for "the data and settings that produced this result". */
export function snapshotIdFor(res: EngineResult): string {
  const key = JSON.stringify({
    p: res.points.map((p) => [p.period, p.y, p.temp, p.promo]),
    s: res.settings,
    sc: res.scenario,
    r: res.scopeRegions,
  });
  return `snap_${hashString(key).toString(16).padStart(8, "0")}`;
}

/** Build the JSON payload the LLM interprets. Every number is rounded so it can be quoted exactly. */
export function buildSnapshot(res: EngineResult, datasetLabel: string, now: Date = new Date()): Snapshot {
  const naive = res.models.find((m) => m.id === "naive");
  const naiveW = naive?.holdout?.metrics.wape ?? null;
  const rankOf = (id: string) => {
    const i = res.ranking.indexOf(id as (typeof res.ranking)[number]);
    return i >= 0 ? i + 1 : null;
  };
  const best = res.models.find((m) => m.id === res.bestId) ?? null;
  const selected = res.models.find((m) => m.id === res.selectedId) ?? null;
  const importance: Snapshot["feature_importance_top5"] = [];
  for (const m of res.models) {
    if (!m.importance || m.status !== "ok") continue;
    Object.entries(m.importance)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([feature, v]) => importance.push({ model: m.shortName, feature, importance_pct: r2(v) ?? 0 }));
  }
  const s = res.summary;
  const params: Record<string, number | string> = {};
  if (best) for (const [k, v] of Object.entries(best.params)) params[k] = typeof v === "number" ? (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 1000) / 1000) : v;

  const leaderboard: Snapshot["leaderboard"] = res.models.map((m) => {
    const ho = m.holdout?.metrics;
    const wf = m.walkForward?.metrics;
    const gap = isNum(naiveW) && isNum(ho?.wape) ? naiveW - (ho?.wape as number) : null;
    return {
      rank: rankOf(m.id),
      model: m.shortName,
      family: m.family,
      status: m.status === "ok" ? "fitted" : `${m.status}: ${m.reason ?? ""}`.trim(),
      holdout_mape: r2(ho?.mape),
      holdout_wape: r2(ho?.wape),
      bias_pct: r2(ho?.bias),
      mase: r2(ho?.mase),
      wf_mape: r2(wf?.mape),
      wf_wape: r2(wf?.wape),
      wape_gap_vs_naive_pts: r2(gap),
    };
  });
  leaderboard.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

  const range = (ps: string[]) => (ps.length ? `${formatPeriod(ps[0])} to ${formatPeriod(ps[ps.length - 1])}` : "none");
  return {
    snapshot_id: snapshotIdFor(res),
    generated_at: now.toISOString(),
    dataset_label: datasetLabel,
    region_scope: res.scopeRegions.length === res.regions.length ? `All markets (${res.regions.join(", ")})` : res.scopeRegions.join(", "),
    n_periods: res.n,
    period_range: { start: res.points[0]?.period ?? "", end: res.points[res.points.length - 1]?.period ?? "" },
    monthly_actuals: res.points.map((p, i) => ({
      period: p.period,
      units: n0(p.y),
      mom_pct: i > 0 && res.points[i - 1].y > 0 ? r2((100 * (p.y - res.points[i - 1].y)) / res.points[i - 1].y) : null,
      temp_c: safeRound(p.temp, 1),
      promo: p.promo,
      interpolated: p.interpolated,
      outlier: p.outlier,
    })),
    summary_stats: {
      total: n0(s.total),
      average_month: n0(s.mean),
      peak: s.peak ? { period: s.peak.period, units: n0(s.peak.value) } : null,
      trough: s.trough ? { period: s.trough.period, units: n0(s.trough.value) } : null,
      latest: s.latest ? { period: s.latest.period, units: n0(s.latest.value), mom_pct: r2(s.latest.momPct) } : null,
      launch_to_peak_growth_pct: r2(s.launchToPeakPct),
      last3_mom_pct: s.last3MomPct.map((g) => ({ period: g.period, pct: r2(g.pct) })),
      last3_change_pct: r2(s.last3ChangePct),
      temp_sales_pearson_r: safeRound(s.tempSalesR, 3),
      promo_lift_pct: r2(s.promoLiftPct),
    },
    split: { holdout_size: res.holdoutSize, train_range: range(res.split.trainPeriods), test_range: range(res.split.testPeriods), walk_forward_origins: res.wfOrigins.length },
    leaderboard,
    ranking_metric: res.settings.rankMetric === "mape" ? "MAPE" : "WAPE",
    best_model: best ? { name: best.shortName, label: best.label ?? best.name, params, why: best.why } : null,
    selected_model: selected
      ? { name: selected.shortName, label: selected.label ?? selected.name, selection: res.settings.selectedModel === "auto" ? "Auto (best by hold-out metric)" : res.selectionNote ?? "Chosen by the user" }
      : null,
    feature_importance_top5: importance,
    forecast: res.forecast.map((f) => ({
      period: f.period,
      forecast: n0(f.forecast),
      lower: n0(f.lower),
      upper: n0(f.upper),
      safety_stock: n0(f.safetyStock),
      recommended_production: n0(f.recommended),
      base_case: n0(f.base),
      scenario_delta: n0(f.delta),
    })),
    forecast_total: n0(res.forecast.reduce((a, f) => a + f.forecast, 0)),
    confidence_level_pct: res.settings.confidence,
    service_level_pct: res.settings.serviceLevel,
    regional_allocation: res.regional
      ? res.regional.regions.map((region, i) => ({ region, share_pct: r2((res.regional?.shares[i] ?? 0) * 100) ?? 0, next_month_units: n0(res.regional?.rows[0]?.values[i]) }))
      : [],
    cost_of_error: res.cost
      ? {
          test_months: res.cost.periods.length,
          best_model_cost_aed: n0(res.cost.best.total),
          naive_cost_aed: n0(res.cost.naive.total),
          saved_aed: n0(res.cost.savings),
          saved_pct: r2(res.cost.savingsPct),
          waste_aed: n0(res.cost.best.wasteCost),
          lost_margin_aed: n0(res.cost.best.lostMargin),
          unit_cost_aed: res.cost.unitCost,
          unit_price_aed: res.cost.unitPrice,
        }
      : null,
    data_quality_warnings: res.warnings.slice(0, 20).map((w) => w.slice(0, 400)),
    scenario: {
      future_temp: res.scenario.map((x) => ({ period: x.period, temp_c: safeRound(x.temp, 1) })),
      future_promo: res.scenario.map((x) => ({ period: x.period, promo: x.promo })),
    },
  };
}

export function periodLabel(p: string): string {
  return formatPeriod(p, "long");
}
