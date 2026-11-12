import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ingestText, ingestTable, rowsToCsv } from "@/lib/data/ingest";
import { parseDateColumn, fromExcelSerial } from "@/lib/data/parseDates";
import { cleanNumber, cleanPromo, preprocess, robustZScores } from "@/lib/data/clean";
import { buildHealthChecks } from "@/lib/data/health";
import { DEFAULT_REGION } from "@/lib/data/schema";

const fx = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("cleanNumber", () => {
  it("strips currency, thousands separators and whitespace", () => {
    expect(cleanNumber("AED 12,700")).toBe(12700);
    expect(cleanNumber("30,840 AED")).toBe(30840);
    expect(cleanNumber("AED36,490.50")).toBe(36490.5);
    expect(cleanNumber(" 46,460 ")).toBe(46460);
    expect(cleanNumber("$61,090")).toBe(61090);
    expect(cleanNumber("(1,200)")).toBe(-1200);
    expect(cleanNumber("1.234.567,5")).toBe(1234567.5);
  });
  it("returns null for blanks and text", () => {
    expect(cleanNumber("")).toBeNull();
    expect(cleanNumber("n/a")).toBeNull();
    expect(cleanNumber("abc")).toBeNull();
    expect(cleanNumber(null)).toBeNull();
  });
  it("parses promo flags", () => {
    expect(cleanPromo("yes")).toBe(1);
    expect(cleanPromo("0")).toBe(0);
    expect(cleanPromo(true)).toBe(1);
    expect(cleanPromo("")).toBeNull();
  });
});

describe("date parsing", () => {
  it("reads month-only formats", () => {
    const r = parseDateColumn(["2025-11", "Jan 2025", "January-2025", "Jan-25", "202511", "11/2025"]);
    expect(r.values.map((v) => (v ? `${v.y}-${v.m}` : null))).toEqual(["2025-11", "2025-1", "2025-1", "2025-1", "2025-11", "2025-11"]);
  });
  it("resolves DD/MM when the first component is constant (monthly data on day 1)", () => {
    const r = parseDateColumn(["01/03/2026", "01/04/2026", "01/05/2026"]);
    expect(r.order).toBe("DMY");
    expect(r.values[0]).toMatchObject({ y: 2026, m: 3, d: 1 });
  });
  it("resolves MM/DD when a day exceeds 12", () => {
    const r = parseDateColumn(["03/15/2026", "04/15/2026"]);
    expect(r.order).toBe("MDY");
    expect(r.values[1]).toMatchObject({ y: 2026, m: 4, d: 15 });
  });
  it("reads Excel serials", () => {
    expect(fromExcelSerial(46082)).toMatchObject({ y: 2026, m: 3, d: 1 });
    const r = parseDateColumn([46082, "46113"]);
    expect(r.values[1]).toMatchObject({ y: 2026, m: 4, d: 1 });
  });
});

describe("ingestion: sample dataset", () => {
  it("loads 48 rows across 4 regions with exogenous columns", () => {
    const res = ingestText(fx("sample_sales.csv"));
    expect(res.ok).toBe(true);
    expect(res.mappingConfident).toBe(true);
    expect(res.rows).toHaveLength(48);
    expect(new Set(res.rows.map((r) => r.region)).size).toBe(4);
    expect(res.rows.every((r) => r.temp !== null && r.promo !== null)).toBe(true);
    const prep = preprocess(res.rows, { scope: null, fillGaps: true });
    expect(prep.points).toHaveLength(12);
    expect(prep.points[0].y).toBe(6450 + 4100 + 3090 + 1650);
    expect(prep.hasTemp && prep.hasPromo).toBe(true);
  });
  it("round-trips through CSV export", () => {
    const res = ingestText(fx("sample_sales.csv"));
    const again = ingestText(rowsToCsv(res.rows));
    expect(again.rows).toEqual(res.rows);
  });
});

