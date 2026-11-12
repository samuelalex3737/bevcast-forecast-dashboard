"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "./useAppStore";
import { useResult } from "./useResult";
import type { EngineResult } from "@/lib/forecast";
import { buildSnapshot } from "@/lib/llm/snapshot";
import { ruleBasedInterpretation, ruleBasedAnswer } from "@/lib/llm/fallback";
import { InterpretationSchema, type InterpretResponse, type Snapshot, type ProviderStatus } from "@/lib/llm/schema";

const snapshotCache = new WeakMap<EngineResult, Map<string, Snapshot>>();

export function snapshotFor(result: EngineResult | null, label: string): Snapshot | null {
  if (!result || result.status !== "ok") return null;
  let byLabel = snapshotCache.get(result);
  if (!byLabel) {
    byLabel = new Map();
    snapshotCache.set(result, byLabel);
  }
  const hit = byLabel.get(label);
  if (hit) return hit;
  const snap = buildSnapshot(result, label);
  byLabel.set(label, snap);
  return snap;
}

export function useSnapshot(): Snapshot | null {
  const result = useResult();
  const label = useAppStore((s) => s.datasetLabel);
  return snapshotFor(result, label);
}

function localFallback(snapshot: Snapshot, reason: string): InterpretResponse {
  return {
    source: "fallback",
    provider: null,
    model: null,
    snapshot_id: snapshot.snapshot_id,
    interpretation: ruleBasedInterpretation(snapshot),
    fallback_reason: reason,
    latency_ms: 0,
  };
}

function isInterpretResponse(v: unknown): v is InterpretResponse {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (o.source === "llm" || o.source === "fallback") && typeof o.snapshot_id === "string";
}

export async function requestInterpretation(snapshot: Snapshot): Promise<InterpretResponse> {
  try {
    const res = await fetch("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "interpret", snapshot }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (isInterpretResponse(body) && body.interpretation && InterpretationSchema.safeParse(body.interpretation).success) return body;
    const err = typeof body === "object" && body !== null && "error" in body ? String((body as { error: unknown }).error) : `HTTP ${res.status}`;
    return localFallback(snapshot, `Server could not interpret (${err}).`);
  } catch (e) {
    return localFallback(snapshot, `Could not reach the interpretation server (${e instanceof Error ? e.message : String(e)}).`);
  }
}

export async function askAnalyst(snapshot: Snapshot, question: string, history: { role: "user" | "assistant"; content: string }[]): Promise<{ answer: string; source: "llm" | "fallback"; reason?: string }> {
  try {
    const res = await fetch("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "ask", snapshot, question, history }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (isInterpretResponse(body) && typeof body.answer === "string") return { answer: body.answer, source: body.source, reason: body.fallback_reason };
    return { answer: ruleBasedAnswer(snapshot, question), source: "fallback", reason: `HTTP ${res.status}` };
  } catch (e) {
    return { answer: ruleBasedAnswer(snapshot, question), source: "fallback", reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Mount once: fetches provider status and (re)generates the interpretation when the snapshot changes. */
export function useAiController() {
  const snapshot = useSnapshot();
  const autoUpdate = useAppStore((s) => s.autoUpdateAI);
  const nonce = useAppStore((s) => s.aiRequestNonce);
  const setProvider = useAppStore((s) => s.setProvider);
  const setAiLoading = useAppStore((s) => s.setAiLoading);
  const cache = useAppStore((s) => s.cacheInterpretation);
  const lastNonce = useRef(nonce);
  const inFlight = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/interpret", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: ProviderStatus) => alive && setProvider({ configured: Boolean(j.configured), provider: j.provider ?? null, model: j.model ?? null }))
      .catch(() => alive && setProvider({ configured: false, provider: null, model: null }));
    return () => {
      alive = false;
    };
  }, [setProvider]);

  useEffect(() => {
    if (!snapshot) return;
    const forced = nonce !== lastNonce.current;
    lastNonce.current = nonce;
    const cached = useAppStore.getState().interpretations[snapshot.snapshot_id];
    if (!forced && (cached || !autoUpdate)) return;
    if (!forced && inFlight.current === snapshot.snapshot_id) return;
    const id = snapshot.snapshot_id;
    const timer = setTimeout(
      () => {
        inFlight.current = id;
        setAiLoading(id);
        requestInterpretation(snapshot).then((r) => {
          if (inFlight.current === id) inFlight.current = null;
          cache(r);
        });
      },
      forced ? 0 : 1500,
    );
    return () => clearTimeout(timer);
  }, [snapshot, autoUpdate, nonce, setAiLoading, cache]);
}

/** What the AI panels should show: the interpretation for the live snapshot, or the latest one marked stale. */
export function useInterpretationView() {
  const snapshot = useSnapshot();
  const interpretations = useAppStore((s) => s.interpretations);
  const order = useAppStore((s) => s.interpretationOrder);
  const loadingId = useAppStore((s) => s.aiLoadingId);
  const current = snapshot ? interpretations[snapshot.snapshot_id] ?? null : null;
  const latest = order.length ? interpretations[order[0]] ?? null : null;
  const shown = current ?? latest;
  return {
    snapshot,
    response: shown,
    stale: Boolean(snapshot && shown && shown.snapshot_id !== snapshot.snapshot_id),
    loading: Boolean(snapshot && loadingId === snapshot.snapshot_id),
  };
}
