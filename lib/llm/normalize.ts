import { InterpretationSchema, type Interpretation, type Snapshot } from "./schema";
import { ruleBasedInterpretation } from "./fallback";

/**
 * LLMs follow a JSON shape loosely: they wrap it in an extra object, rename keys, or return a
 * string where a list was asked for. This module maps those variations onto the required shape
 * before validation, and can complete individual missing sections from the rule-based analyst.
 */

type Field = keyof Interpretation;
const FIELDS: Field[] = ["executive_summary", "seasonality_and_trend", "best_model", "model_comparison_insight", "recommendations", "risks", "data_limitations", "next_steps"];

const ALIASES: Record<Field, string[]> = {
  executive_summary: ["executive_summary", "executivesummary", "summary", "exec_summary", "overview"],
  seasonality_and_trend: ["seasonality_and_trend", "seasonality_and_trends", "seasonality_trend", "seasonality", "trend_and_seasonality", "q1"],
  best_model: ["best_model", "bestmodel", "best_performing_model", "q2"],
  model_comparison_insight: ["model_comparison_insight", "model_comparison_insights", "model_comparison", "comparison", "comparison_insight"],
  recommendations: ["recommendations", "recommendation", "actions", "q3"],
  risks: ["risks", "key_risks", "risk"],
  data_limitations: ["data_limitations", "limitations", "data_limitation"],
  next_steps: ["next_steps", "nextsteps", "next_actions"],
};

const keyOf = (k: string) => k.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function fieldFor(key: string): Field | null {
  const k = keyOf(key);
  for (const f of FIELDS) if (ALIASES[f].includes(k)) return f;
  return null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(" ");
  if (isObj(v)) return Object.values(v).map(text).filter(Boolean).join(" ");
  return "";
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(text).filter(Boolean);
  if (isObj(v)) return Object.values(v).map(text).filter(Boolean);
  const t = text(v);
  // one string holding several items: split into sentences (decimals stay intact)
  return t ? t.split(/(?<=[.!?])\s+|\n+|;\s*/).map((x) => x.trim()).filter(Boolean) : [];
}

function verdictFrom(v: string): "captured" | "partially captured" | "not captured" {
  const s = v.toLowerCase();
  if (s.includes("partial")) return "partially captured";
  if (/\bnot\b|\bno\b|fail|unable|cannot/.test(s)) return "not captured";
  return "captured";
}

type Owner = "Production" | "Distribution" | "Marketing" | "Data/Analytics";
function owner(v: unknown): Owner {
  const s = text(v).toLowerCase();
  if (/distri|logist|supply|warehouse/.test(s)) return "Distribution";
  if (/market|sales|promo|brand|commercial/.test(s)) return "Marketing";
  if (/data|analy|forecast|bi\b|it\b/.test(s)) return "Data/Analytics";
  return "Production";
}
function priority(v: unknown): "high" | "medium" | "low" {
  const s = text(v).toLowerCase();
  if (s.startsWith("h") || s === "1" || s.includes("critical")) return "high";
  if (s.startsWith("l") || s === "3") return "low";
  return "medium";
}