describe("professor stress tests at ingestion level (9 to 15)", () => {
  it("9: daily data for 400 days is aggregated to monthly", () => {
    const res = ingestText(fx("daily_400_days.csv"));
    expect(res.ok).toBe(true);
    expect(res.frequency).toBe("daily");
    expect(res.rows.length).toBe(14);
    expect(res.notices.some((n) => n.code === "aggregated")).toBe(true);
    expect(res.notices.some((n) => n.code === "partial-month")).toBe(true);
    expect(res.mapping.temp).not.toBeNull();
    expect(res.mapping.promo).not.toBeNull();
  });

  it("10: two-column date,sales CSV becomes a single 'All Markets' series", () => {
    const res = ingestText(fx("date_sales_only.csv"));
    expect(res.ok).toBe(true);
    expect(res.mappingConfident).toBe(true);
    expect(res.rows).toHaveLength(12);
    expect(res.rows.every((r) => r.region === DEFAULT_REGION && r.temp === null && r.promo === null)).toBe(true);
    const prep = preprocess(res.rows, { scope: null, fillGaps: true });
    expect(prep.hasTemp).toBe(false);
    expect(prep.hasPromo).toBe(false);
  });

  it("11a: wide format with regions as columns is melted", () => {
    const res = ingestText(fx("wide_regions_as_columns.csv"));
    expect(res.ok).toBe(true);
    expect(res.layout).toBe("wide-regions-as-columns");
    expect(res.rows).toHaveLength(48);
    expect(new Set(res.rows.map((r) => r.region))).toEqual(new Set(["Dubai", "Abu Dhabi", "Sharjah", "Al Ain"]));
    expect(res.rows.find((r) => r.region === "Al Ain" && r.period === "2026-10")?.units).toBe(13290);
  });

  it("11b: wide format with periods as columns is melted", () => {
    const res = ingestText(fx("wide_periods_as_columns.csv"));
    expect(res.ok).toBe(true);
    expect(res.layout).toBe("wide-periods-as-columns");
    expect(res.rows).toHaveLength(24);
    expect(res.rows.find((r) => r.region === "Abu Dhabi" && r.period === "2026-07")?.units).toBe(42600);
  });

  it("12: unsorted rows and duplicate period/region rows are sorted and summed with warnings", () => {
    const res = ingestText(fx("unsorted_duplicates.csv"));
    expect(res.ok).toBe(true);
    expect(res.notices.some((n) => n.code === "unsorted")).toBe(true);
    expect(res.notices.some((n) => n.code === "duplicates")).toBe(true);
    expect(res.rows).toHaveLength(12);
    expect(res.rows.map((r) => r.period)).toEqual([...res.rows.map((r) => r.period)].sort());
    expect(res.rows.find((r) => r.period === "2026-02")?.units).toBe(18810);
    const prep = preprocess(res.rows, { scope: null, fillGaps: true });
    const health = buildHealthChecks(prep, { ingestNotices: res.notices, rejected: res.rejected, fillGaps: true });
    expect(health.find((h) => h.id === "duplicates")?.status).toBe("warn");
    expect(health.find((h) => h.id === "sorted")?.status).toBe("warn");
  });

  it("13: Jan-25, 01/03/2026 and Excel serial dates", () => {
    const a = ingestText(fx("dates_mon_yy.csv"));
    expect(a.rows.map((r) => r.period)).toEqual(["2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06"]);
    const b = ingestText(fx("dates_dd_mm_yyyy.csv"));
    expect(b.rows.map((r) => r.period)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    expect(b.notices.some((n) => n.code === "dates" && n.message.includes("DD/MM"))).toBe(true);
    const c = ingestText(fx("dates_mm_dd_yyyy.csv"));
    expect(c.rows.map((r) => r.period)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    const d = ingestText(fx("dates_excel_serial.csv"));
    expect(d.rows.map((r) => r.period)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    // Numeric cells straight from a workbook
    const e = ingestTable([["date", "units"], [46082, 1000], [46113, 1100], [46143, 1250], [46174, 1400]]);
    expect(e.rows.map((r) => r.period)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06"]);
  });

  it("14: values with commas and AED prefixes", () => {
    const res = ingestText(fx("currency_commas.csv"));
    expect(res.ok).toBe(true);
    expect(res.rows.map((r) => r.units)).toEqual([12700, 18810, 30840, 36490.5, 46460, 61090]);
  });

  it("15: a negative value is rejected and the message names the row", () => {
    const res = ingestText(fx("negative_value.csv"));
    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(5);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].line).toBe(4);
    expect(res.notices.some((n) => n.level === "error" && n.message.startsWith("Line 4:") && n.message.includes("-500"))).toBe(true);
  });
});

describe("ingestion edge cases", () => {
  it("pasted tab-separated data from Excel", () => {
    const text = "Month\tSales\nNov 2025\t15,290\nDec 2025\t22,530\nJan 2026\t30,480\nFeb 2026\t45,650";
    const res = ingestText(text);
    expect(res.ok).toBe(true);
    expect(res.rows.map((r) => r.units)).toEqual([15290, 22530, 30480, 45650]);
  });
  it("blank units become missing and are interpolated with a flag", () => {
    const res = ingestText(fx("blank_value.csv"));
    expect(res.rows.find((r) => r.period === "2026-03")?.units).toBeNull();
    const prep = preprocess(res.rows, { scope: null, fillGaps: true });
    const mar = prep.points.find((p) => p.period === "2026-03");
    expect(mar?.interpolated).toBe(true);
    expect(mar?.y).toBeCloseTo((18810 + 36490) / 2, 6);
    const open = preprocess(res.rows, { scope: null, fillGaps: false });
    expect(open.points.find((p) => p.period === "2026-03")).toBeUndefined();
  });
  it("unknown headers trigger the mapping dialog instead of failing silently", () => {
    const res = ingestText("when,what,how much,extra\n2026-01,a,10,1\n2026-02,a,20,2\n2026-03,a,30,3");
    expect(res.mappingConfident).toBe(false);
  });
  it("an empty file returns a readable error", () => {
    const res = ingestText("");
    expect(res.ok).toBe(false);
    expect(res.notices[0].message).toMatch(/empty/i);
  });
  it("robust z flags a 3x spike on the sample series", () => {
    const res = ingestText(fx("sample_sales.csv"));
    const prep = preprocess(res.rows, { scope: null, fillGaps: true });
    const ys = prep.points.map((p) => p.y);
    ys[2] = ys[2] * 3;
    const z = robustZScores(ys);
    const flagged = z.map((v, i) => (v !== null && Math.abs(v) > 3.5 ? i : -1)).filter((i) => i >= 0);
    expect(flagged).toContain(2);
    const clean = robustZScores(prep.points.map((p) => p.y));
    expect(clean.every((v) => v !== null && Math.abs(v) <= 3.5)).toBe(true);
  });
  it("region filter keeps a single region", () => {
    const res = ingestText(fx("sample_sales.csv"));
    const prep = preprocess(res.rows, { scope: ["Al Ain"], fillGaps: true });
    expect(prep.scopeRegions).toEqual(["Al Ain"]);
    expect(prep.points[0].y).toBe(1650);
  });
});
