"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NumberField } from "@/components/shared/Controls";
import { useAppStore } from "@/lib/store/useAppStore";
import type { EngineResult } from "@/lib/forecast";
import { formatPeriod } from "@/lib/data/parseDates";
import { fmtInt, fmtNum, fmtPct } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

export function ScenarioPlanner({ res }: { res: EngineResult }) {
  const setScenario = useAppStore((s) => s.setScenario);
  const resetScenario = useAppStore((s) => s.resetScenario);
  const overrides = useAppStore((s) => s.scenario);
  const hasOverrides = Object.keys(overrides).length > 0;
  const totalBase = res.forecast.reduce((a, f) => a + f.base, 0);
  const totalDelta = res.forecast.reduce((a, f) => a + f.delta, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">
          Defaults: temperature from the same calendar month in the history, promo on in December only. {!res.hasTemp ? "No temperature column in the data." : ""} {!res.hasPromo ? "No promo column in the data." : ""}
        </p>
        <Button size="sm" variant="outline" onClick={resetScenario} disabled={!hasOverrides}>
          <RotateCcw className="size-3.5" aria-hidden />
          Reset scenario
        </Button>
      </div>
      <div className="overflow-x-auto">
        <Table className="tabular text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead className="min-w-28">Temp (°C)</TableHead>
              <TableHead>Promo</TableHead>
              <TableHead className="text-right">Base case</TableHead>
              <TableHead className="text-right">Scenario</TableHead>
              <TableHead className="text-right">What-if delta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {res.forecast.map((f, i) => {
              const def = res.scenarioDefaults[i];
              const changedTemp = res.hasTemp && f.temp !== def?.temp;
              const changedPromo = res.hasPromo && f.promo !== def?.promo;
              return (
                <TableRow key={f.period}>
                  <TableCell className="font-medium whitespace-nowrap">{formatPeriod(f.period)}</TableCell>
                  <TableCell>
                    {res.hasTemp ? (
                      <div className="flex items-center gap-1.5">
                        <NumberField compact label={`Temperature for ${formatPeriod(f.period)}`} value={f.temp} min={-20} max={55} decimals={1} step={0.5} onCommit={(v) => setScenario(f.period, { temp: v })} className={cn("w-20", changedTemp && "[&_input]:border-brand")} />
                        {changedTemp ? <span className="text-[11px] text-muted-foreground">was {fmtNum(def?.temp, 1)}</span> : null}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">n/a</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {res.hasPromo ? (
                      <div className="flex items-center gap-2">
                        <Switch checked={f.promo === 1} onCheckedChange={(v) => setScenario(f.period, { promo: v ? 1 : 0 })} aria-label={`Promo in ${formatPeriod(f.period)}`} />
                        {changedPromo ? <span className="text-[11px] text-brand">edited</span> : null}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">n/a</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{fmtInt(f.base)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtInt(f.forecast)}</TableCell>
                  <TableCell className={cn("text-right font-medium", f.delta > 0.5 ? "text-success" : f.delta < -0.5 ? "text-danger" : "text-muted-foreground")}>
                    {f.delta >= 0 ? "+" : ""}
                    {fmtInt(f.delta)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3}>Total</TableCell>
              <TableCell className="text-right">{fmtInt(totalBase)}</TableCell>
              <TableCell className="text-right">{fmtInt(totalBase + totalDelta)}</TableCell>
              <TableCell className="text-right">
                {totalDelta >= 0 ? "+" : ""}
                {fmtInt(totalDelta)} ({fmtPct(totalBase > 0 ? (100 * totalDelta) / totalBase : null, 1, true)})
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <DriverModelWhatIf res={res} />
    </div>
  );
}

/** Scenario impact on every fitted driver-based model, whichever model is selected for the plan. */
function DriverModelWhatIf({ res }: { res: EngineResult }) {
  const drivers = res.models.filter((m) => (m.id === "regression" || m.id === "rf" || m.id === "gbm") && m.status === "ok" && m.forecast && m.baseForecast);
  if (!drivers.length || (!res.hasTemp && !res.hasPromo)) return null;
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="mb-2 text-[13px] font-medium">Scenario impact on driver-based models ({res.forecast.length}-month totals)</p>
      <div className="overflow-x-auto">
        <Table className="tabular text-[12.5px]">
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Base case</TableHead>
              <TableHead className="text-right">Your scenario</TableHead>
              <TableHead className="text-right">Delta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drivers.map((m) => {
              const base = (m.baseForecast ?? []).reduce((a, b) => a + b, 0);
              const scen = (m.forecast ?? []).reduce((a, b) => a + b, 0);
              const d = scen - base;
              return (
                <TableRow key={m.id}>
                  <TableCell className="font-medium whitespace-nowrap">
                    {m.shortName}
                    {m.id === res.selectedId ? <span className="ml-1.5 text-[11px] text-brand">(selected)</span> : null}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{fmtInt(base)}</TableCell>
                  <TableCell className="text-right">{fmtInt(scen)}</TableCell>
                  <TableCell className={cn("text-right font-medium", d > 0.5 ? "text-success" : d < -0.5 ? "text-danger" : "text-muted-foreground")}>
                    {d >= 0 ? "+" : ""}
                    {fmtInt(d)} ({fmtPct(base > 0 ? (100 * d) / base : null, 1, true)})
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
