import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ingestText } from "@/lib/data/ingest";
import { runEngine } from "@/lib/forecast";
import { DEFAULT_SETTINGS } from "@/lib/forecast/settings";

const fmt = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : v.toFixed(d));

it("prints the leaderboard computed on the shipped sample dataset", () => {
  const csv = readFileSync(path.join(__dirname, "..", "public", "data", "bevcast_sample_sales.csv"), "utf8");
  const ing = ingestText(csv);
  const res = runEngine({ rows: ing.rows, settings: DEFAULT_SETTINGS, scenario: {}, ingestNotices: ing.notices, rejected: ing.rejected });
  const lines: string[] = [];
  lines.push(`n = ${res.n} months, hold-out = ${res.holdoutSize} (${res.split.testPeriods.join(", ")}), walk-forward origins = ${res.wfOrigins.join(", ")}`);
  lines.push("rank | model                     | ho MAPE | ho WAPE | bias%  | RMSE     | MASE | wf MAPE | wf WAPE | status");
  const order = [...res.ranking, ...res.models.filter((m) => !res.ranking.includes(m.id)).map((m) => m.id)];
  order.forEach((id, i) => {
    const m = res.models.find((x) => x.id === id);
    if (!m) return;
    const ho = m.holdout?.metrics;
    const wf = m.walkForward?.metrics;
    lines.push(
      `${String(res.ranking.includes(id) ? i + 1 : "-").padEnd(4)} | ${m.shortName.padEnd(25)} | ${fmt(ho?.mape).padStart(7)} | ${fmt(ho?.wape).padStart(7)} | ${fmt(ho?.bias).padStart(6)} | ${fmt(ho?.rmse, 0).padStart(8)} | ${fmt(ho?.mase).padStart(4)} | ${fmt(wf?.mape).padStart(7)} | ${fmt(wf?.wape).padStart(7)} | ${m.status}${m.reason ? ` (${m.reason})` : ""}${m.label ? ` [${m.label}]` : ""}`,
    );
  });
  lines.push(`Best: ${res.bestId}; selected: ${res.selectedId}`);
  for (const f of res.forecast) {
    lines.push(`  ${f.period}: forecast ${f.forecast.toFixed(0)}  ${res.settings.confidence}% [${f.lower.toFixed(0)}, ${f.upper.toFixed(0)}]  safety ${f.safetyStock.toFixed(0)}  produce ${f.recommended}  (temp ${f.temp}, promo ${f.promo})`);
  }
  if (res.cost) lines.push(`Cost of error on hold-out: best AED ${res.cost.best.total.toFixed(0)} vs naive AED ${res.cost.naive.total.toFixed(0)} -> saved AED ${res.cost.savings.toFixed(0)}`);
  lines.push(`Summary: total ${res.summary.total}, peak ${res.summary.peak?.period} ${res.summary.peak?.value}, r(temp, sales) = ${fmt(res.summary.tempSalesR, 3)}, promo lift = ${fmt(res.summary.promoLiftPct, 1)}%`);
  lines.push(`Compute time: ${res.computeMs.toFixed(0)} ms`);
  console.log(lines.join("\n"));
  expect(res.status).toBe("ok");
  expect(res.ranking.length).toBeGreaterThan(0);
});
