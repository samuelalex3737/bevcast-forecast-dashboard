import type { Snapshot } from "./schema";

export const SYSTEM_PROMPT = `You are a senior demand-planning analyst advising the operations leadership of a beverage company that has just launched a new flavored water in regional markets.

You receive a JSON snapshot of LIVE forecasting results computed seconds ago from the company's current data: monthly actuals, a model leaderboard (hold-out and walk-forward MAPE/WAPE), the selected model's 3-month forecast with prediction intervals, a production plan with safety stock, a regional allocation, the cost of forecast error versus naive planning, and data quality warnings.

Rules:
1. Use ONLY the numbers in the provided JSON. Never invent, estimate or recompute figures that are not in it. When you quote a number, copy it as it appears (you may round to fewer decimals or write 155k for 155,390).
2. Answer the professor's three questions explicitly:
   (a) How well did the model capture seasonality or trends?
   (b) Which model performed best and why?
   (c) What recommendations would you give the company?
3. Be specific, quantified and actionable. Every recommendation must cite a metric from the JSON.
4. Be honest about limitations: a short series (for example 12 months) cannot identify true yearly seasonality, a small hold-out makes rankings fragile, and the dataset may be simulated.
5. Write plain business English. Do not use the em dash character; use a plain hyphen instead.
6. Return valid JSON only, with no markdown fences and no text before or after the JSON.`;

export const INTERPRETATION_JSON_SHAPE = `{
  "executive_summary": "string, at most 3 sentences",
  "seasonality_and_trend": { "verdict": "captured" | "partially captured" | "not captured", "explanation": "string" },
  "best_model": { "name": "string", "why": "string", "caveats": "string" },
  "model_comparison_insight": "string",
  "recommendations": [ { "action": "string", "rationale": "string", "metric_cited": "string", "priority": "high" | "medium" | "low", "owner": "Production" | "Distribution" | "Marketing" | "Data/Analytics" } ],
  "risks": ["string"],
  "data_limitations": ["string"],
  "next_steps": ["string"]
}
Constraints: 4 to 6 recommendations, 2 to 4 risks, at least 1 data limitation and 1 next step.`;

export function buildInterpretMessage(snapshot: Snapshot): string {
  return `Here is the live snapshot (snapshot_id ${snapshot.snapshot_id}):

${JSON.stringify(snapshot)}

Write the interpretation as JSON with exactly this shape:
${INTERPRETATION_JSON_SHAPE}`;
}

export function buildAskMessage(snapshot: Snapshot, question: string): string {
  return `Live snapshot (snapshot_id ${snapshot.snapshot_id}):

${JSON.stringify(snapshot)}

Question from the operations team: ${question}

Answer in at most 150 words using only numbers from the snapshot. If the snapshot cannot answer the question, say what data would be needed. Return JSON only: { "answer": "string" }`;
}

export function repairMessage(issues: string): string {
  return `Your previous reply was not valid JSON matching the required shape (${issues.slice(0, 600)}). Return valid JSON only, with no markdown and no commentary.`;
}
