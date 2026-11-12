"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import type { Data, Layout, Shape, Annotation as Annotations } from "plotly.js";
import { PlotlyChart } from "@/components/shared/PlotlyChart";
import type { EngineResult } from "@/lib/forecast";
import { chartTheme, MODEL_COLORS } from "@/lib/insights/palette";
import { px, midAfter, midBefore } from "@/lib/insights/chartUtils";

export function HeroForecastChart({ res, height = 400 }: { res: EngineResult; height?: number }) {
  const { resolvedTheme } = useTheme();
  const t = chartTheme(resolvedTheme === "dark");

  const { data, layout } = useMemo(() => {
    const pts = res.points;
    const sel = res.models.find((m) => m.id === res.selectedId);
    const last = pts[pts.length - 1];
    const fc = res.forecast;
    const traces: Data[] = [];

    if (fc.length && last) {
      const xs = [px(last.period), ...fc.map((f) => px(f.period))];
      const band = (lo: number[], hi: number[], color: string, name: string): Data => ({
        type: "scatter",
        mode: "lines",
        x: [...xs, ...[...xs].reverse()],
        y: [...hi, ...[...lo].reverse()],
        fill: "toself",
        fillcolor: color,
        line: { width: 0 },
        hoverinfo: "skip",
        name,
        legendgroup: name,
      });
      traces.push(band([last.y, ...fc.map((f) => f.lower95)], [last.y, ...fc.map((f) => f.upper95)], t.band95, "95% interval"));
      traces.push(band([last.y, ...fc.map((f) => f.lower80)], [last.y, ...fc.map((f) => f.upper80)], t.band80, "80% interval"));
    }

    traces.push({
      type: "scatter",
      mode: "lines+markers",
      name: "Actual units",
      x: pts.map((p) => px(p.period)),
      y: pts.map((p) => p.y),
      line: { color: t.actual, width: 2.4 },
      marker: {
        size: pts.map((p) => (p.interpolated ? 9 : 6)),
        color: pts.map((p) => (p.interpolated ? "rgba(0,0,0,0)" : t.actual)),
        line: { color: t.actual, width: 2 },
      },
      customdata: pts.map((p) => [p.interpolated ? " (interpolated)" : "", p.temp ?? "n/a", p.promo === 1 ? "yes" : p.promo === 0 ? "no" : "n/a"]),
      hovertemplate: "Actual: %{y:,.0f} units%{customdata[0]}<br>Temp %{customdata[1]} °C, promo %{customdata[2]}<extra></extra>",
    });

    const outliers = pts.filter((p) => p.outlier);
    if (outliers.length) {
      traces.push({
        type: "scatter",
        mode: "markers",
        name: "Outlier (|robust z| > 3.5)",
        x: outliers.map((p) => px(p.period)),
        y: outliers.map((p) => p.y),
        marker: { symbol: "x-thin-open", size: 16, color: t.outlier, line: { width: 3, color: t.outlier } },
        customdata: outliers.map((p) => (p.robustZ ?? 0).toFixed(1)),
        hovertemplate: "Outlier flagged (z = %{customdata}). Kept in the data.<extra></extra>",
      });
    }

    if (sel?.holdout) {
      const trainLast = pts[pts.length - sel.holdout.predicted.length - 1];
      traces.push({
        type: "scatter",
        mode: "lines+markers",
        name: `${sel.shortName} on hold-out`,
        x: [...(trainLast ? [px(trainLast.period)] : []), ...sel.holdout.periods.map(px)],
        y: [...(trainLast ? [trainLast.y] : []), ...sel.holdout.predicted],
        line: { color: MODEL_COLORS[sel.id], width: 2, dash: "dot" },
        marker: { size: 6, symbol: "diamond" },
        hovertemplate: `${sel.shortName} hold-out: %{y:,.0f} units<extra></extra>`,
      });
    }

    if (fc.length && last) {
      traces.push({
        type: "scatter",
        mode: "lines+markers",
        name: `Forecast (${sel?.shortName ?? "model"})`,
        x: [px(last.period), ...fc.map((f) => px(f.period))],
        y: [last.y, ...fc.map((f) => f.forecast)],
        line: { color: t.forecast, width: 2.6, dash: "dash" },
        marker: { size: [0, ...fc.map(() => 7)], color: t.forecast },
        customdata: [[0, 0, 0], ...fc.map((f) => [f.lower, f.upper, f.recommended])],
        hovertemplate: "Forecast: %{y:,.0f} units<br>%{customdata[0]:,.0f} to %{customdata[1]:,.0f} (" + res.settings.confidence + "%)<br>Produce %{customdata[2]:,.0f}<extra></extra>",
      });
    }

    const shapes: Partial<Shape>[] = [];
    const annotations: Partial<Annotations>[] = [];
    const train = res.split.trainPeriods;
    const test = res.split.testPeriods;
    if (train.length && test.length) {
      shapes.push({ type: "rect", xref: "x", yref: "paper", x0: midBefore(train[0]), x1: midBefore(test[0]), y0: 0, y1: 1, fillcolor: t.train, line: { width: 0 }, layer: "below" });
      shapes.push({ type: "rect", xref: "x", yref: "paper", x0: midBefore(test[0]), x1: midAfter(test[test.length - 1]), y0: 0, y1: 1, fillcolor: t.test, line: { width: 0 }, layer: "below" });
      annotations.push({ x: midBefore(train[0]), y: 1, xref: "x", yref: "paper", text: "Train", showarrow: false, xanchor: "left", yanchor: "top", font: { size: 11, color: t.muted } });
      annotations.push({ x: midBefore(test[0]), y: 1, xref: "x", yref: "paper", text: "Test", showarrow: false, xanchor: "left", yanchor: "top", font: { size: 11, color: t.muted } });
    }
    if (last) {
      shapes.push({ type: "line", xref: "x", yref: "paper", x0: px(last.period), x1: px(last.period), y0: 0, y1: 1, line: { color: t.muted, width: 1.2, dash: "dot" } });
      annotations.push({ x: px(last.period), y: 0, xref: "x", yref: "paper", text: "Today", showarrow: false, xanchor: "left", yanchor: "bottom", xshift: 4, yshift: 4, font: { size: 11, color: t.text } });
      if (fc.length) annotations.push({ x: px(fc[fc.length - 1].period), y: 1, xref: "x", yref: "paper", text: "Forecast", showarrow: false, xanchor: "right", yanchor: "top", font: { size: 11, color: t.forecast } });
    }

    const lay: Partial<Layout> = {
      xaxis: { type: "date", title: { text: "Month" }, tickformat: "%b %Y", hoverformat: "%B %Y" },
      yaxis: { title: { text: "Units sold" }, rangemode: "tozero", tickformat: ",.0f" },
      shapes,
      annotations,
    };
    return { data: traces, layout: lay };
  }, [res, t]);

  return <PlotlyChart data={data} layout={layout} height={height} filename="bevcast_forecast_chart" ariaLabel="Monthly units sold with hold-out predictions and the future forecast with 80% and 95% intervals" />;
}
