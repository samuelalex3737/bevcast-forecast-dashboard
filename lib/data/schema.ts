import { z } from "zod";

/** A single raw cell coming from CSV, paste or Excel. */
export type Cell = string | number | boolean | null;

/** Canonical long-format row used everywhere in the app. */
export const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export const DataRowSchema = z.object({
  period: z.string().regex(PERIOD_REGEX, "Period must be YYYY-MM"),
  region: z.string().trim().min(1, "Region cannot be empty").max(80),
  units: z.number().finite().min(0, "Units cannot be negative").nullable(),
  temp: z.number().finite().min(-60).max(70).nullable(),
  promo: z.union([z.literal(0), z.literal(1)]).nullable(),
});
export type DataRow = z.infer<typeof DataRowSchema>;

export const DatasetSchema = z.array(DataRowSchema).max(20000);

export type CanonicalField = "period" | "target" | "region" | "temp" | "promo";

export interface ColumnMapping {
  period: number | null;
  target: number | null;
  region: number | null;
  temp: number | null;
  promo: number | null;
}

export type DataLayout = "long" | "wide-regions-as-columns" | "wide-periods-as-columns";
export type Frequency = "monthly" | "weekly" | "daily";

export type NoticeLevel = "info" | "warn" | "error";
export interface IngestNotice {
  level: NoticeLevel;
  code: string;
  message: string;
}

export interface RejectedRow {
  line: number;
  reason: string;
}

export interface IngestResult {
  ok: boolean;
  rows: DataRow[];
  notices: IngestNotice[];
  rejected: RejectedRow[];
  headers: string[];
  preview: string[][];
  mapping: ColumnMapping;
  mappingConfident: boolean;
  layout: DataLayout;
  frequency: Frequency;
  stats: {
    rawRows: number;
    acceptedRows: number;
    outputRows: number;
  };
}

export const DEFAULT_REGION = "All Markets";
