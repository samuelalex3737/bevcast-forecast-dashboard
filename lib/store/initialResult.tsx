"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { EngineResult } from "@/lib/forecast";
import type { DataRow, IngestNotice } from "@/lib/data/schema";

export interface InitialData {
  /** Sample rows and their ingestion notices, parsed at build time. */
  rows: DataRow[];
  notices: IngestNotice[];
  /** Engine result for the sample rows with default settings, computed at build time. */
  result: EngineResult | null;
}

const Ctx = createContext<InitialData | null>(null);

export function InitialDataProvider({ value, children }: { value: InitialData | null; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInitialData(): InitialData | null {
  return useContext(Ctx);
}
