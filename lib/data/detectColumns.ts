import type { Cell, ColumnMapping, DataLayout } from "./schema";
import { looksLikeDate } from "./parseDates";
import { cleanNumber } from "./clean";

export const SYNONYMS: Record<"period" | "target" | "region" | "temp" | "promo", string[]> = {
  period: ["month", "date", "period", "time", "yyyymm", "month_year", "monthyear", "year_month", "week", "day"],
  target: ["units", "sales", "qty", "quantity", "demand", "volume", "revenue", "value", "units_sold", "sold"],
  region: ["region", "market", "area", "city", "territory", "store", "location", "emirate", "zone"],
  temp: ["temp", "temperature", "avg_temp", "avg_temp_c", "avgtemp", "mean_temp"],
  promo: ["promo", "promotion", "campaign", "discount_flag", "promo_flag", "on_promo"],
};

export function normaliseHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[()\[\]°%]/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

type Field = keyof typeof SYNONYMS;

/** Score how well a header matches a field: 3 exact, 2 token match, 1 substring, 0 none. */
function matchScore(header: string, field: Field): number {
  const h = normaliseHeader(header);
  if (!h) return 0;
  const syns = SYNONYMS[field];
  if (syns.includes(h)) return 3;
  const tokens = h.split("_");
  if (syns.some((s) => !s.includes("_") && tokens.includes(s))) return 2;
  if (syns.some((s) => s.length >= 4 && h.includes(s))) return 1;
  return 0;
}

export function columnValues(body: Cell[][], col: number): Cell[] {
  return body.map((r) => (col < r.length ? r[col] : null));
}

function nonEmpty(values: Cell[]): Cell[] {
  return values.filter((v) => v !== null && !(typeof v === "string" && v.trim() === ""));
}

export function numericShare(values: Cell[]): number {
  const ne = nonEmpty(values);
  if (ne.length === 0) return 0;
  return ne.filter((v) => cleanNumber(v) !== null).length / ne.length;
}

export function dateShare(values: Cell[]): number {
  const ne = nonEmpty(values);
  if (ne.length === 0) return 0;
  return ne.filter((v) => looksLikeDate(v)).length / ne.length;
}

/** Share of non-empty cells that are text and not dates (used to spot a category column). */
function textShare(values: Cell[]): number {
  const ne = nonEmpty(values);
  if (ne.length === 0) return 0;
  return ne.filter((v) => typeof v === "string" && cleanNumber(v) === null && !looksLikeDate(v)).length / ne.length;
}

export interface Detection {
  mapping: ColumnMapping;
  confident: boolean;
  layout: DataLayout;
  /** wide-regions-as-columns: indices of the region value columns */
  valueColumns: number[];
  reasons: string[];
}

function bestMatch(headers: string[], field: Field, taken: Set<number>): number | null {
  let best: number | null = null;
  let bestScore = 0;
  headers.forEach((h, i) => {
    if (taken.has(i)) return;
    const s = matchScore(h, field);
    if (s > bestScore) {
      best = i;
      bestScore = s;
    }
  });
  return best;
}

