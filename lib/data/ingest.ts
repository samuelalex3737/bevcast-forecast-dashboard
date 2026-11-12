import Papa from "papaparse";
import type { Cell, ColumnMapping, DataLayout, DataRow, Frequency, IngestNotice, IngestResult, RejectedRow } from "./schema";
import { DEFAULT_REGION, DataRowSchema } from "./schema";
import { detectColumns, columnValues } from "./detectColumns";
import { parseDateColumn, toPeriod, dayIndex, looksLikeDate, formatPeriod, type YMD } from "./parseDates";
import { cleanNumber, cleanPromo, cleanRegion } from "./clean";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_ROWS = 20000;

/* ------------------------------------------------------------------ */
/* Raw parsing                                                          */
/* ------------------------------------------------------------------ */

/** Parse CSV, TSV or text pasted from Excel / Google Sheets into a cell table. */
export function parseTextTable(text: string): Cell[][] {
  const clean = text.replace(/^﻿/, "");
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: "greedy", delimiter: "" });
  return result.data.map((row) => row.map((c) => (typeof c === "string" ? c : String(c ?? ""))));
}

/** Parse the first non-empty sheet of an .xlsx/.xls workbook. SheetJS is loaded on demand. */
export async function parseWorkbook(buffer: ArrayBuffer): Promise<Cell[][]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "array", cellDates: false });
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
    const table: Cell[][] = rows.map((r) =>
      (Array.isArray(r) ? r : []).map((c): Cell => {
        if (c === null || c === undefined) return null;
        if (typeof c === "number" || typeof c === "string" || typeof c === "boolean") return c;
        if (c instanceof Date) return c.toISOString().slice(0, 10);
        return String(c);
      }),
    );
    if (table.some((r) => r.some((c) => c !== null && c !== ""))) return table;
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Ingestion                                                            */
/* ------------------------------------------------------------------ */

export interface IngestOptions {
  mapping?: ColumnMapping;
  layout?: DataLayout;
}

interface RawRecord {
  date: YMD;
  region: string;
  units: number | null;
  temp: number | null;
  promo: 0 | 1 | null;
  line: number;
}

function isEmptyCell(c: Cell): boolean {
  return c === null || (typeof c === "string" && c.trim() === "");
}

function cellText(c: Cell): string {
  return c === null ? "" : String(c).trim();
}

function trimTable(table: Cell[][]): Cell[][] {
  const rows = table.filter((r) => r.some((c) => !isEmptyCell(c)));
  let width = 0;
  for (const r of rows) {
    for (let i = r.length - 1; i >= 0; i--) {
      if (!isEmptyCell(r[i])) {
        width = Math.max(width, i + 1);
        break;
      }
    }
  }
  return rows.map((r) => {
    const out = r.slice(0, width);
    while (out.length < width) out.push(null);
    return out;
  });
}

function hasHeaderRow(row: Cell[]): boolean {
  return row.some((c) => typeof c === "string" && c.trim() !== "" && cleanNumber(c) === null && !looksLikeDate(c));
}

function emptyMapping(): ColumnMapping {
  return { period: null, target: null, region: null, temp: null, promo: null };
}

function fail(headers: string[], preview: string[][], rawRows: number, message: string, mapping: ColumnMapping, notices: IngestNotice[] = []): IngestResult {
  return {
    ok: false,
    rows: [],
    notices: [...notices, { level: "error", code: "failed", message }],
    rejected: [],
    headers,
    preview,
    mapping,
    mappingConfident: false,
    layout: "long",
    frequency: "monthly",
    stats: { rawRows, acceptedRows: 0, outputRows: 0 },
  };
}

export function ingestText(text: string, opts: IngestOptions = {}): IngestResult {
  return ingestTable(parseTextTable(text), opts);
}

