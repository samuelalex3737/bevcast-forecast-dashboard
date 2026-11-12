/** Formatting helpers that never render NaN, Infinity or undefined. */

export const NA = "n/a";

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function fmtInt(v: number | null | undefined): string {
  return isNum(v) ? Math.round(v).toLocaleString("en-US") : NA;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  return isNum(v) ? v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : NA;
}

export function fmtPct(v: number | null | undefined, digits = 1, signed = false): string {
  if (!isNum(v)) return NA;
  const s = v.toFixed(digits);
  return `${signed && v > 0 ? "+" : ""}${s}%`;
}

export function fmtAed(v: number | null | undefined, digits = 0): string {
  if (!isNum(v)) return NA;
  return `AED ${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** 1,234,567 -> "1.23M", 51,484 -> "51.5k" */
export function fmtCompact(v: number | null | undefined): string {
  if (!isNum(v)) return NA;
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  return Math.round(v).toLocaleString("en-US");
}

export function round(v: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function safeRound(v: number | null | undefined, digits = 0): number | null {
  return isNum(v) ? round(v, digits) : null;
}
