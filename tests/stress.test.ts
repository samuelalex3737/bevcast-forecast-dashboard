import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ingestText } from "@/lib/data/ingest";
import type { DataRow } from "@/lib/data/schema";
import { runEngine, type EngineResult } from "@/lib/forecast";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/forecast/settings";
import { MODEL_IDS, type ModelId } from "@/lib/forecast/types";
import { buildCaptions } from "@/lib/insights/captions";
import { buildSnapshot } from "@/lib/llm/snapshot";
import { ruleBasedInterpretation } from "@/lib/llm/fallback";
import { InterpretationSchema } from "@/lib/llm/schema";
import { handleInterpret, providerStatus, resetRateLimiter, resetModelCache } from "@/lib/llm/service";
import { pickModel } from "@/lib/llm/providers";

const fx = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const sample = () => ingestText(fx("sample_sales.csv"));

/** Walk any value and collect the paths of numbers that are NaN or +/-Infinity. */
function nonFinitePaths(value: unknown, at = "result", out: string[] = []): string[] {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) out.push(at);
  } else if (Array.isArray(value)) value.forEach((v, i) => nonFinitePaths(v, `${at}[${i}]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) nonFinitePaths(v, `${at}.${k}`, out);
  return out;
}

function run(rows: DataRow[], over: Partial<Settings> = {}, ingest = { notices: [] as ReturnType<typeof sample>["notices"], rejected: [] as ReturnType<typeof sample>["rejected"] }): EngineResult {
  const settings = { ...DEFAULT_SETTINGS, ...over, enabledModels: { ...DEFAULT_SETTINGS.enabledModels, ...(over.enabledModels ?? {}) } };
  return runEngine({ rows, settings, scenario: {}, ingestNotices: ingest.notices, rejected: ingest.rejected });
}

/** The common guarantee for every stress case. */
function assertHealthy(res: EngineResult) {
  expect(nonFinitePaths(res)).toEqual([]);
  for (const m of res.models) {
    expect(m.status).not.toBe("failed");
    if (m.status === "ok") {
      expect(m.forecast?.every(Number.isFinite)).toBe(true);
      expect(m.holdout?.predicted.every(Number.isFinite)).toBe(true);
      expect(m.forecast?.every((v) => v >= 0)).toBe(true);
    }
  }
  if (res.status === "ok") {
    expect(res.forecast.length).toBe(res.horizon);
    expect(res.selectedId).not.toBeNull();
    // downstream consumers must also work on this result
    const captions = buildCaptions(res);
    expect(Object.values(captions).every((c) => typeof c === "string" && c.length > 10 && !c.includes("NaN") && !c.includes("undefined"))).toBe(true);
    const snap = buildSnapshot(res, "Stress test");
    expect(nonFinitePaths(snap)).toEqual([]);
    const fb = ruleBasedInterpretation(snap);
    expect(InterpretationSchema.safeParse(fb).success).toBe(true);
  }
}

describe("professor stress tests", () => {
  it("1: sample data as shipped", () => {
    const ing = sample();
    const res = run(ing.rows, {}, ing);
    assertHealthy(res);
    expect(res.status).toBe("ok");
    expect(res.n).toBe(12);
    expect(res.models.filter((m) => m.status === "ok").length).toBe(9);
    expect(res.models.find((m) => m.id === "snaive")?.reason).toBe("Needs 24+ months to learn yearly seasonality");
  });

  it("2: one month changed to 3x its value is flagged as an outlier and models still fit", () => {
    const rows = sample().rows.map((r) => (r.period === "2026-01" ? { ...r, units: (r.units ?? 0) * 3 } : r));
    const res = run(rows);
    assertHealthy(res);
    expect(res.points.find((p) => p.period === "2026-01")?.outlier).toBe(true);
    expect(res.health.find((h) => h.id === "outliers")?.status).toBe("warn");
  });

  it("3: one month set to 0 reports the MAPE skip count and keeps WAPE finite", () => {
    const rows = sample().rows.map((r) => (r.period === "2026-09" ? { ...r, units: 0 } : r));
    const res = run(rows);
    assertHealthy(res);
    expect(res.points.find((p) => p.period === "2026-09")?.y).toBe(0);
    const best = res.models.find((m) => m.id === res.bestId);
    expect(best?.holdout?.metrics.mapeSkipped).toBe(1);
    expect(Number.isFinite(best?.holdout?.metrics.wape ?? NaN)).toBe(true);
    expect(res.health.find((h) => h.id === "zeros")?.status).toBe("warn");
  });

  it("4: one month blank is interpolated and flagged for a hollow marker", () => {
    const rows = sample().rows.map((r) => (r.period === "2026-04" ? { ...r, units: null } : r));
    const res = run(rows);
    assertHealthy(res);
    const apr = res.points.find((p) => p.period === "2026-04");
    expect(apr?.interpolated).toBe(true);
    expect(res.health.find((h) => h.id === "blank")?.status).toBe("warn");
  });

  it("5: three months deleted from the middle: gap detected and filled", () => {
    const rows = sample().rows.filter((r) => !["2026-03", "2026-04", "2026-05"].includes(r.period));
    const res = run(rows);
    assertHealthy(res);
    expect(res.diagnostics.missingPeriods).toEqual(["2026-03", "2026-04", "2026-05"]);
    expect(res.n).toBe(12);
    expect(res.points.filter((p) => p.interpolated).map((p) => p.period)).toEqual(["2026-03", "2026-04", "2026-05"]);
    const open = run(rows, { fillGaps: false });
    assertHealthy(open);
    expect(open.n).toBe(9);
  });

  it("6: only 5 months restricts the model set with correct badges", () => {
    const keep = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"];
    const res = run(sample().rows.filter((r) => keep.includes(r.period)));
    assertHealthy(res);
    expect(res.status).toBe("ok");
    const ok = res.models.filter((m) => m.status === "ok").map((m) => m.id).sort();
    expect(ok).toEqual(["drift", "holt", "ma", "naive"]);
    for (const id of ["arima", "regression", "rf", "gbm", "ensemble"] as ModelId[]) {
      expect(res.models.find((m) => m.id === id)?.reason).toBe("Needs at least 8 months");
    }
    expect(res.holdoutSize).toBe(1);
  });

  it("7: only 3 months gives the blocking message state without crashing", () => {
    const keep = ["2025-11", "2025-12", "2026-01"];
    const res = run(sample().rows.filter((r) => keep.includes(r.period)));
    expect(nonFinitePaths(res)).toEqual([]);
    expect(res.status).toBe("insufficient");
    expect(res.message).toMatch(/At least 4 months are needed to forecast/);
    expect(res.forecast).toEqual([]);
    expect(res.pipeline.length).toBeGreaterThan(3);
    const captions = buildCaptions(res);
    expect(Object.values(captions).every((c) => !c.includes("NaN"))).toBe(true);
  });

  it("8: 36 months enables Seasonal Naive and seasonal ARIMA", () => {
    const ing = ingestText(fx("thirty_six_months.csv"));
    const res = run(ing.rows, {}, ing);
    assertHealthy(res);
    expect(res.n).toBe(36);
    expect(res.models.find((m) => m.id === "snaive")?.status).toBe("ok");
    const arima = res.models.find((m) => m.id === "arima");
    expect(arima?.status).toBe("ok");
    expect(res.settings.seasonalArima).toBe(true);
    const off = run(ing.rows, { seasonalArima: false }, ing);
    assertHealthy(off);
    expect(String(off.models.find((m) => m.id === "arima")?.params.seasonal_D)).toBe("0");
  });

  it("9: daily data for 400 days is aggregated to monthly", () => {
    const ing = ingestText(fx("daily_400_days.csv"));
    const res = run(ing.rows, {}, ing);
    assertHealthy(res);
    expect(res.n).toBe(14);
    expect(res.health.some((h) => h.id === "aggregated")).toBe(true);
  });

  it("10: two-column date,sales CSV without region/temp/promo", () => {
    const ing = ingestText(fx("date_sales_only.csv"));
    const res = run(ing.rows, {}, ing);
    assertHealthy(res);
    expect(res.hasTemp).toBe(false);
    expect(res.hasPromo).toBe(false);
    expect(res.models.find((m) => m.id === "regression")?.label).toBe("units ~ trend");
    expect(res.scenario.every((s) => s.temp === null && s.promo === null)).toBe(true);
  });

  it("11: wide format (regions as columns)", () => {
    const ing = ingestText(fx("wide_regions_as_columns.csv"));
    const res = run(ing.rows, {}, ing);
    assertHealthy(res);
    expect(res.scopeRegions.length).toBe(4);
  });

  it("12: unsorted rows + duplicate period/region rows", () => {
    const ing = ingestText(fx("unsorted_duplicates.csv"));
    const res = run(ing.rows, {}, ing);
    assertHealthy(res);
    expect(res.health.find((h) => h.id === "duplicates")?.status).toBe("warn");
    // duplicates created later by editing (e.g. renaming a region) are also merged
    const rows = sample().rows.map((r) => (r.region === "Al Ain" ? { ...r, region: "Dubai" } : r));
    const res2 = run(rows);
    assertHealthy(res2);
    expect(res2.diagnostics.duplicatesMerged).toBe(12);
  });

  it("13: dates as Jan-25, 01/03/2026 and Excel serials", () => {
    for (const f of ["dates_mon_yy.csv", "dates_dd_mm_yyyy.csv", "dates_excel_serial.csv"]) {
      const ing = ingestText(fx(f));
      const res = run(ing.rows, {}, ing);
      assertHealthy(res);
      expect(res.n).toBe(6);
    }
  });

  it("14: values with commas and AED prefixes", () => {
    const ing = ingestText(fx("currency_commas.csv"));
    const res = run(ing.rows, {}, ing);
    assertHealthy(res);
    expect(res.summary.total).toBeCloseTo(12700 + 18810 + 30840 + 36490.5 + 46460 + 61090, 6);
  });

  it("15: a negative value: row rejected, message names the row", () => {
    const ing = ingestText(fx("negative_value.csv"));
    const res = run(ing.rows, {}, ing);
    assertHealthy(res);
    const rej = res.health.find((h) => h.id === "rejected");
    expect(rej?.status).toBe("fail");
    expect(rej?.detail).toMatch(/Line 4/);
  });

  it("16: horizon 12, test size 1, test size 6, a single model enabled", () => {
    const rows = sample().rows;
    const h12 = run(rows, { horizon: 12 });
    assertHealthy(h12);
    expect(h12.forecast.length).toBe(12);
    const t1 = run(rows, { holdout: 1 });
    assertHealthy(t1);
    expect(t1.holdoutSize).toBe(1);
    const t6 = run(rows, { holdout: 6 });
    assertHealthy(t6);
    expect(t6.holdoutSize).toBe(6);
    for (const id of MODEL_IDS) {
      const only = Object.fromEntries(MODEL_IDS.map((m) => [m, m === id])) as Settings["enabledModels"];
      const res = run(rows, { enabledModels: only });
      assertHealthy(res);
      if (id !== "snaive" && id !== "ensemble") expect(res.selectedId).toBe(id);
    }
    // extreme hyper-parameters and confidence / service levels
    const extremes = run(rows, { maWindow: 6, rfTrees: 500, rfMaxDepth: 8, gbmRounds: 500, gbmLearningRate: 0.3, gbmMaxDepth: 4, confidence: 80, serviceLevel: 99, horizon: 12, holdout: 6, seed: 999999, rankMetric: "mape" });
    assertHealthy(extremes);
    const minimums = run(rows, { maWindow: 2, rfTrees: 50, rfMaxDepth: 2, gbmRounds: 50, gbmLearningRate: 0.01, gbmMaxDepth: 1, horizon: 1, holdout: 1, seed: 1, unitCost: 0.01, unitPrice: 0.01 });
    assertHealthy(minimums);
  });

  it("17: region filter set to each single region, and a multi-select", () => {
    const ing = sample();
    for (const region of ["Dubai", "Abu Dhabi", "Sharjah & Northern Emirates", "Al Ain"]) {
      const res = run(ing.rows, { regions: [region] }, ing);
      assertHealthy(res);
      expect(res.scopeRegions).toEqual([region]);
      expect(res.regional?.shares).toEqual([1]);
    }
    const multi = run(ing.rows, { regions: ["Dubai", "Al Ain"] }, ing);
    assertHealthy(multi);
    expect(multi.points[0].y).toBe(6450 + 1650);
    const missing = run(ing.rows, { regions: ["Atlantis"] }, ing);
    assertHealthy(missing);
    expect(missing.scopeRegions.length).toBe(4);
  });

  it("same inputs + same seed give identical outputs", () => {
    const rows = sample().rows;
    const a = run(rows);
    const b = run(rows);
    const strip = (r: EngineResult) => JSON.stringify({ ...r, computeMs: 0 });
    expect(strip(a)).toBe(strip(b));
  });

  it("scenario overrides change driver models and leave the base forecast intact", () => {
    const ing = sample();
    const settings = { ...DEFAULT_SETTINGS, selectedModel: "regression" as const };
    const base = runEngine({ rows: ing.rows, settings, scenario: {}, ingestNotices: [], rejected: [] });
    const p = base.forecast[0].period;
    const hot = runEngine({ rows: ing.rows, settings, scenario: { [p]: { temp: 40, promo: 1 } }, ingestNotices: [], rejected: [] });
    expect(hot.forecast[0].forecast).toBeGreaterThan(base.forecast[0].forecast);
    expect(hot.forecast[0].base).toBeCloseTo(base.forecast[0].forecast, 6);
    expect(hot.forecast[0].delta).toBeGreaterThan(0);
  });

  it("an empty dataset returns the empty state", () => {
    const res = run([]);
    expect(res.status).toBe("empty");
    expect(nonFinitePaths(res)).toEqual([]);
  });
});

describe("18: LLM route resilience", () => {
  const ing = sample();
  const snap = buildSnapshot(run(ing.rows, {}, ing), "Sample dataset (simulated)");
  const body = JSON.stringify({ mode: "interpret", snapshot: snap });
  const good = ruleBasedInterpretation(snap);
  const chat = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "Content-Type": "application/json" } });

  it("no key: returns the labelled rule-based fallback", async () => {
    resetRateLimiter();
    const r = await handleInterpret(body, { env: {}, fetchImpl: () => Promise.reject(new Error("must not be called")), ip: "t1" });
    expect(r.status).toBe(200);
    expect("source" in r.body && r.body.source).toBe("fallback");
    expect("fallback_reason" in r.body && r.body.fallback_reason).toMatch(/not configured/);
    expect("interpretation" in r.body && InterpretationSchema.safeParse(r.body.interpretation).success).toBe(true);
    expect(providerStatus({})).toEqual({ configured: false, provider: null, model: null });
  });

  it("valid LLM JSON is accepted and tagged with the provider", async () => {
    resetRateLimiter();
    const r = await handleInterpret(body, { env: { GROQ_API_KEY: "test-key" }, fetchImpl: async () => chat(JSON.stringify(good)), ip: "t2" });
    expect(r.status).toBe(200);
    expect("source" in r.body && r.body.source).toBe("llm");
    expect("provider" in r.body && r.body.provider).toBe("groq");
    expect(providerStatus({ GROQ_API_KEY: "x", LLM_MODEL: "custom" })).toEqual({ configured: true, provider: "groq", model: "custom" });
  });

  it("malformed JSON: repairs once, then succeeds", async () => {
    resetRateLimiter();
    let calls = 0;
    const r = await handleInterpret(body, {
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: async () => {
        calls += 1;
        return chat(calls === 1 ? "Sure! Here is the analysis: {not json" : "```json\n" + JSON.stringify(good) + "\n```");
      },
      ip: "t3",
    });
    expect(calls).toBe(2);
    expect("source" in r.body && r.body.source).toBe("llm");
  });

  it("malformed JSON twice: repair then fallback", async () => {
    resetRateLimiter();
    let calls = 0;
    const r = await handleInterpret(body, { env: { OPENAI_API_KEY: "test-key" }, fetchImpl: async () => { calls += 1; return chat("{\"executive_summary\": 5}"); }, ip: "t4" });
    expect(calls).toBe(2);
    expect("source" in r.body && r.body.source).toBe("fallback");
    expect("fallback_reason" in r.body && r.body.fallback_reason).toMatch(/could not be used/);
  });

  it("timeout: falls back without hanging", async () => {
    resetRateLimiter();
    const t0 = Date.now();
    const r = await handleInterpret(body, {
      env: { GEMINI_API_KEY: "test-key" },
      fetchImpl: (_url, init) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
      ip: "t5",
      timeoutMs: 300,
    });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect("source" in r.body && r.body.source).toBe("fallback");
    expect("fallback_reason" in r.body && r.body.fallback_reason).toMatch(/timed out/);
  });

  it("retries once on 429 / 5xx, then falls back", async () => {
    resetRateLimiter();
    let calls = 0;
    const r = await handleInterpret(body, { env: { ANTHROPIC_API_KEY: "test-key" }, fetchImpl: async () => { calls += 1; return new Response("busy", { status: 503 }); }, ip: "t6" });
    expect(calls).toBe(2);
    expect("source" in r.body && r.body.source).toBe("fallback");
  });

  it("rejects oversized and invalid bodies with readable errors", async () => {
    resetRateLimiter();
    const big = await handleInterpret("x".repeat(51 * 1024), { env: {}, fetchImpl: fetch, ip: "t7" });
    expect(big.status).toBe(413);
    const bad = await handleInterpret(JSON.stringify({ mode: "interpret", snapshot: { nope: 1 } }), { env: {}, fetchImpl: fetch, ip: "t7" });
    expect(bad.status).toBe(400);
    const notJson = await handleInterpret("{oops", { env: {}, fetchImpl: fetch, ip: "t7" });
    expect(notJson.status).toBe(400);
  });

  it("rate limits at 10 requests per minute per IP", async () => {
    resetRateLimiter();
    let last = 200;
    for (let i = 0; i < 11; i++) last = (await handleInterpret(body, { env: {}, fetchImpl: fetch, ip: "same-ip", now: 1000 + i })).status;
    expect(last).toBe(429);
  });

  it("ask mode returns a grounded answer or the rule-based answer", async () => {
    resetRateLimiter();
    const askBody = JSON.stringify({ mode: "ask", snapshot: snap, question: "What happens if we skip the December promo?" });
    const r = await handleInterpret(askBody, { env: {}, fetchImpl: fetch, ip: "t8" });
    expect("answer" in r.body && typeof r.body.answer === "string" && r.body.answer.length > 10).toBe(true);
  });
});

describe("adaptive behaviour at the 8-month boundary", () => {
  it("8 months with the default 3-month hold-out runs every non-seasonal model", () => {
    const rows = sample().rows.filter((r) => r.period >= "2026-03");
    const res = run(rows);
    assertHealthy(res);
    expect(res.n).toBe(8);
    const ok = res.models.filter((m) => m.status === "ok").map((m) => m.id).sort();
    expect(ok).toEqual(["arima", "drift", "ensemble", "gbm", "holt", "ma", "naive", "regression", "rf"]);
    expect(res.models.find((m) => m.id === "snaive")?.reason).toBe("Needs 24+ months to learn yearly seasonality");
  });
});

describe("18b: retired or rate-limited LLM model recovery", () => {
  const ing = sample();
  const snap = buildSnapshot(run(ing.rows, {}, ing), "Sample dataset (simulated)");
  const body = JSON.stringify({ mode: "interpret", snapshot: snap });
  const good = ruleBasedInterpretation(snap);

  it("on a 404 for the model, lists models with the same key, switches and succeeds", async () => {
    resetRateLimiter();
    resetModelCache();
    const used: string[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "whisper-large-v3" }, { id: "llama-guard-4-12b" }, { id: "openai/gpt-oss-120b" }, { id: "llama-3.1-8b-instant" }] }), { status: 200 });
      }
      const model = JSON.parse(String(init.body)).model as string;
      used.push(model);
      if (model === "llama-3.3-70b-versatile") return new Response(JSON.stringify({ error: { message: "The model `llama-3.3-70b-versatile` has been decommissioned" } }), { status: 404 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(good) } }] }), { status: 200 });
    };
    const r = await handleInterpret(body, { env: { GROQ_API_KEY: "test-key" }, fetchImpl, ip: "m1" });
    expect("source" in r.body && r.body.source).toBe("llm");
    expect("model" in r.body && r.body.model).toBe("openai/gpt-oss-120b");
    expect(used).toEqual(["llama-3.3-70b-versatile", "openai/gpt-oss-120b"]);
    // the discovered model is remembered for later requests and reported by the status endpoint
    expect(providerStatus({ GROQ_API_KEY: "x" }).model).toBe("openai/gpt-oss-120b");
    resetModelCache();
  });

  it("on a 429 for one model, tries another model for that request and reports a clean reason if all are limited", async () => {
    resetRateLimiter();
    resetModelCache();
    const used: string[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "llama-3.3-70b-versatile" }, { id: "meta-llama/llama-4-scout-17b-16e-instruct" }] }), { status: 200 });
      const model = JSON.parse(String(init.body)).model as string;
      used.push(model);
      if (model === "llama-3.3-70b-versatile") return new Response(JSON.stringify({ error: { message: "Rate limit reached for model in organization org_secret" } }), { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(good) } }] }), { status: 200 });
    };
    const r = await handleInterpret(body, { env: { GROQ_API_KEY: "test-key" }, fetchImpl, ip: "m2" });
    expect("source" in r.body && r.body.source).toBe("llm");
    expect(used).toEqual(["llama-3.3-70b-versatile", "meta-llama/llama-4-scout-17b-16e-instruct"]);
    // a rate-limit switch is per request, not remembered
    expect(providerStatus({ GROQ_API_KEY: "x" }).model).toBe("llama-3.3-70b-versatile");

    resetRateLimiter();
    const allLimited = async (url: string) =>
      url.endsWith("/models") ? new Response(JSON.stringify({ data: [{ id: "llama-3.3-70b-versatile" }] }), { status: 200 }) : new Response(JSON.stringify({ error: { message: "org_secret" } }), { status: 429 });
    const r2 = await handleInterpret(body, { env: { GROQ_API_KEY: "test-key" }, fetchImpl: allLimited, ip: "m3" });
    expect("source" in r2.body && r2.body.source).toBe("fallback");
    const reason = "fallback_reason" in r2.body ? String(r2.body.fallback_reason) : "";
    expect(reason).toMatch(/rate limit/);
    expect(reason).not.toMatch(/org_secret/);
  });

  it("picks sensible chat models for every provider", () => {
    expect(pickModel("groq", ["whisper-large-v3", "llama-3.1-8b-instant", "meta-llama/llama-4-scout-17b-16e-instruct", "openai/gpt-oss-120b"])).toBe("openai/gpt-oss-120b");
    expect(pickModel("openai", ["dall-e-3", "gpt-4.1-mini", "text-embedding-3-small", "gpt-4o-mini-tts"])).toBe("gpt-4.1-mini");
    expect(pickModel("gemini", ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "text-embedding-004"])).toBe("gemini-2.5-flash");
    expect(pickModel("anthropic", ["claude-opus-5-5", "claude-haiku-5-5", "claude-sonnet-5-5"])).toBe("claude-haiku-5-5");
  });
});
