"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import type { Data } from "plotly.js";
import { Panel, EmptyState } from "@/components/shared/Panel";
import { PlotlyChart } from "@/components/shared/PlotlyChart";
import type { EngineResult } from "@/lib/forecast";
import type { Captions } from "@/lib/insights/captions";
import { chartTheme, REGION_COLORS } from "@/lib/insights/palette";
import { px } from "@/lib/insights/chartUtils";
import { lineFit } from "@/lib/forecast/linalg";
import { formatPeriod } from "@/lib/data/parseDates";
import { fmtNum } from "@/lib/utils/format";

export function DriverCharts({ res, captions }: { res: EngineResult; captions: Captions }) {
  const { resolvedTheme } = useTheme();
  const t = chartTheme(resolvedTheme === "dark");
  const pts = res.points;

  const dual = useMemo<Data[]>(() => {
    const d: Data[] = [
      {
        type: "bar",
        name: "Units sold",
        x: pts.map((p) => px(p.period)),
        y: pts.map((p) => p.y),
        marker: { color: pts.map((p) => (p.promo === 1 ? "#e69f00" : t.forecast)), line: { color: pts.map((p) => (p.interpolated ? t.actual : "rgba(0,0,0,0)")), width: 1.5 } },
        customdata: pts.map((p) => (p.promo === 1 ? "promo month" : "no promo")),
        hovertemplate: "Units: %{y:,.0f} (%{customdata})<extra></extra>",
      },
    ];
    if (res.hasTemp) {
      d.push({
        type: "scatter",
        mode: "lines+markers",
        name: "Avg temperature (°C)",
        x: pts.map((p) => px(p.period)),
        y: pts.map((p) => p.temp),
        yaxis: "y2",
        line: { color: "#d55e00", width: 2.5 },
        marker: { size: 6 },
        hovertemplate: "Temp: %{y:.1f} °C<extra></extra>",
      });
    }
    return d;
  }, [pts, res.hasTemp, t]);

  const scatter = useMemo<Data[]>(() => {
    if (!res.hasTemp) return [];
    const xs = pts.map((p) => p.temp ?? 0);
    const ys = pts.map((p) => p.y);
    const fit = lineFit(xs, ys);
    const d: Data[] = [
      {
        type: "scatter",
        mode: "markers",
        name: "Month",
        x: xs,
        y: ys,
        text: pts.map((p) => formatPeriod(p.period)),
        marker: { size: 10, color: pts.map((p) => (p.promo === 1 ? "#e69f00" : t.forecast)), line: { width: 1, color: t.actual }, opacity: 0.9 },
        hovertemplate: "%{text}: %{x:.1f} °C, %{y:,.0f} units<extra></extra>",
      },
    ];
    if (fit) {
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
      d.push({ type: "scatter", mode: "lines", name: `Fitted line (r = ${fmtNum(res.summary.tempSalesR, 2)})`, x: [lo, hi], y: [fit.a + fit.b * lo, fit.a + fit.b * hi], line: { color: t.muted, dash: "dash", width: 2 }, hovertemplate: `Slope: ${fmtNum(fit.b, 0)} units per °C<extra></extra>` });
    }
    return d;
  }, [pts, res.hasTemp, res.summary.tempSalesR, t]);

  const growth = useMemo<Data[]>(() => {
    const g = res.summary.momGrowth.slice(1);
    return [
      {
        type: "bar",
        name: "MoM growth",
        x: g.map((v) => px(v.period)),
        y: g.map((v) => v.pct),
        marker: { color: g.map((v) => ((v.pct ?? 0) >= 0 ? "#009e73" : "#d55e00")) },
        hovertemplate: "MoM: %{y:+.1f}%<extra></extra>",
      },
    ];
  }, [res.summary.momGrowth]);

  const donut = useMemo<Data[]>(() => {
    const totals = res.scopeRegions.map((r) => (res.regionMatrix[r] ?? []).reduce((a, b) => a + b, 0));
    return [
      {
        type: "pie",
        hole: 0.55,
        labels: res.scopeRegions,
        values: totals,
        marker: { colors: res.scopeRegions.map((_, i) => REGION_COLORS[i % REGION_COLORS.length]), line: { color: t.dark ? "#1f2733" : "#ffffff", width: 2 } },
        textinfo: "percent",
        hovertemplate: "%{label}: %{value:,.0f} units (%{percent})<extra></extra>",
        sort: false,
      },
    ];
  }, [res.scopeRegions, res.regionMatrix, t]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Sales vs temperature" description="Monthly units (bars, orange = promo month) against average temperature" caption={captions.dualAxis}>
        <PlotlyChart
          data={dual}
          height={320}
          filename="bevcast_sales_vs_temperature"
          ariaLabel="Dual-axis chart of monthly units and average temperature"
          layout={{
            xaxis: { type: "date", title: { text: "Month" }, tickformat: "%b %Y", hoverformat: "%B %Y" },
            yaxis: { title: { text: "Units sold" }, tickformat: ",.0f" },
            ...(res.hasTemp ? { yaxis2: { title: { text: "Temperature (°C)" }, overlaying: "y", side: "right" as const, ticksuffix: "°" } } : {}),
            margin: { l: 64, r: 56, t: 8, b: 56 },
          }}
        />
      </Panel>
      <Panel title="Temperature vs sales" description="Each point is a month; dashed line is the least-squares fit" caption={captions.scatter}>
        {res.hasTemp ? (
          <PlotlyChart data={scatter} height={320} filename="bevcast_temperature_scatter" ariaLabel="Scatter plot of temperature against units sold with a fitted line" layout={{ hovermode: "closest", xaxis: { title: { text: "Average temperature (°C)" } }, yaxis: { title: { text: "Units sold" }, tickformat: ",.0f" } }} />
        ) : (
          <EmptyState title="No temperature column">Upload data with a temperature column to see the relationship.</EmptyState>
        )}
      </Panel>
      <Panel title="Month-on-month growth" description="Percentage change versus the previous month" caption={captions.momGrowth}>
        <PlotlyChart data={growth} height={300} filename="bevcast_mom_growth" ariaLabel="Bar chart of month-on-month growth" showLegend={false} layout={{ xaxis: { type: "date", title: { text: "Month" }, tickformat: "%b %Y", hoverformat: "%B %Y" }, yaxis: { title: { text: "Growth vs previous month (%)" }, ticksuffix: "%" } }} />
      </Panel>
      <Panel title="Regional share" description="Share of all units sold in scope" caption={captions.regionShare}>
        <PlotlyChart data={donut} height={300} filename="bevcast_regional_share" ariaLabel="Donut chart of the share of units by region" layout={{ hovermode: "closest", legend: { orientation: "v", x: 1, y: 0.5, xanchor: "left", yanchor: "middle" }, margin: { l: 16, r: 16, t: 8, b: 8 } }} />
      </Panel>
    </div>
  );
}
