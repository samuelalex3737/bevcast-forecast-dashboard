import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PanelErrorBoundary } from "./PanelErrorBoundary";
import { InsightCaption } from "./InsightCaption";
import { cn } from "@/lib/utils";

interface PanelProps {
  title: string;
  description?: string;
  caption?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}

/** Card + error boundary + insight caption: the building block of every dashboard panel. */
export function Panel({ title, description, caption, action, children, className, id }: PanelProps) {
  return (
    <Card id={id} className={cn("scroll-mt-28 gap-3 shadow-sm", className)}>
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-[15px] font-semibold tracking-tight">{title}</CardTitle>
          {description ? <CardDescription className="text-[13px]">{description}</CardDescription> : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <PanelErrorBoundary name={title}>{children}</PanelErrorBoundary>
        {caption ? <InsightCaption text={caption} /> : null}
      </CardContent>
    </Card>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children ? <div className="max-w-md text-[13px] text-muted-foreground">{children}</div> : null}
    </div>
  );
}
