"use client";

import { Header } from "./Header";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useAppStore, type TabId } from "@/lib/store/useAppStore";
import { DashboardTabs } from "./DashboardTabs";
import { useEngine, useRehydrate, useSampleBootstrap } from "@/lib/store/useEngine";
import { useAiController } from "@/lib/store/useAiAnalyst";
import { InitialDataProvider, type InitialData } from "@/lib/store/initialResult";

const ControlPanel = dynamic(() => import("./ControlPanel").then((m) => m.ControlPanel), { ssr: false });

/** The Control Panel's code loads the first time it is opened, then stays mounted. */
function LazyControlPanel() {
  const open = useAppStore((s) => s.controlPanelOpen);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return mounted ? <ControlPanel /> : null;
}

const TAB_IDS: TabId[] = ["overview", "forecast-lab", "model-arena", "data-studio", "ai-analyst", "methodology"];

/** Deep links: /?tab=model-arena opens that tab (applied after persisted state is restored). */
function useTabFromUrl() {
  const hydrated = useAppStore((s) => s.hydrated);
  const setTab = useAppStore((s) => s.setActiveTab);
  useEffect(() => {
    if (!hydrated) return;
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && (TAB_IDS as string[]).includes(t)) setTab(t as TabId);
  }, [hydrated, setTab]);
}

function Controllers({ initial }: { initial: InitialData | null }) {
  useRehydrate();
  useTabFromUrl();
  useSampleBootstrap(initial);
  useEngine();
  useAiController();
  return null;
}

export function Dashboard({ initial }: { initial: InitialData | null }) {
  return (
    <InitialDataProvider value={initial}>
      <Controllers initial={initial} />
      <Header />
      <LazyControlPanel />
      <main className="mx-auto min-h-[calc(100dvh-60px)] max-w-[1400px] px-4 py-5 sm:px-6">
        <DashboardTabs />
      </main>
      <footer className="no-print mx-auto max-w-[1400px] px-4 pb-8 text-xs text-muted-foreground sm:px-6">
        BevCast - forecasting engine implemented from scratch in TypeScript, running in your browser. AI in Operations, MAIB, SP Jain School of Global Management.
      </footer>
    </InitialDataProvider>
  );
}
