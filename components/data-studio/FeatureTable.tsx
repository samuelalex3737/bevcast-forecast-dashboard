"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EngineResult } from "@/lib/forecast";
import { FEATURE_DESCRIPTIONS } from "@/lib/forecast/features";
import { formatPeriod } from "@/lib/data/parseDates";
import { fmtInt, fmtNum, isNum } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

const LEVEL = new Set(["lag_1", "lag_2", "roll_mean_3"]);
const INT = new Set(["quarter", "trend_t", "promo", "promo_delta"]);

export function FeatureTable({ res }: { res: EngineResult }) {
  const names = res.features.names;
  const fmt = (name: string, v: number | null) => {
    if (!isNum(v)) return "";
    if (LEVEL.has(name)) return fmtInt(v);
    if (INT.has(name)) return String(Math.round(v));
    if (name === "temp" || name === "temp_delta") return fmtNum(v, 1);
    return fmtNum(v, 3);
  };
  return (
    <div className="max-h-[420px] overflow-auto rounded-lg border">
      <Table className="tabular text-[12px]">
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <TableHead className="sticky left-0 z-20 bg-card">Month</TableHead>
            <TableHead className="text-right">units</TableHead>
            {names.map((n) => (
              <TableHead key={n} className="text-right whitespace-nowrap">
                <Tooltip>
                  <TooltipTrigger render={<span tabIndex={0} className="cursor-help font-mono underline decoration-dotted underline-offset-2" />}>{n}</TooltipTrigger>
                  <TooltipContent>{FEATURE_DESCRIPTIONS[n]}</TooltipContent>
                </Tooltip>
              </TableHead>
            ))}
            <TableHead className="text-right whitespace-nowrap">
              <Tooltip>
                <TooltipTrigger render={<span tabIndex={0} className="cursor-help font-mono underline decoration-dotted underline-offset-2" />}>target_growth</TooltipTrigger>
                <TooltipContent>Tree-model target: ln(y[t]+1) - ln(y[t-1]+1)</TooltipContent>
              </Tooltip>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {res.features.rows.map((r) => (
            <TableRow key={r.period} className={cn(!r.usable && "text-muted-foreground/70")}>
              <TableCell className="sticky left-0 bg-card font-medium whitespace-nowrap">
                {formatPeriod(r.period)}
                {!r.usable ? <span className="ml-1.5 rounded bg-muted px-1 text-[10px]">lost to lags</span> : null}
              </TableCell>
              <TableCell className="text-right">{fmtInt(r.y)}</TableCell>
              {names.map((n) => (
                <TableCell key={n} className="text-right">
                  {fmt(n, r.values[n]) || <span className="text-muted-foreground/50">-</span>}
                </TableCell>
              ))}
              <TableCell className="text-right">{isNum(r.target_growth) ? fmtNum(r.target_growth, 3) : <span className="text-muted-foreground/50">-</span>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
