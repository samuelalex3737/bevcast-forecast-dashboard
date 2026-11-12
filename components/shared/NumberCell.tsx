"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isNum, NA } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

interface Props {
  value: number | null | undefined;
  format: (v: number) => string;
  /** explanation shown when the value is not available */
  naReason?: string;
  className?: string;
}

/** Renders a formatted number, or "n/a" with a tooltip saying why. Never renders NaN/Infinity. */
export function NumberCell({ value, format, naReason = "Not available for this model or data", className }: Props) {
  if (isNum(value)) return <span className={cn("tabular", className)}>{format(value)}</span>;
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className={cn("cursor-help text-muted-foreground underline decoration-dotted underline-offset-2", className)} />}>{NA}</TooltipTrigger>
      <TooltipContent>{naReason}</TooltipContent>
    </Tooltip>
  );
}
