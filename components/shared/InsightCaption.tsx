import { Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

/** Deterministic, data-driven 1-2 sentence insight shown under every chart. */
export function InsightCaption({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn("flex gap-2 rounded-lg bg-brand-soft/60 px-3 py-2 text-[13px] leading-relaxed text-foreground/90", className)} aria-live="polite">
      <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
      <span>
        <span className="sr-only">Insight: </span>
        {text}
      </span>
    </p>
  );
}
