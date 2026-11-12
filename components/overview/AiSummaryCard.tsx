"use client";

import { ArrowRight, Bot, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppStore } from "@/lib/store/useAppStore";
import { useInterpretationView } from "@/lib/store/useAiAnalyst";
import { GroundingBadge, GroundedText } from "@/components/ai-analyst/GroundingBadge";
import { PanelErrorBoundary } from "@/components/shared/PanelErrorBoundary";

export function AiSummaryCard() {
  const { snapshot, response, stale, loading } = useInterpretationView();
  const setTab = useAppStore((s) => s.setActiveTab);
  const provider = useAppStore((s) => s.provider);
  const interp = response?.interpretation;

  return (
    <Card className="gap-3 border-brand/25 bg-gradient-to-br from-brand-soft/70 to-card shadow-sm">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-[15px] font-semibold">
          <Sparkles className="size-4 text-brand" aria-hidden />
          AI executive summary
        </CardTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          {loading ? (
            <Badge variant="secondary">
              <Loader2 className="size-3 animate-spin" aria-hidden />
              Generating
            </Badge>
          ) : null}
          {response ? <Badge variant={response.source === "llm" ? "default" : "secondary"} className="h-auto max-w-full whitespace-normal">{response.source === "llm" ? `${response.provider}/${response.model}` : "Rule-based analysis"}</Badge> : null}
          {stale ? <Badge variant="outline" className="border-warning text-warning">Stale - data changed</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <PanelErrorBoundary name="AI summary">
          {interp && snapshot ? (
            <>
              <p className="text-[14px] leading-relaxed">
                <GroundedText text={interp.executive_summary} payload={snapshot} />
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <GroundingBadge interpretation={interp} payload={snapshot} />
                <Button size="sm" variant="outline" onClick={() => setTab("ai-analyst")}>
                  <Bot className="size-3.5" aria-hidden />
                  Full AI analysis
                  <ArrowRight className="size-3.5" aria-hidden />
                </Button>
              </div>
            </>
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {provider?.configured ? `Asking ${provider.provider} to interpret the live results...` : "Preparing the analysis of the live results..."}
            </p>
          )}
        </PanelErrorBoundary>
      </CardContent>
    </Card>
  );
}
