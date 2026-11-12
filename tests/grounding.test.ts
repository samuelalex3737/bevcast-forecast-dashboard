import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkGrounding, extractFigures, segmentText, interpretationTexts } from "@/lib/llm/grounding";
import { ingestText } from "@/lib/data/ingest";
import { runEngine } from "@/lib/forecast";
import { DEFAULT_SETTINGS } from "@/lib/forecast/settings";
import { buildSnapshot } from "@/lib/llm/snapshot";
import { ruleBasedInterpretation } from "@/lib/llm/fallback";
import { SnapshotSchema, InterpretationSchema, firstSentences } from "@/lib/llm/schema";

const payload = {
  total: 1098780,
  peak: { units: 155390, period: "2026-07" },
  wape: 3.09,
  r: 0.905,
  saved: 51484,
  share: 0.4162,
  label: "ARIMA(0,1,0) + drift",
};

describe("figure extraction", () => {
  it("reads thousands separators, percentages, decimals and k/million suffixes", () => {
    const f = extractFigures("Sales of 155,390 units, WAPE 3.09%, r = 0.91, AED 51.5k saved, 1.1 million total.");
    expect(f.map((x) => x.value)).toEqual([155390, 3.09, 0.91, 51500, 1100000]);
  });
  it("skips years, ISO dates, model orders and small counts", () => {
    const f = extractFigures("In July 2026 (2026-07) ARIMA(0,1,0) was best over the next 3 months with lag_2.");
    expect(f).toEqual([]);
  });
});

describe("grounding check", () => {
  it("verifies figures that are in the payload within 1% or rounding", () => {
    const r = checkGrounding(["Peak of 155,390 units (about 155k); WAPE 3.1%; r = 0.91; saved AED 51,484; Dubai 41.6% share; total 1.1 million."], payload);
    expect(r.unverified).toEqual([]);
    expect(r.verified).toBe(r.total);
    expect(r.total).toBe(7);
  });
  it("flags invented figures", () => {
    const r = checkGrounding(["Sales will reach 250,000 units with a 47% margin."], payload);
    expect(r.total).toBe(2);
    expect(r.unverified.map((u) => u.text)).toEqual(["250,000", "47%"]);
  });
  it("segments text so unverified figures can be underlined", () => {
    const segs = segmentText("WAPE 3.09% vs 99.9%", payload);
    const figs = segs.filter((s) => s.figure);
    expect(figs.map((s) => s.figure?.verified)).toEqual([true, false]);
    expect(segs.map((s) => s.text).join("")).toBe("WAPE 3.09% vs 99.9%");
  });
});

describe("snapshot and rule-based interpretation on the sample data", () => {
  const csv = readFileSync(path.join(__dirname, "fixtures", "sample_sales.csv"), "utf8");
  const ing = ingestText(csv);
  const res = runEngine({ rows: ing.rows, settings: DEFAULT_SETTINGS, scenario: {}, ingestNotices: ing.notices, rejected: ing.rejected });
  const snap = buildSnapshot(res, "Sample dataset (simulated)", new Date("2026-11-12T10:00:00Z"));

  it("the snapshot validates against its schema and stays under 50 KB", () => {
    expect(SnapshotSchema.safeParse(snap).success).toBe(true);
    expect(JSON.stringify({ mode: "interpret", snapshot: snap }).length).toBeLessThan(50 * 1024);
  });

  it("the snapshot id changes when data or settings change and is stable otherwise", () => {
    const again = buildSnapshot(runEngine({ rows: ing.rows, settings: DEFAULT_SETTINGS, scenario: {}, ingestNotices: [], rejected: [] }), "x");
    expect(again.snapshot_id).toBe(snap.snapshot_id);
    const edited = ing.rows.map((r, i) => (i === 0 ? { ...r, units: (r.units ?? 0) + 1 } : r));
    const changed = buildSnapshot(runEngine({ rows: edited, settings: DEFAULT_SETTINGS, scenario: {}, ingestNotices: [], rejected: [] }), "x");
    expect(changed.snapshot_id).not.toBe(snap.snapshot_id);
    const horizon = buildSnapshot(runEngine({ rows: ing.rows, settings: { ...DEFAULT_SETTINGS, horizon: 4 }, scenario: {}, ingestNotices: [], rejected: [] }), "x");
    expect(horizon.snapshot_id).not.toBe(snap.snapshot_id);
  });

  it("the rule-based interpretation matches the schema and every figure is grounded", () => {
    const interp = ruleBasedInterpretation(snap);
    expect(InterpretationSchema.safeParse(interp).success).toBe(true);
    const report = checkGrounding(interpretationTexts(interp), snap);
    expect(report.unverified.map((u) => u.text)).toEqual([]);
    expect(report.total).toBeGreaterThan(10);
  });

  it("contains no em dash anywhere in generated text", () => {
    const interp = ruleBasedInterpretation(snap);
    expect(JSON.stringify(interp).includes(String.fromCharCode(0x2014))).toBe(false);
  });
});

describe("interpretation schema normalisation", () => {
  it("trims the executive summary to 3 sentences and normalises enums", () => {
    expect(firstSentences("One. Two! Three? Four.")).toBe("One. Two! Three?");
    const parsed = InterpretationSchema.parse({
      executive_summary: "A is up 5%. B is down. C holds. D extra.",
      seasonality_and_trend: { verdict: "Partially Captured", explanation: "Explanation text here." },
      best_model: { name: "MA", why: "Lowest WAPE", caveats: "Small test." },
      model_comparison_insight: "Baselines beat ML here.",
      recommendations: Array.from({ length: 7 }, (_, i) => ({ action: `Act ${i}`, rationale: "Because", metric_cited: "WAPE 3%", priority: "HIGH", owner: "supply chain" })),
      risks: ["r1", "r2", "", "r3", "r4", "r5"],
      data_limitations: ["l1"],
      next_steps: ["n1"],
    });
    expect(parsed.executive_summary).toBe("A is up 5%. B is down. C holds.");
    expect(parsed.seasonality_and_trend.verdict).toBe("partially captured");
    expect(parsed.recommendations).toHaveLength(6);
    expect(parsed.recommendations[0].owner).toBe("Production");
    expect(parsed.risks).toHaveLength(4);
  });
});

describe("LLM output sanitising", () => {
  it("replaces em and en dashes in every string", async () => {
    const { stripLongDashes } = await import("@/lib/llm/service");
    const em = String.fromCharCode(0x2014);
    const en = String.fromCharCode(0x2013);
    const out = stripLongDashes({ a: `Sales rose${em}fast`, b: [`Q1 ${en} Q2`], c: 5 });
    expect(out).toEqual({ a: "Sales rose - fast", b: ["Q1 - Q2"], c: 5 });
  });
});
