import { readFileSync } from "node:fs";
import path from "node:path";
import { ingestText } from "./ingest";
import { runEngine } from "@/lib/forecast";
import { DEFAULT_SETTINGS } from "@/lib/forecast/settings";
import type { InitialData } from "@/lib/store/initialResult";

/**
 * Parse the shipped sample dataset and train every model on it at build time, so the first paint
 * already shows real results. The browser then retrains live in a Web Worker; with the same data
 * and seed it produces the identical result.
 */
export function buildInitialData(): InitialData | null {
  try {
    const csv = readFileSync(path.join(process.cwd(), "public", "data", "bevcast_sample_sales.csv"), "utf8");
    const ing = ingestText(csv);
    if (!ing.ok) return null;
    const result = runEngine({ rows: ing.rows, settings: DEFAULT_SETTINGS, scenario: {}, ingestNotices: ing.notices, rejected: ing.rejected });
    return { rows: ing.rows, notices: ing.notices, result: JSON.parse(JSON.stringify(result)) };
  } catch {
    return null;
  }
}