export function ingestTable(input: Cell[][], opts: IngestOptions = {}): IngestResult {
  const table = trimTable(input);
  const notices: IngestNotice[] = [];
  if (table.length === 0) return fail([], [], 0, "The file is empty. Add a header row and at least 4 months of data.", emptyMapping());

  const headerPresent = hasHeaderRow(table[0]);
  const headers = headerPresent ? table[0].map((c, i) => cellText(c) || `column_${i + 1}`) : table[0].map((_, i) => `column_${i + 1}`);
  const body = headerPresent ? table.slice(1) : table;
  const lineOffset = headerPresent ? 2 : 1;
  const preview = body.slice(0, 5).map((r) => r.map(cellText));
  if (!headerPresent) notices.push({ level: "info", code: "no-header", message: "No header row was found, so columns were detected from their contents." });
  if (body.length === 0) return fail(headers, preview, 0, "Only a header row was found. Add data rows below it.", emptyMapping(), notices);

  let mapping: ColumnMapping;
  let layout: DataLayout;
  let valueColumns: number[] = [];
  let confident: boolean;
  if (opts.mapping) {
    mapping = opts.mapping;
    layout = opts.layout ?? "long";
    confident = true;
    if (layout === "wide-regions-as-columns") {
      const used = new Set([mapping.period, mapping.temp, mapping.promo].filter((x): x is number => x !== null));
      valueColumns = headers.map((_, i) => i).filter((i) => !used.has(i));
    }
  } else {
    const det = detectColumns(headers, body);
    mapping = det.mapping;
    layout = det.layout;
    valueColumns = det.valueColumns;
    confident = det.confident;
    for (const r of det.reasons) notices.push({ level: "info", code: "detect", message: r });
  }

  if (layout === "long" && (mapping.period === null || mapping.target === null)) {
    return {
      ...fail(headers, preview, body.length, mapping.period === null ? "Could not identify the date/period column. Please map the columns." : "Could not identify the sales column. Please map the columns.", mapping, notices),
      mappingConfident: false,
    };
  }

  const rejected: RejectedRow[] = [];
  const records: RawRecord[] = [];
  let nonNumeric = 0;
  let tempOutOfRange = 0;

  const pushRecord = (date: YMD, region: string, unitsCell: Cell, tempCell: Cell, promoCell: Cell, line: number) => {
    const units = cleanNumber(unitsCell);
    if (units === null && !isEmptyCell(unitsCell)) nonNumeric += 1;
    if (units !== null && units < 0) {
      rejected.push({ line, reason: `negative units (${cellText(unitsCell)}) rejected; sales cannot be negative.` });
      return;
    }
    let temp = cleanNumber(tempCell);
    if (temp !== null && (temp < -60 || temp > 70)) {
      tempOutOfRange += 1;
      temp = null;
    }
    records.push({ date, region, units, temp, promo: cleanPromo(promoCell), line });
  };

  if (layout === "wide-periods-as-columns") {
    const dateCells: Cell[] = valueColumns.map((i) => headers[i]);
    const parsed = parseDateColumn(dateCells);
    for (const note of parsed.notes) notices.push({ level: "info", code: "dates", message: note });
    body.forEach((row, i) => {
      const region = mapping.region !== null ? cleanRegion(row[mapping.region]) || `Region ${i + 1}` : `Region ${i + 1}`;
      valueColumns.forEach((col, k) => {
        const date = parsed.values[k];
        if (!date) return;
        pushRecord(date, region, row[col], null, null, i + lineOffset);
      });
    });
    notices.push({ level: "info", code: "melted", message: `Wide layout (periods as columns) was reshaped to long format: ${body.length} region row(s) x ${valueColumns.length} periods.` });
  } else {
    const periodCol = mapping.period as number;
    const parsed = parseDateColumn(columnValues(body, periodCol));
    for (const note of parsed.notes) notices.push({ level: "info", code: "dates", message: note });
    body.forEach((row, i) => {
      const line = i + lineOffset;
      if (row.every(isEmptyCell)) return;
      const date = parsed.values[i];
      if (!date) {
        rejected.push({ line, reason: `could not read the date "${cellText(row[periodCol])}".` });
        return;
      }
      const tempCell = mapping.temp !== null ? row[mapping.temp] : null;
      const promoCell = mapping.promo !== null ? row[mapping.promo] : null;
      if (layout === "wide-regions-as-columns") {
        for (const col of valueColumns) pushRecord(date, headers[col], row[col], tempCell, promoCell, line);
      } else {
        const region = mapping.region !== null ? cleanRegion(row[mapping.region]) || "Unassigned" : DEFAULT_REGION;
        pushRecord(date, region, row[mapping.target as number], tempCell, promoCell, line);
      }
    });
    if (layout === "wide-regions-as-columns") {
      notices.push({ level: "info", code: "melted", message: `Wide layout (regions as columns) was reshaped to long format: ${valueColumns.length} region column(s) (${valueColumns.map((c) => headers[c]).join(", ")}).` });
    }
  }

  if (mapping.region === null && layout === "long") notices.push({ level: "info", code: "no-region", message: `No region column found, so all rows form one series named "${DEFAULT_REGION}".` });
  if (mapping.temp === null) notices.push({ level: "info", code: "no-temp", message: "No temperature column found. Temperature-driven features are disabled." });
  if (mapping.promo === null) notices.push({ level: "info", code: "no-promo", message: "No promo column found. Promo-driven features are disabled." });
  if (nonNumeric > 0) notices.push({ level: "warn", code: "non-numeric", message: `${nonNumeric} sales value(s) were not numbers and are treated as missing.` });
  if (tempOutOfRange > 0) notices.push({ level: "warn", code: "temp-range", message: `${tempOutOfRange} temperature value(s) outside -60 to 70 °C were ignored.` });
  for (const r of rejected.slice(0, 20)) notices.push({ level: "error", code: "rejected", message: `Line ${r.line}: ${r.reason}` });
  if (rejected.length > 20) notices.push({ level: "error", code: "rejected", message: `${rejected.length - 20} more row(s) rejected.` });

  if (records.length === 0) {
    return { ...fail(headers, preview, body.length, "No usable rows were found after cleaning.", mapping, notices), rejected };
  }

  // Order check (by full date)
  for (let i = 1; i < records.length; i++) {
    if (dayIndex(records[i].date) < dayIndex(records[i - 1].date) && records[i].region === records[i - 1].region) {
      notices.push({ level: "warn", code: "unsorted", message: "Rows were not in date order. They have been sorted." });
      break;
    }
  }

  // Frequency detection
  let frequency: Frequency = "monthly";
  const subMonthly = new Map<string, Set<number>>();
  for (const r of records) {
    const key = `${r.region}|${toPeriod(r.date)}`;
    const set = subMonthly.get(key) ?? new Set<number>();
    set.add(dayIndex(r.date));
    subMonthly.set(key, set);
  }
  const multiDayMonths = Array.from(subMonthly.values()).filter((s) => s.size > 1).length;
  if (multiDayMonths >= Math.max(1, Math.floor(subMonthly.size * 0.5))) {
    const days = Array.from(new Set(records.map((r) => dayIndex(r.date)))).sort((a, b) => a - b);
    const gaps = days.slice(1).map((d, i) => d - days[i]).sort((a, b) => a - b);
    const medGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1;
    frequency = medGap <= 3 ? "daily" : "weekly";
  }

  // Aggregate to (period, region)
  interface Acc { units: number | null; temps: number[]; promo: 0 | 1 | null; count: number; days: Set<number> }
  const acc = new Map<string, Acc>();
  for (const r of records) {
    const key = `${toPeriod(r.date)}|${r.region}`;
    const a = acc.get(key) ?? { units: null, temps: [], promo: null, count: 0, days: new Set<number>() };
    if (r.units !== null) a.units = (a.units ?? 0) + r.units;
    if (r.temp !== null) a.temps.push(r.temp);
    if (r.promo !== null) a.promo = a.promo === 1 || r.promo === 1 ? 1 : 0;
    a.count += 1;
    a.days.add(dayIndex(r.date));
    acc.set(key, a);
  }

  if (frequency === "monthly") {
    const dups = Array.from(acc.entries()).filter(([, a]) => a.count > 1);
    if (dups.length > 0) {
      notices.push({
        level: "warn",
        code: "duplicates",
        message: `${dups.reduce((s, [, a]) => s + a.count - 1, 0)} duplicate period/region row(s) were summed (${dups.slice(0, 3).map(([k]) => k.replace("|", " / ")).join(", ")}${dups.length > 3 ? ", ..." : ""}).`,
      });
    }
  } else {
    const periods = Array.from(new Set(Array.from(acc.keys()).map((k) => k.split("|")[0]))).sort();
    notices.push({
      level: "warn",
      code: "aggregated",
      message: `${frequency === "daily" ? "Daily" : "Weekly"} data detected (${records.length} rows). Summed to ${periods.length} monthly totals per region; temperature averaged, promo set to 1 if any day had a promo.`,
    });
    if (frequency === "daily" && periods.length > 0) {
      const coverage = (period: string) => {
        let maxDays = 0;
        for (const [k, a] of acc) if (k.startsWith(period)) maxDays = Math.max(maxDays, a.days.size);
        const [y, m] = period.split("-").map(Number);
        return { days: maxDays, total: new Date(Date.UTC(y, m, 0)).getUTCDate() };
      };
      for (const p of [periods[0], periods[periods.length - 1]]) {
        const c = coverage(p);
        if (c.days / c.total < 0.9) {
          notices.push({ level: "warn", code: "partial-month", message: `${formatPeriod(p)} only covers ${c.days} of ${c.total} days, so its monthly total is understated.` });
        }
      }
    }
  }

  const rows: DataRow[] = [];
  for (const [key, a] of acc) {
    const [period, region] = key.split("|");
    const candidate = {
      period,
      region,
      units: a.units,
      temp: a.temps.length ? Math.round((a.temps.reduce((x, y) => x + y, 0) / a.temps.length) * 10) / 10 : null,
      promo: a.promo,
    };
    const parsed = DataRowSchema.safeParse(candidate);
    if (parsed.success) rows.push(parsed.data);
  }
  rows.sort((a, b) => (a.period === b.period ? a.region.localeCompare(b.region) : a.period < b.period ? -1 : 1));

  if (rows.length > MAX_OUTPUT_ROWS) {
    return fail(headers, preview, body.length, `The data produces ${rows.length} monthly rows, above the ${MAX_OUTPUT_ROWS} row limit.`, mapping, notices);
  }

  return {
    ok: rows.length > 0,
    rows,
    notices,
    rejected,
    headers,
    preview,
    mapping,
    mappingConfident: confident,
    layout,
    frequency,
    stats: { rawRows: body.length, acceptedRows: records.length, outputRows: rows.length },
  };
}

/* ------------------------------------------------------------------ */
/* Export                                                               */
/* ------------------------------------------------------------------ */

function csvEscape(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(rows: DataRow[]): string {
  const hasTemp = rows.some((r) => r.temp !== null);
  const hasPromo = rows.some((r) => r.promo !== null);
  const header = ["month", "region", "units", ...(hasTemp ? ["avg_temp_c"] : []), ...(hasPromo ? ["promo"] : [])];
  const lines = rows.map((r) =>
    [r.period, r.region, r.units, ...(hasTemp ? [r.temp] : []), ...(hasPromo ? [r.promo] : [])].map(csvEscape).join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

export function tableToCsv(header: string[], rows: (string | number | null)[][]): string {
  return [header.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n");
}
