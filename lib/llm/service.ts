import { z } from "zod";
import { InterpretRequestSchema, InterpretationSchema, AskAnswerSchema, type InterpretResponse, type ProviderStatus } from "./schema";
import { resolveProvider, callProvider, extractJson, ProviderError, type ChatMessage, type Env, type FetchLike, type ProviderConfig } from "./providers";
import { SYSTEM_PROMPT, buildInterpretMessage, buildAskMessage, repairMessage } from "./prompts";
import { ruleBasedInterpretation, ruleBasedAnswer } from "./fallback";

export const MAX_BODY_BYTES = 50 * 1024;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

/** Simple in-memory sliding-window limiter (per serverless instance). */
const hits = new Map<string, number[]>();
export function rateLimited(ip: string, now: number): boolean {
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_LIMIT) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
  }
  return false;
}
export function resetRateLimiter(): void {
  hits.clear();
}

export function providerStatus(env: Env): ProviderStatus {
  const cfg = resolveProvider(env);
  return { configured: cfg !== null, provider: cfg?.provider ?? null, model: cfg?.model ?? null };
}

export interface ServiceOptions {
  env: Env;
  fetchImpl: FetchLike;
  ip: string;
  now?: number;
  timeoutMs?: number;
}

export interface ServiceResult {
  status: number;
  body: InterpretResponse | { error: string; details?: string };
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`LLM timed out after ${Math.round(ms / 1000)} s`);
    this.name = "TimeoutError";
  }
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One call with a single retry on 429 / 5xx. */
async function callWithRetry(cfg: ProviderConfig, messages: ChatMessage[], fetchImpl: FetchLike, deadline: number): Promise<string> {
  const attempt = () => {
    const remaining = Math.max(1000, deadline - Date.now());
    return withTimeout(remaining, (signal) => callProvider(cfg, { system: SYSTEM_PROMPT, messages, json: true }, fetchImpl, signal));
  };
  try {
    return await attempt();
  } catch (e) {
    if (e instanceof ProviderError && e.retryable && deadline - Date.now() > 3000) {
      await new Promise((r) => setTimeout(r, 800));
      return attempt();
    }
    throw e;
  }
}

function issuesOf(e: unknown): string {
  if (e instanceof z.ZodError) return e.issues.slice(0, 6).map((i) => `${i.path.join(".") || "root"}: ${i.message}`).join("; ");
  return e instanceof Error ? e.message : String(e);
}

const LONG_DASHES = /\s*[\u2014\u2013]\s*/g;

/** House style: no em/en dashes in anything shown to the user. */
export function stripLongDashes<T>(value: T): T {
  if (typeof value === "string") return value.replace(LONG_DASHES, " - ") as T;
  if (Array.isArray(value)) return value.map((v) => stripLongDashes(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripLongDashes(v)])) as T;
  }
  return value;
}

/** Ask, validate, and if invalid ask once more with a repair message. */
async function generateValidated<T>(cfg: ProviderConfig, userMessage: string, schema: z.ZodType<T>, fetchImpl: FetchLike, deadline: number, history: ChatMessage[] = []): Promise<T> {
  const messages: ChatMessage[] = [...history, { role: "user", content: userMessage }];
  const first = await callWithRetry(cfg, messages, fetchImpl, deadline);
  try {
    return stripLongDashes(schema.parse(extractJson(first)));
  } catch (e) {
    const repaired = await callWithRetry(cfg, [...messages, { role: "assistant", content: first.slice(0, 6000) }, { role: "user", content: repairMessage(issuesOf(e)) }], fetchImpl, deadline);
    try {
      return stripLongDashes(schema.parse(extractJson(repaired)));
    } catch (e2) {
      throw new Error(`invalid JSON after repair (${issuesOf(e2)})`);
    }
  }
}

export async function handleInterpret(rawBody: string, opts: ServiceOptions): Promise<ServiceResult> {
  const started = Date.now();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) return { status: 413, body: { error: "Request body is larger than 50 KB." } };
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "Request body is not valid JSON." } };
  }
  const parsed = InterpretRequestSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: { error: "Request body failed validation.", details: issuesOf(parsed.error) } };
  const req = parsed.data;
  const snapshot = req.snapshot;
  const cfg = resolveProvider(opts.env);

  const fallback = (reason: string, status = 200): ServiceResult => ({
    status,
    body: {
      source: "fallback",
      provider: cfg?.provider ?? null,
      model: cfg?.model ?? null,
      snapshot_id: snapshot.snapshot_id,
      ...(req.mode === "interpret" ? { interpretation: ruleBasedInterpretation(snapshot) } : { answer: ruleBasedAnswer(snapshot, req.question) }),
      fallback_reason: reason,
      latency_ms: Date.now() - started,
    },
  });

  if (rateLimited(opts.ip, opts.now ?? Date.now())) return fallback("Rate limit reached (10 requests per minute). Showing rule-based analysis.", 429);
  if (!cfg) return fallback("LLM not configured: no API key is set on the server.");

  const deadline = Date.now() + (opts.timeoutMs ?? 25_000);
  try {
    if (req.mode === "interpret") {
      const interpretation = await generateValidated(cfg, buildInterpretMessage(snapshot), InterpretationSchema, opts.fetchImpl, deadline);
      return { status: 200, body: { source: "llm", provider: cfg.provider, model: cfg.model, snapshot_id: snapshot.snapshot_id, interpretation, latency_ms: Date.now() - started } };
    }
    const answer = await generateValidated(cfg, buildAskMessage(snapshot, req.question), AskAnswerSchema, opts.fetchImpl, deadline, req.history.slice(-6));
    return { status: 200, body: { source: "llm", provider: cfg.provider, model: cfg.model, snapshot_id: snapshot.snapshot_id, answer: answer.answer, latency_ms: Date.now() - started } };
  } catch (e) {
    const reason = e instanceof TimeoutError ? e.message : e instanceof ProviderError ? `Provider error (${e.status})` : `LLM output rejected: ${e instanceof Error ? e.message : String(e)}`;
    return fallback(reason);
  }
}
