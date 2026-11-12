/**
 * Provider-agnostic LLM client (server-side only). Keys are read from environment variables and
 * never leave the server.
 */

export type ProviderId = "groq" | "openai" | "gemini" | "anthropic";

export interface ProviderConfig {
  provider: ProviderId;
  model: string;
  apiKey: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  json: boolean;
  maxTokens?: number;
}

export type Env = Record<string, string | undefined>;
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const DEFAULT_MODELS: Record<ProviderId, string> = {
  groq: "llama-3.3-70b-versatile",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  anthropic: "claude-haiku-5-5",
};

const KEY_VARS: Record<ProviderId, string> = {
  groq: "GROQ_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const ORDER: ProviderId[] = ["groq", "openai", "gemini", "anthropic"];

/** First provider with a key, unless LLM_PROVIDER names one explicitly. LLM_MODEL overrides the model. */
export function resolveProvider(env: Env): ProviderConfig | null {
  const forced = (env.LLM_PROVIDER ?? "").trim().toLowerCase() as ProviderId;
  const candidates = ORDER.includes(forced) ? [forced] : ORDER;
  for (const p of candidates) {
    const key = (env[KEY_VARS[p]] ?? "").trim();
    if (key) return { provider: p, model: (env.LLM_MODEL ?? "").trim() || DEFAULT_MODELS[p], apiKey: key };
  }
  return null;
}

export class ProviderError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.retryable = status === 429 || status >= 500;
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 300);
  } catch {
    return res.statusText;
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

async function openAiCompatible(url: string, cfg: ProviderConfig, req: ChatRequest, fetchImpl: FetchLike, signal: AbortSignal): Promise<string> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      max_tokens: req.maxTokens ?? 2000,
      messages: [{ role: "system", content: req.system }, ...req.messages],
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal,
  });
  if (!res.ok) throw new ProviderError(`${cfg.provider} returned ${res.status}: ${await readError(res)}`, res.status);
  const data = asRecord(await res.json());
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const content = asRecord(asRecord(choices[0]).message).content;
  if (typeof content !== "string" || !content.trim()) throw new ProviderError(`${cfg.provider} returned an empty message`, 502);
  return content;
}

async function gemini(cfg: ProviderConfig, req: ChatRequest, fetchImpl: FetchLike, signal: AbortSignal): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { temperature: 0.2, maxOutputTokens: req.maxTokens ?? 2048, ...(req.json ? { responseMimeType: "application/json" } : {}) },
    }),
    signal,
  });
  if (!res.ok) throw new ProviderError(`gemini returned ${res.status}: ${await readError(res)}`, res.status);
  const data = asRecord(await res.json());
  const cands = Array.isArray(data.candidates) ? data.candidates : [];
  const parts = asRecord(asRecord(cands[0]).content).parts;
  const text = Array.isArray(parts) ? parts.map((p) => asRecord(p).text).filter((t): t is string => typeof t === "string").join("") : "";
  if (!text.trim()) throw new ProviderError("gemini returned an empty message", 502);
  return text;
}

async function anthropic(cfg: ProviderConfig, req: ChatRequest, fetchImpl: FetchLike, signal: AbortSignal): Promise<string> {
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: req.maxTokens ?? 2000,
      temperature: 0.2,
      system: req.system,
      messages: req.messages,
    }),
    signal,
  });
  if (!res.ok) throw new ProviderError(`anthropic returned ${res.status}: ${await readError(res)}`, res.status);
  const data = asRecord(await res.json());
  const content = Array.isArray(data.content) ? data.content : [];
  const text = content.map((c) => asRecord(c)).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text as string).join("");
  if (!text.trim()) throw new ProviderError("anthropic returned an empty message", 502);
  return text;
}

export async function callProvider(cfg: ProviderConfig, req: ChatRequest, fetchImpl: FetchLike, signal: AbortSignal): Promise<string> {
  switch (cfg.provider) {
    case "groq":
      return openAiCompatible("https://api.groq.com/openai/v1/chat/completions", cfg, req, fetchImpl, signal);
    case "openai":
      return openAiCompatible("https://api.openai.com/v1/chat/completions", cfg, req, fetchImpl, signal);
    case "gemini":
      return gemini(cfg, req, fetchImpl, signal);
    case "anthropic":
      return anthropic(cfg, req, fetchImpl, signal);
  }
}

/** Pull the JSON object out of a reply that may contain code fences or stray text. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("reply contained no JSON object");
  }
}
