import type { ModelId } from "@/lib/forecast/types";

/** Colour-blind-safe palette (Okabe-Ito with Tol additions), fixed per model so colours never shuffle. */
export const MODEL_COLORS: Record<ModelId, string> = {
  naive: "#8c8c8c",
  drift: "#cc79a7",
  ma: "#e69f00",
  snaive: "#b8a000",
  holt: "#009e73",
  arima: "#d55e00",
  regression: "#0072b2",
  rf: "#56b4e9",
  gbm: "#a6761d",
  ensemble: "#7570b3",
};

export const REGION_COLORS = ["#0072b2", "#e69f00", "#009e73", "#cc79a7", "#56b4e9", "#d55e00", "#7570b3", "#a6761d", "#8c8c8c", "#b8a000"];

export interface ChartTheme {
  dark: boolean;
  text: string;
  muted: string;
  grid: string;
  actual: string;
  forecast: string;
  band80: string;
  band95: string;
  test: string;
  train: string;
  hoverBg: string;
  outlier: string;
}

export function chartTheme(dark: boolean): ChartTheme {
  return dark
    ? {
        dark,
        text: "#d5dbe3",
        muted: "#94a3b8",
        grid: "rgba(148,163,184,0.16)",
        actual: "#e8edf3",
        forecast: "#56b4e9",
        band80: "rgba(86,180,233,0.32)",
        band95: "rgba(86,180,233,0.16)",
        test: "rgba(230,159,0,0.10)",
        train: "rgba(148,163,184,0.06)",
        hoverBg: "#1f2733",
        outlier: "#ff8c69",
      }
    : {
        dark,
        text: "#334155",
        muted: "#64748b",
        grid: "rgba(100,116,139,0.16)",
        actual: "#1e293b",
        forecast: "#0072b2",
        band80: "rgba(0,114,178,0.24)",
        band95: "rgba(0,114,178,0.11)",
        test: "rgba(230,159,0,0.10)",
        train: "rgba(100,116,139,0.05)",
        hoverBg: "#ffffff",
        outlier: "#d55e00",
      };
}
