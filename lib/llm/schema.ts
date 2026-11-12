import { z } from "zod";

const num = z.number().finite();
const nnum = num.nullable();

/* ------------------------------------------------------------------ */
/* Snapshot sent to the LLM (built client-side from the live results)   */
/* ------------------------------------------------------------------ */

export const SnapshotSchema = z.object({
  snapshot_id: z.string().max(64),
  generated_at: z.string().max(40),
  dataset_label: z.string().max(200),
  region_scope: z.string().max(400),
  n_periods: z.number().int().min(0).max(5000),
  period_range: z.object({ start: z.string().max(10), end: z.string().max(10) }),
  monthly_actuals: z
    .array(z.object({ period: z.string().max(10), units: num, mom_pct: nnum, temp_c: nnum, promo: z.union([z.literal(0), z.literal(1)]).nullable(), interpolated: z.boolean(), outlier: z.boolean() }))
    .max(240),
  summary_stats: z.object({
    total: num,
    average_month: num,
    peak: z.object({ period: z.string(), units: num }).nullable(),
    trough: z.object({ period: z.string(), units: num }).nullable(),
    latest: z.object({ period: z.string(), units: num, mom_pct: nnum }).nullable(),
    launch_to_peak_growth_pct: nnum,
    last3_mom_pct: z.array(z.object({ period: z.string(), pct: nnum })).max(3),
    last3_change_pct: nnum,
    temp_sales_pearson_r: nnum,
    promo_lift_pct: nnum,
  }),
  split: z.object({
    holdout_size: z.number().int(),
    train_range: z.string().max(40),
    test_range: z.string().max(40),
    walk_forward_origins: z.number().int(),
  }),
  leaderboard: z
    .array(
      z.object({
        rank: z.number().int().nullable(),
        model: z.string().max(80),
        family: z.string().max(40),
        status: z.string().max(200),
        holdout_mape: nnum,
        holdout_wape: nnum,
        bias_pct: nnum,
        mase: nnum,
        wf_mape: nnum,
        wf_wape: nnum,
        wape_gap_vs_naive_pts: nnum,
      }),
    )
    .max(12),
  ranking_metric: z.enum(["WAPE", "MAPE"]),
  best_model: z.object({ name: z.string(), label: z.string(), params: z.record(z.string(), z.union([z.number(), z.string()])), why: z.string().max(1500) }).nullable(),
  selected_model: z.object({ name: z.string(), label: z.string(), selection: z.string() }).nullable(),
  feature_importance_top5: z.array(z.object({ model: z.string(), feature: z.string(), importance_pct: num })).max(10),
  forecast: z
    .array(z.object({ period: z.string(), forecast: num, lower: num, upper: num, safety_stock: num, recommended_production: num, base_case: num, scenario_delta: num }))
    .max(12),
  forecast_total: num,
  confidence_level_pct: num,
  service_level_pct: num,
  regional_allocation: z.array(z.object({ region: z.string().max(80), share_pct: num, next_month_units: num })).max(60),
  cost_of_error: z
    .object({ test_months: z.number().int(), best_model_cost_aed: num, naive_cost_aed: num, saved_aed: num, saved_pct: nnum, waste_aed: num, lost_margin_aed: num, unit_cost_aed: num, unit_price_aed: num })
    .nullable(),
  data_quality_warnings: z.array(z.string().max(400)).max(20),
  scenario: z.object({
    future_temp: z.array(z.object({ period: z.string(), temp_c: nnum })).max(12),
    future_promo: z.array(z.object({ period: z.string(), promo: z.union([z.literal(0), z.literal(1)]).nullable() })).max(12),
  }),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

/* ------------------------------------------------------------------ */
/* Interpretation returned by the LLM (or the rule-based engine)        */
/* ------------------------------------------------------------------ */

const PRIORITIES = ["high", "medium", "low"] as const;
const OWNERS = ["Production", "Distribution", "Marketing", "Data/Analytics"] as const;

function normaliseOwner(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.toLowerCase();
  if (s.includes("prod") || s.includes("manufact") || s.includes("supply")) return "Production";
  if (s.includes("distri") || s.includes("logist")) return "Distribution";
  if (s.includes("market") || s.includes("sales") || s.includes("promo")) return "Marketing";
  if (s.includes("data") || s.includes("analy")) return "Data/Analytics";
  return v;
}

/** Keep at most 3 sentences. */
export function firstSentences(text: string, max = 3): string {
  const parts = text.trim().match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [text];
  return parts.slice(0, max).join("").trim();
}

const RecommendationSchema = z.object({
  action: z.string().min(3).max(400),
  rationale: z.string().min(3).max(800),
  metric_cited: z.string().min(1).max(300),
  priority: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase().trim() : v), z.enum(PRIORITIES)),
  owner: z.preprocess(normaliseOwner, z.enum(OWNERS)),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

const strList = (min: number, max: number) =>
  z.preprocess((v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim() !== "").slice(0, max) : v), z.array(z.string().max(800)).min(min).max(max));

export const InterpretationSchema = z.object({
  executive_summary: z.preprocess((v) => (typeof v === "string" ? firstSentences(v, 3) : v), z.string().min(10).max(1500)),
  seasonality_and_trend: z.object({
    verdict: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase().trim() : v), z.enum(["captured", "partially captured", "not captured"])),
    explanation: z.string().min(10).max(1500),
  }),
  best_model: z.object({ name: z.string().min(1).max(120), why: z.string().min(5).max(1500), caveats: z.string().min(1).max(1500) }),
  model_comparison_insight: z.string().min(10).max(1500),
  recommendations: z.preprocess((v) => (Array.isArray(v) ? v.slice(0, 6) : v), z.array(RecommendationSchema).min(4).max(6)),
  risks: strList(2, 4),
  data_limitations: strList(1, 8),
  next_steps: strList(1, 8),
});
export type Interpretation = z.infer<typeof InterpretationSchema>;

export const AskAnswerSchema = z.object({
  answer: z.string().min(1).max(4000),
});
export type AskAnswer = z.infer<typeof AskAnswerSchema>;

/* ------------------------------------------------------------------ */
/* API request / response                                               */
/* ------------------------------------------------------------------ */

export const InterpretRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("interpret"), snapshot: SnapshotSchema }),
  z.object({
    mode: z.literal("ask"),
    snapshot: SnapshotSchema,
    question: z.string().trim().min(2).max(500),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(8).default([]),
  }),
]);
export type InterpretRequest = z.infer<typeof InterpretRequestSchema>;

export type InterpretSource = "llm" | "fallback";

export interface InterpretResponse {
  source: InterpretSource;
  provider: string | null;
  model: string | null;
  snapshot_id: string;
  interpretation?: Interpretation;
  answer?: string;
  /** why the fallback was used (no key, timeout, invalid JSON, provider error) */
  fallback_reason?: string;
  latency_ms: number;
}

export interface ProviderStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
}
