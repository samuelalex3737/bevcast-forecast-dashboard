import type { Cell } from "./schema";

export interface YMD {
  y: number;
  m: number;
  d: number;
  /** true when the source only had month resolution (e.g. "2025-11", "Jan 2025"). */
  monthOnly: boolean;
}

export type DayOrder = "DMY" | "MDY";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86400000;

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function valid(y: number, m: number, d: number): boolean {
  return (
    Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) &&
    y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
  );
}

function expandYear(yy: number, digits: number): number {
  if (digits >= 4) return yy;
  return yy < 70 ? 2000 + yy : 1900 + yy;
}

function monthFromName(name: string): number | null {
  const key = name.trim().toLowerCase().replace(/\.$/, "");
  return MONTHS[key] ?? null;
}

export function fromExcelSerial(serial: number): YMD | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 120000) return null;
  const date = new Date(EXCEL_EPOCH_MS + Math.floor(serial) * DAY_MS);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return valid(y, m, d) ? { y, m, d, monthOnly: false } : null;
}

/** Result of parsing one cell before day/month ambiguity has been resolved. */
type CellParse =
  | { kind: "ok"; value: YMD }
  | { kind: "ambiguous"; a: number; b: number; y: number }
  | { kind: "fail" };

function parseCell(cell: Cell): CellParse {
  if (cell === null || cell === undefined || typeof cell === "boolean") return { kind: "fail" };
  if (typeof cell === "number") return parseNumeric(cell);
  const s = String(cell).trim();
  if (s === "") return { kind: "fail" };

  // Pure numeric strings: YYYYMM or Excel serial.
  if (/^\d+(\.\d+)?$/.test(s)) return parseNumeric(Number(s));

  let m: RegExpMatchArray | null;

  // YYYY-MM or YYYY/MM
  m = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return valid(y, mo, 1) ? { kind: "ok", value: { y, m: mo, d: 1, monthOnly: true } } : { kind: "fail" };
  }

  // YYYY-MM-DD with optional time
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return valid(y, mo, d) ? { kind: "ok", value: { y, m: mo, d, monthOnly: false } } : { kind: "fail" };
  }

  // MM/YYYY
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const mo = Number(m[1]);
    const y = Number(m[2]);
    return valid(y, mo, 1) ? { kind: "ok", value: { y, m: mo, d: 1, monthOnly: true } } : { kind: "fail" };
  }

  // DD/MM/YYYY or MM/DD/YYYY (ambiguous), with optional time
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s.*)?$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = expandYear(Number(m[3]), m[3].length);
    return { kind: "ambiguous", a, b, y };
  }

  // Jan 2025, January-2025, Jan-25, Jan.25, "Jan, 2025"
  m = s.match(/^([A-Za-z]{3,9})\.?[\s\-/.,']*(\d{2}|\d{4})$/);
  if (m) {
    const mo = monthFromName(m[1]);
    const y = expandYear(Number(m[2]), m[2].length);
    if (mo && valid(y, mo, 1)) return { kind: "ok", value: { y, m: mo, d: 1, monthOnly: true } };
    return { kind: "fail" };
  }

  // 2025 Jan, 2025-January
  m = s.match(/^(\d{4})[\s\-/.,]*([A-Za-z]{3,9})\.?$/);
  if (m) {
    const mo = monthFromName(m[2]);
    const y = Number(m[1]);
    if (mo && valid(y, mo, 1)) return { kind: "ok", value: { y, m: mo, d: 1, monthOnly: true } };
    return { kind: "fail" };
  }

  // 01-Jan-2025, 1 January 2025
  m = s.match(/^(\d{1,2})[\s\-/.]([A-Za-z]{3,9})\.?[\s\-/.,]*(\d{2}|\d{4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = monthFromName(m[2]);
    const y = expandYear(Number(m[3]), m[3].length);
    if (mo && valid(y, mo, d)) return { kind: "ok", value: { y, m: mo, d, monthOnly: false } };
    return { kind: "fail" };
  }

  // Jan 5, 2025 / January 5 2025
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = monthFromName(m[1]);
    const d = Number(m[2]);
    const y = Number(m[3]);
    if (mo && valid(y, mo, d)) return { kind: "ok", value: { y, m: mo, d, monthOnly: false } };
    return { kind: "fail" };
  }

  return { kind: "fail" };
}

function parseNumeric(n: number): CellParse {
  if (!Number.isFinite(n)) return { kind: "fail" };
  // YYYYMM, e.g. 202511
  if (Number.isInteger(n) && n >= 190001 && n <= 220012) {
    const y = Math.floor(n / 100);
    const mo = n % 100;
    if (valid(y, mo, 1)) return { kind: "ok", value: { y, m: mo, d: 1, monthOnly: true } };
  }
  // Excel serial between 1954 and 2119
  if (n >= 20000 && n <= 80000) {
    const v = fromExcelSerial(n);
    return v ? { kind: "ok", value: v } : { kind: "fail" };
  }
  return { kind: "fail" };
}

function dayNumber(v: YMD): number {
  return Math.round(Date.UTC(v.y, v.m - 1, v.d) / DAY_MS);
}

function resolve(p: { a: number; b: number; y: number }, order: DayOrder): YMD | null {
  const d = order === "DMY" ? p.a : p.b;
  const mo = order === "DMY" ? p.b : p.a;
  return valid(p.y, mo, d) ? { y: p.y, m: mo, d, monthOnly: false } : null;
}

function regularityScore(values: (YMD | null)[]): number {
  const days = Array.from(new Set(values.filter((v): v is YMD => v !== null).map(dayNumber))).sort((x, y) => x - y);
  let score = 0;
  for (let i = 1; i < days.length; i++) {
    const diff = days[i] - days[i - 1];
    if (diff >= 1 && diff <= 31) score += 1;
  }
  return score;
}

export interface DateColumnResult {
  values: (YMD | null)[];
  parsedCount: number;
  order: DayOrder | null;
  notes: string[];
}

/**
 * Parse a whole column of date-like cells. Day/month ambiguity (DD/MM vs MM/DD) is resolved at
 * column level: impossible readings are ruled out first, then a constant component is treated as
 * the day (monthly data is usually stamped on the same day), then the reading that gives the more
 * regular calendar sequence wins. Ties fall back to DD/MM (UAE convention).
 */
export function parseDateColumn(cells: Cell[]): DateColumnResult {
  const parsed = cells.map(parseCell);
  const amb = parsed.filter((p): p is { kind: "ambiguous"; a: number; b: number; y: number } => p.kind === "ambiguous");
  const notes: string[] = [];
  let order: DayOrder | null = null;

  if (amb.length > 0) {
    const dmyPossible = amb.every((p) => resolve(p, "DMY") !== null);
    const mdyPossible = amb.every((p) => resolve(p, "MDY") !== null);
    if (dmyPossible && !mdyPossible) order = "DMY";
    else if (mdyPossible && !dmyPossible) order = "MDY";
    else if (!dmyPossible && !mdyPossible) {
      const dmyCount = amb.filter((p) => resolve(p, "DMY") !== null).length;
      const mdyCount = amb.filter((p) => resolve(p, "MDY") !== null).length;
      order = dmyCount >= mdyCount ? "DMY" : "MDY";
    } else {
      const firstConstant = new Set(amb.map((p) => p.a)).size === 1 && amb.length > 1;
      const secondConstant = new Set(amb.map((p) => p.b)).size === 1 && amb.length > 1;
      if (firstConstant && !secondConstant) order = "DMY";
      else if (secondConstant && !firstConstant) order = "MDY";
      else {
        const asD = amb.map((p) => resolve(p, "DMY"));
        const asM = amb.map((p) => resolve(p, "MDY"));
        order = regularityScore(asM) > regularityScore(asD) ? "MDY" : "DMY";
      }
    }
    notes.push(
      order === "DMY"
        ? "Dates like 01/03/2026 were read as DD/MM/YYYY (day first)."
        : "Dates like 01/03/2026 were read as MM/DD/YYYY (month first).",
    );
  }

  const values = parsed.map((p) => {
    if (p.kind === "ok") return p.value;
    if (p.kind === "ambiguous") return resolve(p, order ?? "DMY");
    return null;
  });
  const parsedCount = values.filter((v) => v !== null).length;
  return { values, parsedCount, order, notes };
}

/** Quick per-cell check used for header and column detection. */
export function looksLikeDate(cell: Cell): boolean {
  return parseCell(cell).kind !== "fail";
}

export function toPeriod(v: YMD): string {
  return `${v.y}-${String(v.m).padStart(2, "0")}`;
}

export function periodToIndex(period: string): number {
  const [y, m] = period.split("-").map(Number);
  return y * 12 + (m - 1);
}

export function indexToPeriod(idx: number): string {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function addMonths(period: string, k: number): string {
  return indexToPeriod(periodToIndex(period) + k);
}

export function monthOfPeriod(period: string): number {
  return Number(period.slice(5, 7));
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function formatPeriod(period: string, style: "short" | "long" = "short"): string {
  const m = monthOfPeriod(period);
  const y = period.slice(0, 4);
  if (!Number.isFinite(m) || m < 1 || m > 12) return period;
  return style === "short" ? `${MONTH_SHORT[m - 1]} ${y}` : `${MONTH_LONG[m - 1]} ${y}`;
}

export function dayIndex(v: YMD): number {
  return dayNumber(v);
}
