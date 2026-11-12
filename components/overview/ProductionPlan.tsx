"use client";

import { useMemo } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import type { Data } from "plotly.js";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/shared/Panel";
import { PlotlyChart } from "@/components/shared/PlotlyChart";
import { NumberCell } from "@/components/shared/NumberCell";
import type { EngineResult } from "@/lib/forecast";
import type { Captions } from "@/lib/insights/captions";
import { REGION_COLORS } from "@/lib/insights/palette";
import { formatPeriod } from "@/lib/data/parseDates";
import { fmtInt, fmtNum } from "@/lib/utils/format";
import { downloadText, forecastCsv, regionSlug, yyyymmdd } from "@/lib/utils/download";

export function ProductionPlan({ res, captions }: { res: EngineResult; captions: Captions }) {
  const sel = res.models.find((m) => m.id === res.selectedId);
  const f = res.forecast;
  const total = (k: "forecast" | "safetyStock" | "recommended") => f.reduce((a, r) => a + r[k], 0);

  const chart = useMemo(() => {
    if (!res.regional) return null;
    const r = res.regional;
    const data: Data[] = r.regions.map((region, i) => ({
      type: "bar",
      name: region,
      x: r.rows.map((row) => formatPeriod(row.period)),
      y: r.rows.map((row) => row.values[i]),
      marker: { color: REGION_COLORS[i % REGION_COLORS.length] },
      customdata: r.rows.map((row) => [row.recommended[i], (r.shares[i] * 100).toFixed(1)]),
      hovertemplate: `${region}: %{y:,.0f} units (%{customdata[1]}%)<br>Ship %{customdata[0]:,.0f} incl. safety stock<extra></extra>`,
    }));
    return data;
  }, [res.regional]);

  const download = () => {
    const ok = downloadText(`bevcast_forecast_${regionSlug(res)}_${yyyymmdd()}.csv`, forecastCsv(res));
    if (ok) toast.success("Forecast and production plan downloaded");
    else toast.error("Download failed in this browser");
  };

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <Panel
        className="xl:col-span-3"
        title="Production plan"
        description={`${sel?.name ?? "Selected model"} forecast, ${res.settings.confidence}% interval and safety stock for a ${res.settings.serviceLevel}% service level`}
        caption={captions.plan}
        action={
          <Button size="sm" variant="outline" onClick={download} disabled={!f.length}>
            <Download className="size-3.5" aria-hidden />
            CSV
          </Button>
        }
      >
        <div className="overflow-x-auto">
          <Table className="tabular text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Forecast</TableHead>
                <TableHead className="text-right">{res.settings.confidence}% range</TableHead>
                <TableHead className="text-right">Safety stock</TableHead>
                <TableHead className="text-right">Produce</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Temp / promo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {f.map((r) => (
                <TableRow key={r.period}>
                  <TableCell className="font-medium whitespace-nowrap">{formatPeriod(r.period)}</TableCell>
                  <TableCell className="text-right"><NumberCell value={r.forecast} format={fmtInt} /></TableCell>
                  <TableCell className="text-right whitespace-nowrap text-muted-foreground">{fmtInt(r.lower)} to {fmtInt(r.upper)}</TableCell>
                  <TableCell className="text-right"><NumberCell value={r.safetyStock} format={fmtInt} /></TableCell>
                  <TableCell className="text-right font-semibold text-brand">{fmtInt(r.recommended)}</TableCell>
                  <TableCell className="hidden text-right whitespace-nowrap sm:table-cell">
                    {r.temp !== null ? `${fmtNum(r.temp, 1)} °C` : "no temp"}
                    {r.promo === 1 ? <Badge variant="secondary" className="ml-1.5">promo</Badge> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {f.length > 1 ? (
              <TableFooter>
                <TableRow>
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{fmtInt(total("forecast"))}</TableCell>
                  <TableCell />
                  <TableCell className="text-right">{fmtInt(total("safetyStock"))}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtInt(total("recommended"))}</TableCell>
                  <TableCell className="hidden sm:table-cell" />
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </div>
      </Panel>
      <Panel className="xl:col-span-2" title="Regional allocation" description={res.regional ? `Forecast split by ${res.regional.basis}` : "Distribution by market"} caption={captions.regional}>
        {chart ? (
          <PlotlyChart
            data={chart}
            height={300}
            filename="bevcast_regional_allocation"
            ariaLabel="Stacked bar chart of forecast units by region for each future month"
            layout={{ barmode: "stack", xaxis: { type: "category", title: { text: "Forecast month" } }, yaxis: { title: { text: "Units" }, tickformat: ",.0f" }, hovermode: "x unified", margin: { l: 64, r: 16, t: 8, b: 56 } }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No allocation available.</p>
        )}
      </Panel>
    </div>
  );
}
