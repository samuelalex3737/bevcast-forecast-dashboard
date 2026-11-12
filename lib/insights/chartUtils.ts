import { addMonths } from "@/lib/data/parseDates";

/** Plotly date-axis value for a YYYY-MM period (first of the month). */
export const px = (period: string) => `${period}-01`;

/** Date half a month before the period, used for region boundaries between bars/points. */
export function midBefore(period: string): string {
  const prev = addMonths(period, -1);
  return `${prev}-16`;
}

export function midAfter(period: string): string {
  return `${period}-16`;
}

export const UNITS_HOVER = "%{y:,.0f} units";