/** Map a loosely-shaped LLM object onto the interpretation shape (best effort, never throws). */
export function normalizeInterpretation(raw: unknown, snapshot: Snapshot): Record<string, unknown> {
  let obj: unknown = raw;
  // unwrap { "interpretation": { ... } } style wrappers
  for (let i = 0; i < 3 && isObj(obj); i++) {
    const keys = Object.keys(obj);
    const known = keys.filter((k) => fieldFor(k));
    if (known.length > 0) break;
    const inner = keys.map((k) => (obj as Record<string, unknown>)[k]).find(isObj);
    if (!inner) break;
    obj = inner;
  }
  if (!isObj(obj)) return {};

  const out: Record<string, unknown> = {};
  const absorb = (src: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(src)) {
      const f = fieldFor(k);
      if (f && out[f] === undefined) out[f] = v;
      else if (!f && isObj(v)) absorb(v); // sections nested one level down
    }
  };
  absorb(obj);

  if (out.executive_summary !== undefined) out.executive_summary = text(out.executive_summary);

  const st = out.seasonality_and_trend;
  if (st !== undefined) {
    if (isObj(st)) {
      const explanation = text(st.explanation ?? st.analysis ?? st.details ?? st.summary ?? Object.values(st).filter((v) => typeof v === "string").join(" "));
      out.seasonality_and_trend = { verdict: verdictFrom(text(st.verdict ?? st.assessment ?? st.status ?? explanation)), explanation };
    } else {
      const t = text(st);
      out.seasonality_and_trend = { verdict: verdictFrom(t), explanation: t };
    }
  }

  const bm = out.best_model;
  if (bm !== undefined) {
    const fallbackName = snapshot.best_model?.name ?? "Best model";
    if (isObj(bm)) {
      out.best_model = {
        name: text(bm.name ?? bm.model ?? fallbackName) || fallbackName,
        why: text(bm.why ?? bm.reason ?? bm.reasons ?? bm.rationale ?? bm.explanation) || text(bm),
        caveats: text(bm.caveats ?? bm.caveat ?? bm.limitations ?? bm.risks) || "The hold-out is short, so the ranking may change as new months arrive.",
      };
    } else {
      out.best_model = { name: fallbackName, why: text(bm), caveats: "The hold-out is short, so the ranking may change as new months arrive." };
    }
  }

  if (out.model_comparison_insight !== undefined) out.model_comparison_insight = text(out.model_comparison_insight);

  if (out.recommendations !== undefined) {
    const recs = Array.isArray(out.recommendations) ? out.recommendations : isObj(out.recommendations) ? Object.values(out.recommendations) : [out.recommendations];
    out.recommendations = recs
      .map((r) => {
        if (!isObj(r)) {
          const t = text(r);
          return t ? { action: t, rationale: t, metric_cited: "See the Overview KPIs", priority: "medium", owner: owner(t) } : null;
        }
        const action = text(r.action ?? r.recommendation ?? r.title ?? r.what);
        const rationale = text(r.rationale ?? r.reason ?? r.why ?? r.justification) || action;
        return action
          ? {
              action,
              rationale,
              metric_cited: text(r.metric_cited ?? r.metric ?? r.metrics ?? r.evidence ?? r.kpi) || "See the Overview KPIs",
              priority: priority(r.priority),
              owner: owner(r.owner ?? r.team ?? r.department ?? action),
            }
          : null;
      })
      .filter((r) => r !== null);
  }

  for (const f of ["risks", "data_limitations", "next_steps"] as const) if (out[f] !== undefined) out[f] = list(out[f]);
  return out;
}

export interface ParsedInterpretation {
  interpretation: Interpretation;
  /** sections that had to be filled from the rule-based analyst */
  completed: Field[];
}

/**
 * Validate an LLM reply. With allowPartial, valid sections are kept and only invalid or missing
 * ones come from the rule-based analyst; at least the executive summary plus three other sections
 * must come from the LLM, otherwise the reply is rejected.
 */
export function parseInterpretation(raw: unknown, snapshot: Snapshot, allowPartial: boolean): ParsedInterpretation {
  const norm = normalizeInterpretation(raw, snapshot);
  const strict = InterpretationSchema.safeParse(norm);
  if (strict.success) return { interpretation: strict.data, completed: [] };
  if (!allowPartial) throw strict.error;

  const rule = ruleBasedInterpretation(snapshot);
  const merged: Record<string, unknown> = {};
  const completed: Field[] = [];
  for (const f of FIELDS) {
    const one = InterpretationSchema.pick({ [f]: true } as { [K in Field]?: true }).safeParse({ [f]: norm[f] });
    if (one.success) merged[f] = (one.data as Record<string, unknown>)[f];
    else if (f === "recommendations" && Array.isArray(norm[f])) {
      // keep the LLM's valid recommendations and top up from the rule-based ones
      const own = InterpretationSchema.shape.recommendations.safeParse([...(norm[f] as unknown[]), ...rule.recommendations].slice(0, 6));
      if (own.success && (norm[f] as unknown[]).length > 0) merged[f] = own.data;
      else {
        merged[f] = rule[f];
        completed.push(f);
      }
    } else {
      merged[f] = rule[f];
      completed.push(f);
    }
  }
  if (completed.includes("executive_summary") || completed.length > 4) throw strict.error;
  return { interpretation: InterpretationSchema.parse(merged), completed };
}
