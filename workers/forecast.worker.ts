import { runEngine, type EngineInput, type EngineResult } from "@/lib/forecast";

export type WorkerRequest = { id: number; input: EngineInput };
export type WorkerResponse =
  | { type: "progress"; id: number; stage: string; pct: number }
  | { type: "result"; id: number; result: EngineResult }
  | { type: "error"; id: number; message: string };

interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}

const ctx = self as unknown as WorkerScope;

ctx.onmessage = (event) => {
  const { id, input } = event.data;
  try {
    const result = runEngine(input, (p) => ctx.postMessage({ type: "progress", id, stage: p.stage, pct: p.pct }));
    ctx.postMessage({ type: "result", id, result });
  } catch (e) {
    ctx.postMessage({ type: "error", id, message: e instanceof Error ? e.message : String(e) });
  }
};
