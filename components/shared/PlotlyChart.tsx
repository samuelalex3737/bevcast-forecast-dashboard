"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import type { Data, Layout, Config } from "plotly.js";
import { chartTheme } from "@/lib/insights/palette";

/**
 * Plotly's basic bundle (scatter, bar, pie) covers every chart in the app at about a third of the
 * full bundle's size. It is loaded on demand, client-side only.
 */
const Plot = dynamic(
  async () => {
    const [{ default: Plotly }, { default: createPlotlyComponent }] = await Promise.all([import("plotly.js-basic-dist-min"), import("react-plotly.js/factory")]);
    return createPlotlyComponent(Plotly);
  },
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-muted/60" aria-hidden />,
  },
);

export interface PlotlyChartProps {
  data: Data[];
  layout?: Partial<Layout>;
  height?: number;
  /** used for the PNG export filename */
  filename: string;
  ariaLabel: string;
  showLegend?: boolean;
}

/** Mounts the chart only once its container is near the viewport (keeps first load light). */
function useNearViewport<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || window.matchMedia?.("print").matches) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    const onPrint = () => setVisible(true);
    window.addEventListener("beforeprint", onPrint);
    return () => {
      io.disconnect();
      window.removeEventListener("beforeprint", onPrint);
    };
  }, [visible]);
  return [ref, visible];
}

export function PlotlyChart({ data, layout, height = 360, filename, ariaLabel, showLegend = true }: PlotlyChartProps) {
  const { resolvedTheme } = useTheme();
  const t = chartTheme(resolvedTheme === "dark");
  const [ref, visible] = useNearViewport<HTMLElement>();

  const mergedLayout = useMemo<Partial<Layout>>(() => {
    const base: Partial<Layout> = {
      autosize: true,
      height,
      margin: { l: 64, r: 24, t: 16, b: 56 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: "Inter, ui-sans-serif, system-ui, sans-serif", size: 12, color: t.text },
      hoverlabel: { bgcolor: t.hoverBg, bordercolor: t.grid, font: { color: t.text, size: 12 } },
      hovermode: "x unified",
      showlegend: showLegend,
      legend: { orientation: "h", x: 0, y: -0.22, xanchor: "left", yanchor: "top", font: { size: 11, color: t.text }, bgcolor: "rgba(0,0,0,0)" },
      ...layout,
    };
    const axis = (a: Partial<Layout["xaxis"]> | undefined): Partial<Layout["xaxis"]> => ({
      gridcolor: t.grid,
      zerolinecolor: t.grid,
      linecolor: t.grid,
      tickfont: { color: t.muted, size: 11 },
      automargin: true,
      ...a,
      title: typeof a?.title === "object" ? { ...a.title, font: { color: t.muted, size: 12, ...(a.title.font ?? {}) } } : a?.title,
    });
    return {
      ...base,
      xaxis: axis(layout?.xaxis),
      yaxis: axis(layout?.yaxis),
      ...(layout?.yaxis2 ? { yaxis2: { ...axis(layout.yaxis2), gridcolor: "rgba(0,0,0,0)" } } : {}),
    } as Partial<Layout>;
  }, [layout, height, t, showLegend]);

  const config = useMemo<Partial<Config>>(
    () => ({
      displaylogo: false,
      responsive: true,
      displayModeBar: "hover",
      modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
      toImageButtonOptions: { format: "png", filename, scale: 2, height: Math.max(height, 420), width: 1100 },
    }),
    [filename, height],
  );

  return (
    <figure ref={ref} role="img" aria-label={ariaLabel} className="w-full" style={{ minHeight: height }}>
      {visible ? <Plot data={data} layout={mergedLayout} config={config} useResizeHandler style={{ width: "100%", height }} /> : <div className="w-full rounded-lg bg-muted/40" style={{ height }} aria-hidden />}
    </figure>
  );
}
