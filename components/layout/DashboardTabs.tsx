"use client";

import dynamic from "next/dynamic";
import { useEffect, type ReactNode } from "react";
import { BookOpen, Bot, Database, FlaskConical, LayoutDashboard, Swords, TriangleAlert } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Panel } from "@/components/shared/Panel";
import { useAppStore, type TabId } from "@/lib/store/useAppStore";
import { useResult } from "@/lib/store/useResult";
import type { EngineResult } from "@/lib/forecast";
import { KpiCards } from "@/components/overview/KpiCards";
import { HeroForecastChart } from "@/components/overview/HeroForecastChart";
import { AiSummaryCard } from "@/components/overview/AiSummaryCard";
import { ProductionPlan } from "@/components/overview/ProductionPlan";
import { Loading, Ready } from "./TabShell";
import { formatPeriod } from "@/lib/data/parseDates";

// Non-default tabs are code-split: their code (and KaTeX, the data grid, the chat) loads on first open.
const loading = () => <Loading label="Loading..." />;
const ForecastLabTab = dynamic(() => import("@/components/tabs/ForecastLabTab"), { loading });
const ModelArenaTab = dynamic(() => import("@/components/tabs/ModelArenaTab"), { loading });
const DataStudioTab = dynamic(() => import("@/components/tabs/DataStudioTab"), { loading });
const AiAnalystTab = dynamic(() => import("@/components/tabs/AiAnalystTab"), { loading });
const MethodologyTab = dynamic(() => import("@/components/tabs/MethodologyTab"), { loading });

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="size-4" aria-hidden /> },
  { id: "forecast-lab", label: "Forecast Lab", icon: <FlaskConical className="size-4" aria-hidden /> },
  { id: "model-arena", label: "Model Arena", icon: <Swords className="size-4" aria-hidden /> },
  { id: "data-studio", label: "Data Studio", icon: <Database className="size-4" aria-hidden /> },
  { id: "ai-analyst", label: "AI Analyst", icon: <Bot className="size-4" aria-hidden /> },
  { id: "methodology", label: "Methodology", icon: <BookOpen className="size-4" aria-hidden /> },
];

function Notices({ res }: { res: EngineResult | null }) {
  const engineError = useAppStore((s) => s.engineError);
  const notes = [
    ...(engineError ? [{ title: "Engine notice", text: engineError, tone: "danger" as const }] : []),
    ...(res?.selectionNote ? [{ title: "Model selection", text: res.selectionNote, tone: "warn" as const }] : []),
    ...(res?.message && res.status === "ok" ? [{ title: "Models", text: res.message, tone: "warn" as const }] : []),
  ];
  if (!notes.length) return null;
  return (
    <div className="space-y-2">
      {notes.map((n) => (
        <Alert key={n.title} className={n.tone === "danger" ? "border-danger/40 bg-danger-soft" : "border-warning/40 bg-warning-soft"}>
          <TriangleAlert className="size-4" aria-hidden />
          <AlertTitle>{n.title}</AlertTitle>
          <AlertDescription>{n.text}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

function OverviewTab() {
  return (
    <Ready>
      {(r, c) => (
        <>
          <KpiCards res={r} />
          <div className="grid gap-4 xl:grid-cols-3">
            <Panel id="hero" className="xl:col-span-2" title="Demand history and forecast" description={`Actual units, ${r.models.find((m) => m.id === r.selectedId)?.shortName ?? "model"} hold-out predictions and the ${r.horizon}-month forecast with 80% and 95% intervals`} caption={c.hero}>
              <HeroForecastChart res={r} />
            </Panel>
            <div className="space-y-4">
              <AiSummaryCard />
              <Panel title="At a glance" caption={c.kpis}>
                <dl className="tabular grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
                  <dt className="text-muted-foreground">Scope</dt>
                  <dd className="truncate text-right font-medium">{r.scopeRegions.length === r.regions.length ? "All markets" : r.scopeRegions.join(", ")}</dd>
                  <dt className="text-muted-foreground">History</dt>
                  <dd className="text-right font-medium">{r.n} months</dd>
                  <dt className="text-muted-foreground">Hold-out</dt>
                  <dd className="text-right font-medium">{r.holdoutSize} months</dd>
                  <dt className="text-muted-foreground">Next month</dt>
                  <dd className="text-right font-medium">{r.forecast[0] ? formatPeriod(r.forecast[0].period) : "n/a"}</dd>
                </dl>
              </Panel>
            </div>
          </div>
          <ProductionPlan res={r} captions={c} />
        </>
      )}
    </Ready>
  );
}

export function DashboardTabs() {
  const tab = useAppStore((s) => s.activeTab);
  const setTab = useAppStore((s) => s.setActiveTab);
  const res = useResult();

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-tab-id="${tab}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);

  return (
    <div className="space-y-4">
      <Notices res={res} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="gap-4">
        <div className="no-print -mx-4 overflow-x-auto overflow-y-hidden px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          <TabsList className="h-10! w-max">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} data-tab-id={t.id} className="gap-1.5 px-3 text-[13px]">
                {t.icon}
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview" className="space-y-4">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="forecast-lab" className="space-y-4">
          <ForecastLabTab />
        </TabsContent>
        <TabsContent value="model-arena" className="space-y-4">
          <ModelArenaTab />
        </TabsContent>
        <TabsContent value="data-studio" className="space-y-4">
          <DataStudioTab />
        </TabsContent>
        <TabsContent value="ai-analyst" className="space-y-4">
          <AiAnalystTab />
        </TabsContent>
        <TabsContent value="methodology" className="space-y-4">
          <MethodologyTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
