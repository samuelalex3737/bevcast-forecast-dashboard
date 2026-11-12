"use client";

import { useMemo } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { checkGrounding, interpretationTexts, segmentText } from "@/lib/llm/grounding";
import type { Interpretation } from "@/lib/llm/schema";
import { cn } from "@/lib/utils";

export function GroundingBadge({ interpretation, payload, className }: { interpretation: Interpretation; payload: unknown; className?: string }) {
  const report = useMemo(() => checkGrounding(interpretationTexts(interpretation), payload), [interpretation, payload]);
  const all = report.unverified.length === 0;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className={cn(
              "inline-flex cursor-help items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              all ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
              className,
            )}
          />
        }
      >
        {all ? <CheckCircle2 className="size-3.5" aria-hidden /> : <TriangleAlert className="size-3.5" aria-hidden />}
        {all ? `All ${report.total} figures verified against live data` : `${report.verified} of ${report.total} figures verified; ${report.unverified.length} not found in the data`}
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        {all
          ? "Every number in this interpretation was matched (within 1% or rounding) to a value in the JSON snapshot sent to the model."
          : `Not found in the payload: ${report.unverified.slice(0, 8).map((u) => u.text).join(", ")}. These are underlined in amber; treat them with caution.`}
      </TooltipContent>
    </Tooltip>
  );
}

/** Renders text with any figure that is not in the payload underlined in amber. */
export function GroundedText({ text, payload }: { text: string; payload: unknown }) {
  const segs = useMemo(() => segmentText(text, payload), [text, payload]);
  return (
    <>
      {segs.map((s, i) =>
        s.figure && !s.figure.verified ? (
          <Tooltip key={i}>
            <TooltipTrigger render={<span tabIndex={0} className="cursor-help underline decoration-warning decoration-2 underline-offset-2" />}>{s.text}</TooltipTrigger>
            <TooltipContent>This figure ({s.text}) was not found in the live data sent to the model.</TooltipContent>
          </Tooltip>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}
