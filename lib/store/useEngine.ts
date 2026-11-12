"use client";

import { useEffect, useRef } from "react";
import { useAppStore, SAMPLE_LABEL } from "./useAppStore";
import type { EngineInput } from "@/lib/forecast";
import { ingestText } from "@/lib/data/ingest";
import type { WorkerResponse } from "@/workers/forecast.worker";
import type { InitialData } from "./initialResult";

/** Restore persisted state after the first render (keeps server and client markup identical). */
export function useRehydrate() {
  useEffect(() => {
    void useAppStore.persist.rehydrate();
  }, []);
}

const DEBOUNCE_MS = 300;

/** Fallback when Web Workers are unavailable: load the engine on demand and run it in the page. */
async function runOnMainThread(input: EngineInput) {
  const { runEngine } = await import("@/lib/forecast");
  await new Promise((r) => setTimeout(r, 16));
  return runEngine(input);
}

/** Loads the sample dataset on first visit (or when the store is empty). */
export function useSampleBootstrap(initial?: InitialData | null) {
  const hydrated = useAppStore((s) => s.hydrated);
  const rowsCount = useAppStore((s) => s.rows.length);
  const datasetKind = useAppStore((s) => s.datasetKind);
  const loadDataset = useAppStore((s) => s.loadDataset);
  const setEngineError = useAppStore((s) => s.setEngineError);
  const started = useRef(false);

  useEffect(() => {
    if (!hydrated || started.current) return;
    if (rowsCount > 0 || datasetKind !== "sample") return;
    started.current = true;
    if (initial && initial.rows.length > 0) {
      loadDataset(initial.rows, { kind: "sample", label: SAMPLE_LABEL, notices: initial.notices, rejected: [] });
      return;
    }
    fetch("/data/bevcast_sample_sales.csv", { cache: "force-cache" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        const res = ingestText(text);
        if (!res.ok) throw new Error(res.notices.find((n) => n.level === "error")?.message ?? "sample could not be parsed");
        loadDataset(res.rows, { kind: "sample", label: SAMPLE_LABEL, notices: res.notices, rejected: res.rejected });
      })
      .catch((e: unknown) => setEngineError(`Could not load the sample dataset: ${e instanceof Error ? e.message : String(e)}. Upload or paste data in the Data Studio.`));
  }, [hydrated, rowsCount, datasetKind, loadDataset, setEngineError, initial]);
}

/**
 * Runs the forecasting engine in a Web Worker whenever data, settings or scenario change
 * (debounced 300 ms). The last good result stays on screen until the new one arrives. If workers
 * are unavailable the engine runs on the main thread instead.
 */
export function useEngine() {
  const hydrated = useAppStore((s) => s.hydrated);
  const rows = useAppStore((s) => s.rows);
  const settings = useAppStore((s) => s.settings);
  const scenario = useAppStore((s) => s.scenario);
  const ingestNotices = useAppStore((s) => s.ingestNotices);
  const rejected = useAppStore((s) => s.rejected);
  const setComputing = useAppStore((s) => s.setComputing);
  const setResult = useAppStore((s) => s.setResult);
  const setEngineError = useAppStore((s) => s.setEngineError);

  const workerRef = useRef<Worker | null>(null);
  const workerBroken = useRef(false);
  const reqId = useRef(0);
  const latestInput = useRef<EngineInput | null>(null);

  useEffect(() => {
    const runInPage = () => {
      const input = latestInput.current;
      if (!input) return;
      const id = reqId.current;
      void runOnMainThread(input).then(
        (result) => id === reqId.current && setResult(result),
        (e: unknown) => setEngineError(`Forecast engine error: ${e instanceof Error ? e.message : String(e)}`),
      );
    };
    if (typeof window === "undefined" || typeof Worker === "undefined") {
      workerBroken.current = true;
      return;
    }
    try {
      const w = new Worker(new URL("../../workers/forecast.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        if (msg.id !== reqId.current) return; // stale response
        if (msg.type === "progress") setComputing(true, { stage: msg.stage, pct: msg.pct });
        else if (msg.type === "result") setResult(msg.result);
        else setEngineError(`Forecast engine error: ${msg.message}`);
      };
      w.onerror = (ev) => {
        ev.preventDefault();
        workerBroken.current = true;
        w.terminate();
        workerRef.current = null;
        // recompute the pending request on the main thread so nothing is left hanging
        runInPage();
      };
      workerRef.current = w;
    } catch {
      workerBroken.current = true;
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [setComputing, setResult, setEngineError]);

  useEffect(() => {
    if (!hydrated || rows.length === 0) return;
    const input: EngineInput = { rows, settings, scenario, ingestNotices, rejected };
    latestInput.current = input;
    const timer = setTimeout(() => {
      reqId.current += 1;
      const id = reqId.current;
      setComputing(true, { stage: "Queued", pct: 1 });
      const w = workerRef.current;
      if (w && !workerBroken.current) {
        w.postMessage({ id, input });
        return;
      }
      // main-thread fallback, yielded so the "Retraining" indicator can paint first
      void runOnMainThread(input).then(
        (result) => id === reqId.current && setResult(result),
        (e: unknown) => setEngineError(`Forecast engine error: ${e instanceof Error ? e.message : String(e)}`),
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [hydrated, rows, settings, scenario, ingestNotices, rejected, setComputing, setResult, setEngineError]);
}
