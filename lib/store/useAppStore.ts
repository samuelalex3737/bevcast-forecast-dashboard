"use client";

import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import type { DataRow, IngestNotice, RejectedRow } from "@/lib/data/schema";
import { DatasetSchema } from "@/lib/data/schema";
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from "@/lib/forecast/settings";
import type { EngineResult, ProgressEvent, ScenarioOverrides } from "@/lib/forecast";
import type { InterpretResponse, ProviderStatus } from "@/lib/llm/schema";

export type DatasetKind = "sample" | "uploaded" | "pasted" | "edited";
export type TabId = "overview" | "forecast-lab" | "model-arena" | "data-studio" | "ai-analyst" | "methodology";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  source?: "llm" | "fallback";
  snapshotId?: string;
  at: number;
}

/** localStorage wrapped in try/catch: private mode, quota errors or blocked storage never break the app. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(name, value);
    } catch {
      /* storage full or blocked: the app keeps working in memory */
    }
  },
  removeItem: (name) => {
    try {
      if (typeof window !== "undefined") window.localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

export const SAMPLE_LABEL = "Sample dataset (simulated)";

interface AppState {
  hydrated: boolean;
  rows: DataRow[];
  datasetKind: DatasetKind;
  datasetLabel: string;
  fileName: string | null;
  ingestNotices: IngestNotice[];
  rejected: RejectedRow[];
  settings: Settings;
  scenario: ScenarioOverrides;
  activeTab: TabId;
  controlPanelOpen: boolean;

  result: EngineResult | null;
  computing: boolean;
  progress: ProgressEvent | null;
  lastRetrained: number | null;
  engineError: string | null;

  provider: ProviderStatus | null;
  interpretations: Record<string, InterpretResponse>;
  interpretationOrder: string[];
  aiLoadingId: string | null;
  aiError: string | null;
  autoUpdateAI: boolean;
  aiRequestNonce: number;
  chat: ChatTurn[];

  setHydrated: () => void;
  loadDataset: (rows: DataRow[], meta: { kind: DatasetKind; label: string; fileName?: string | null; notices?: IngestNotice[]; rejected?: RejectedRow[] }) => void;
  updateRow: (index: number, patch: Partial<DataRow>) => void;
  addRow: (row: DataRow) => void;
  addRows: (rows: DataRow[]) => void;
  deleteRow: (index: number) => void;
  deletePeriod: (period: string) => void;
  renameRegion: (from: string, to: string) => void;
  setSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
  setScenario: (period: string, patch: { temp?: number | null; promo?: 0 | 1 | null }) => void;
  resetScenario: () => void;
  setActiveTab: (tab: TabId) => void;
  setControlPanelOpen: (open: boolean) => void;

  setComputing: (computing: boolean, progress?: ProgressEvent | null) => void;
  setResult: (result: EngineResult) => void;
  setEngineError: (msg: string | null) => void;

  setProvider: (p: ProviderStatus) => void;
  cacheInterpretation: (r: InterpretResponse) => void;
  setAiLoading: (id: string | null) => void;
  setAiError: (msg: string | null) => void;
  setAutoUpdateAI: (on: boolean) => void;
  requestRegenerate: () => void;
  pushChat: (turn: ChatTurn) => void;
  clearChat: () => void;
}

function markEdited(state: AppState): Pick<AppState, "datasetKind" | "datasetLabel"> {
  if (state.datasetKind === "edited") return { datasetKind: "edited", datasetLabel: state.datasetLabel };
  const base = state.datasetKind === "sample" ? "Sample" : state.fileName ?? "Uploaded data";
  return { datasetKind: "edited", datasetLabel: `${base} (edited)` };
}

function sortRows(rows: DataRow[]): DataRow[] {
  return [...rows].sort((a, b) => (a.period === b.period ? a.region.localeCompare(b.region) : a.period < b.period ? -1 : 1));
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      hydrated: false,
      rows: [],
      datasetKind: "sample",
      datasetLabel: SAMPLE_LABEL,
      fileName: null,
      ingestNotices: [],
      rejected: [],
      settings: DEFAULT_SETTINGS,
      scenario: {},
      activeTab: "overview",
      controlPanelOpen: false,

      result: null,
      computing: false,
      progress: null,
      lastRetrained: null,
      engineError: null,

      provider: null,
      interpretations: {},
      interpretationOrder: [],
      aiLoadingId: null,
      aiError: null,
      autoUpdateAI: true,
      aiRequestNonce: 0,
      chat: [],

      setHydrated: () => set({ hydrated: true }),
      loadDataset: (rows, meta) =>
        set((s) => ({
          rows: sortRows(rows),
          datasetKind: meta.kind,
          datasetLabel: meta.label,
          fileName: meta.fileName ?? null,
          ingestNotices: meta.notices ?? [],
          rejected: meta.rejected ?? [],
          scenario: {},
          settings: { ...s.settings, regions: [] },
        })),
      updateRow: (index, patch) =>
        set((s) => {
          if (index < 0 || index >= s.rows.length) return {};
          const rows = s.rows.slice();
          rows[index] = { ...rows[index], ...patch };
          return { rows, ...markEdited(s) };
        }),
      addRow: (row) => set((s) => ({ rows: sortRows([...s.rows, row]), ...markEdited(s) })),
      addRows: (newRows) => set((s) => ({ rows: sortRows([...s.rows, ...newRows]), ...markEdited(s) })),
      deleteRow: (index) => set((s) => ({ rows: s.rows.filter((_, i) => i !== index), ...markEdited(s) })),
      deletePeriod: (period) => set((s) => ({ rows: s.rows.filter((r) => r.period !== period), ...markEdited(s) })),
      renameRegion: (from, to) =>
        set((s) => {
          const name = to.trim().slice(0, 80);
          if (!name || name === from) return {};
          return {
            rows: s.rows.map((r) => (r.region === from ? { ...r, region: name } : r)),
            settings: { ...s.settings, regions: s.settings.regions.map((r) => (r === from ? name : r)) },
            ...markEdited(s),
          };
        }),
      setSettings: (patch) => set((s) => ({ settings: sanitizeSettings({ ...s.settings, ...patch, enabledModels: { ...s.settings.enabledModels, ...(patch.enabledModels ?? {}) } }) })),
      resetSettings: () => set((s) => ({ settings: { ...DEFAULT_SETTINGS, regions: s.settings.regions } })),
      setScenario: (period, patch) => set((s) => ({ scenario: { ...s.scenario, [period]: { ...(s.scenario[period] ?? {}), ...patch } } })),
      resetScenario: () => set({ scenario: {} }),
      setActiveTab: (tab) => set({ activeTab: tab }),
      setControlPanelOpen: (open) => set({ controlPanelOpen: open }),

      setComputing: (computing, progress = null) => set({ computing, progress }),
      setResult: (result) => set({ result, computing: false, progress: null, lastRetrained: Date.now(), engineError: null }),
      setEngineError: (msg) => set({ engineError: msg, computing: false, progress: null }),

      setProvider: (p) => set({ provider: p }),
      cacheInterpretation: (r) =>
        set((s) => {
          const order = [r.snapshot_id, ...s.interpretationOrder.filter((id) => id !== r.snapshot_id)].slice(0, 8);
          const interpretations: Record<string, InterpretResponse> = {};
          for (const id of order) {
            const v = id === r.snapshot_id ? r : s.interpretations[id];
            if (v) interpretations[id] = v;
          }
          return { interpretations, interpretationOrder: order, aiLoadingId: s.aiLoadingId === r.snapshot_id ? null : s.aiLoadingId, aiError: null };
        }),
      setAiLoading: (id) => set({ aiLoadingId: id }),
      setAiError: (msg) => set({ aiError: msg, aiLoadingId: null }),
      setAutoUpdateAI: (on) => set({ autoUpdateAI: on }),
      requestRegenerate: () => set((s) => ({ aiRequestNonce: s.aiRequestNonce + 1 })),
      pushChat: (turn) => set((s) => ({ chat: [...s.chat, turn].slice(-30) })),
      clearChat: () => set({ chat: [] }),
    }),
    {
      name: "bevcast-state-v1",
      version: 1,
      skipHydration: true,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({
        rows: s.rows,
        datasetKind: s.datasetKind,
        datasetLabel: s.datasetLabel,
        fileName: s.fileName,
        ingestNotices: s.ingestNotices,
        rejected: s.rejected,
        settings: s.settings,
        scenario: s.scenario,
        activeTab: s.activeTab,
        interpretations: s.interpretations,
        interpretationOrder: s.interpretationOrder,
        autoUpdateAI: s.autoUpdateAI,
        chat: s.chat,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const rows = DatasetSchema.safeParse(p.rows);
        return {
          ...current,
          ...p,
          rows: rows.success ? rows.data : [],
          settings: sanitizeSettings(p.settings ?? DEFAULT_SETTINGS),
          scenario: typeof p.scenario === "object" && p.scenario !== null ? p.scenario : {},
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    },
  ),
);
