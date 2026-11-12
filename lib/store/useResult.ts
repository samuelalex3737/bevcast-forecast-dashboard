"use client";

import { useAppStore } from "./useAppStore";
import { useInitialData } from "./initialResult";
import type { EngineResult } from "@/lib/forecast";
import { DEFAULT_SETTINGS } from "@/lib/forecast/settings";
import { buildCaptions, type Captions } from "@/lib/insights/captions";

const captionCache = new WeakMap<EngineResult, Captions>();
const DEFAULT_SETTINGS_JSON = JSON.stringify(DEFAULT_SETTINGS);

export function captionsFor(result: EngineResult): Captions {
  const hit = captionCache.get(result);
  if (hit) return hit;
  let c: Captions;
  try {
    c = buildCaptions(result);
  } catch (e) {
    const msg = `Insight unavailable (${e instanceof Error ? e.message : String(e)}).`;
    c = new Proxy({} as Captions, { get: () => msg });
  }
  captionCache.set(result, c);
  return c;
}

/**
 * The live engine result. Until the first live result arrives, the result pre-computed at build
 * time is used, but only while the state is still the untouched sample with default settings
 * (so it is identical to what the live engine will produce).
 */
export function useResult(): EngineResult | null {
  const live = useAppStore((s) => s.result);
  const pristine = useAppStore(
    (s) => !s.hydrated || (s.datasetKind === "sample" && Object.keys(s.scenario).length === 0 && JSON.stringify(s.settings) === DEFAULT_SETTINGS_JSON),
  );
  const initial = useInitialData();
  if (live) return live;
  return pristine ? initial?.result ?? null : null;
}

export function useCaptions(): Captions | null {
  const r = useResult();
  return r ? captionsFor(r) : null;
}