export function detectColumns(headers: string[], body: Cell[][]): Detection {
  const reasons: string[] = [];
  const taken = new Set<number>();
  const mapping: ColumnMapping = { period: null, target: null, region: null, temp: null, promo: null };
  let confident = true;

  // 1. Period column by header synonym, then by content (text dates only, so a units column of
  // 30,000 to 80,000 is never mistaken for Excel serial dates).
  let period = bestMatch(headers, "period", taken);
  if (period !== null && dateShare(columnValues(body, period)) < 0.6) period = null;
  if (period === null) {
    for (let i = 0; i < headers.length; i++) {
      const vals = columnValues(body, i);
      const ne = nonEmpty(vals);
      const textDates = ne.filter((v) => typeof v === "string" && /[a-z/\-.]/i.test(v) && looksLikeDate(v)).length;
      if (ne.length > 0 && textDates / ne.length >= 0.8) {
        period = i;
        reasons.push(`Column "${headers[i]}" was recognised as dates from its contents.`);
        break;
      }
    }
  }

  // 2. Wide format with periods as column headers (regions as rows).
  if (period === null) {
    const dateHeaders = headers.map((h, i) => ({ h, i })).filter(({ h, i }) => i > 0 && looksLikeDate(h));
    if (dateHeaders.length >= 2 && dateHeaders.length >= (headers.length - 1) * 0.5) {
      let regionCol = headers.findIndex((h, i) => !looksLikeDate(h) && matchScore(h, "region") > 0 && i >= 0);
      if (regionCol < 0) regionCol = headers.findIndex((h) => !looksLikeDate(h));
      mapping.region = regionCol >= 0 ? regionCol : null;
      reasons.push(`Wide layout detected: ${dateHeaders.length} period columns, one row per region.`);
      return {
        mapping,
        confident: true,
        layout: "wide-periods-as-columns",
        valueColumns: dateHeaders.map((d) => d.i),
        reasons,
      };
    }
    return { mapping, confident: false, layout: "long", valueColumns: [], reasons: ["No date or period column could be identified."] };
  }

  mapping.period = period;
  taken.add(period);

  // 3. Exogenous columns and region by synonyms.
  const temp = bestMatch(headers, "temp", taken);
  if (temp !== null && numericShare(columnValues(body, temp)) >= 0.6) {
    mapping.temp = temp;
    taken.add(temp);
  }
  const promo = bestMatch(headers, "promo", taken);
  if (promo !== null) {
    mapping.promo = promo;
    taken.add(promo);
  }
  const region = bestMatch(headers, "region", taken);
  if (region !== null && textShare(columnValues(body, region)) >= 0.6) {
    mapping.region = region;
    taken.add(region);
  }

  // 4. Target by synonyms.
  const target = bestMatch(headers, "target", taken);
  if (target !== null && numericShare(columnValues(body, target)) >= 0.5) {
    mapping.target = target;
    taken.add(target);
  }

  // Region by content when no synonym matched: a repeating text column.
  if (mapping.region === null) {
    for (let i = 0; i < headers.length; i++) {
      if (taken.has(i)) continue;
      const vals = columnValues(body, i);
      const distinct = new Set(nonEmpty(vals).map((v) => String(v).trim())).size;
      if (textShare(vals) >= 0.8 && distinct >= 1 && distinct <= Math.max(1, Math.ceil(body.length / 2))) {
        mapping.region = i;
        taken.add(i);
        confident = false;
        reasons.push(`Column "${headers[i]}" was guessed to be the region. Please confirm.`);
        break;
      }
    }
  }

  if (mapping.target !== null) {
    return { mapping, confident, layout: "long", valueColumns: [], reasons };
  }

  // 5. No target synonym: inspect remaining numeric columns.
  const numericCols: number[] = [];
  headers.forEach((_, i) => {
    if (taken.has(i)) return;
    if (numericShare(columnValues(body, i)) >= 0.6) numericCols.push(i);
  });

  if (numericCols.length === 1) {
    mapping.target = numericCols[0];
    reasons.push(`Column "${headers[numericCols[0]]}" was used as the sales target (the only numeric column).`);
    // Two-column files (date + value) are unambiguous.
    if (headers.length > 2) confident = false;
    return { mapping, confident, layout: "long", valueColumns: [], reasons };
  }

  if (numericCols.length >= 2 && mapping.region === null) {
    reasons.push(`Wide layout detected: ${numericCols.length} numeric columns were treated as regions.`);
    return { mapping, confident, layout: "wide-regions-as-columns", valueColumns: numericCols, reasons };
  }

  if (numericCols.length >= 2) {
    mapping.target = numericCols[0];
    reasons.push(`Several numeric columns found; "${headers[numericCols[0]]}" was assumed to be the sales target. Please confirm.`);
    return { mapping, confident: false, layout: "long", valueColumns: [], reasons };
  }

  reasons.push("No numeric sales column could be identified.");
  return { mapping, confident: false, layout: "long", valueColumns: [], reasons };
}
