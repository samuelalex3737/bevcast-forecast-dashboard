/**
 * Grounding check: every number quoted by the LLM must exist in the payload it was given
 * (within 1% relative tolerance or the rounding implied by how it was written).
 */

export interface FigureToken {
  start: number;
  end: number;
  text: string;
  value: number;
  verified: boolean;
  /** payload value it matched, if any */
  matched: number | null;
}

export interface GroundingReport {
  total: number;
  verified: number;
  unverified: FigureToken[];
  tokens: FigureToken[];
}

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/** Collect every finite number in the payload, plus useful equivalent forms. */
export function payloadNumbers(payload: unknown): number[] {
  const out = new Set<number>();
  const add = (v: number) => {
    if (!Number.isFinite(v)) return;
    const a = Math.abs(v);
    out.add(a);
    if (a !== 0 && a < 1) out.add(a * 100); // shares/correlations written as percentages
  };
  const walk = (v: unknown) => {
    if (typeof v === "number") add(v);
    else if (typeof v === "string") {
      // numbers embedded in strings (warnings, labels, params)
      const m = v.replace(/\d{4}-\d{2}(-\d{2})?/g, " ").match(/-?\d[\d,]*\.?\d*/g);
      if (m) for (const t of m) add(Number(t.replace(/,/g, "")));
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(payload);
  return Array.from(out);
}

function decimalsOf(s: string): number {
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

function matches(value: number, written: string, scale: number, pool: number[]): number | null {
  const v = Math.abs(value);
  const dec = decimalsOf(written);
  const roundTol = (0.5 * 10 ** -dec) * scale;
  for (const p of pool) {
    const diff = Math.abs(p - v);
    if (diff <= roundTol + 1e-9 || (p !== 0 && diff / Math.abs(p) <= 0.01) || (v === 0 && p === 0)) return p;
  }
  return null;
}

/**
 * Extract the numbers from a piece of LLM text.
 * Skipped (not counted): years (1990-2100), ISO dates, model orders like ARIMA(1,1,0), and small
 * bare integers up to 12 that count things ("3 months", "top 3").
 */
export function extractFigures(text: string): { start: number; end: number; text: string; value: number; scale: number; digits: string }[] {
  const masked = text
    .replace(/\(\d\s*,\s*\d\s*,\s*\d\)(\(\d,\d,\d\)\[\d+\])?/g, (m) => " ".repeat(m.length))
    .replace(/\b\d{4}-\d{2}(-\d{2})?\b/g, (m) => " ".repeat(m.length))
    .replace(new RegExp(`\\b(${MONTHS})\\.?\\s+(19|20|21)\\d{2}\\b`, "gi"), (m) => m.replace(/\d/g, " "))
    .replace(/\blag[_ ]?\d+\b|\broll[_ ]mean[_ ]\d+\b|\blog[_ ]growth[_ ]\d+\b|\bk\s*=\s*\d+\b/gi, (m) => " ".repeat(m.length));
  const re = /(?<![\w.])(-|−)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%|k\b|K\b|thousand\b|m\b|M\b|million\b|mn\b)?/g;
  const out: { start: number; end: number; text: string; value: number; scale: number; digits: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const intPart = m[2].replace(/,/g, "");
    const digits = `${intPart}${m[3] ?? ""}`;
    let value = Number(digits);
    if (!Number.isFinite(value)) continue;
    const suffix = (m[4] ?? "").toLowerCase();
    let scale = 1;
    if (suffix === "k" || suffix === "thousand") scale = 1e3;
    if (suffix === "m" || suffix === "million" || suffix === "mn") scale = 1e6;
    value *= scale;
    const isPct = suffix === "%";
    const isYear = !m[3] && !isPct && scale === 1 && !m[2].includes(",") && value >= 1990 && value <= 2100;
    const smallCount = !m[3] && !isPct && scale === 1 && value <= 12;
    if (isYear || smallCount) continue;
    out.push({ start: m.index, end: m.index + m[0].length, text: text.slice(m.index, m.index + m[0].length).trim(), value, scale, digits });
  }
  return out;
}

export function checkGrounding(texts: string[], payload: unknown): GroundingReport {
  const pool = payloadNumbers(payload);
  const tokens: FigureToken[] = [];
  for (const t of texts) {
    for (const f of extractFigures(t)) {
      const matched = matches(f.value, f.digits, f.scale, pool);
      tokens.push({ start: f.start, end: f.end, text: f.text, value: f.value, verified: matched !== null, matched });
    }
  }
  const unverified = tokens.filter((t) => !t.verified);
  return { total: tokens.length, verified: tokens.length - unverified.length, unverified, tokens };
}

/** Split text into plain and figure segments for rendering with underlines. */
export function segmentText(text: string, payload: unknown): { text: string; figure: FigureToken | null }[] {
  const pool = payloadNumbers(payload);
  const figs = extractFigures(text).map((f) => {
    const matched = matches(f.value, f.digits, f.scale, pool);
    return { start: f.start, end: f.end, text: f.text, value: f.value, verified: matched !== null, matched };
  });
  const segs: { text: string; figure: FigureToken | null }[] = [];
  let cursor = 0;
  for (const f of figs) {
    if (f.start > cursor) segs.push({ text: text.slice(cursor, f.start), figure: null });
    segs.push({ text: text.slice(f.start, f.end), figure: f });
    cursor = f.end;
  }
  if (cursor < text.length) segs.push({ text: text.slice(cursor), figure: null });
  return segs;
}

/** All free-text fields of an interpretation, for the grounding check. */
export function interpretationTexts(i: {
  executive_summary: string;
  seasonality_and_trend: { explanation: string };
  best_model: { why: string; caveats: string };
  model_comparison_insight: string;
  recommendations: { action: string; rationale: string; metric_cited: string }[];
  risks: string[];
  data_limitations: string[];
  next_steps: string[];
}): string[] {
  return [
    i.executive_summary,
    i.seasonality_and_trend.explanation,
    i.best_model.why,
    i.best_model.caveats,
    i.model_comparison_insight,
    ...i.recommendations.flatMap((r) => [r.action, r.rationale, r.metric_cited]),
    ...i.risks,
    ...i.data_limitations,
    ...i.next_steps,
  ];
}
