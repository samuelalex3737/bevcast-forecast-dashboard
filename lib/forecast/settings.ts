import { z } from "zod";
import { MODEL_IDS, type ModelId } from "./types";

export const CONFIDENCE_LEVELS = [80, 90, 95] as const;
export const SERVICE_LEVELS = [90, 95, 97.5, 99] as const;

export const Z_TWO_SIDED: Record<number, number> = { 80: 1.2816, 90: 1.6449, 95: 1.96 };
export const Z_ONE_SIDED: Record<number, number> = { 90: 1.2816, 95: 1.6449, 97.5: 1.96, 99: 2.3263 };

export const GUARDRAILS = {
  holdout: { min: 1, max: 6 },
  horizon: { min: 1, max: 12 },
  maWindow: { min: 2, max: 6 },
  rfTrees: { min: 50, max: 500 },
  rfMaxDepth: { min: 2, max: 8 },
  gbmRounds: { min: 50, max: 500 },
  gbmLearningRate: { min: 0.01, max: 0.3 },
  gbmMaxDepth: { min: 1, max: 4 },
  seed: { min: 1, max: 999999 },
  unitCost: { min: 0.01, max: 1000 },
  unitPrice: { min: 0.01, max: 1000 },
} as const;

const modelToggleShape = Object.fromEntries(MODEL_IDS.map((id) => [id, z.boolean()])) as Record<ModelId, z.ZodBoolean>;

export const SettingsSchema = z.object({
  regions: z.array(z.string()).max(200),
  holdout: z.number().int().min(GUARDRAILS.holdout.min).max(GUARDRAILS.holdout.max),
  horizon: z.number().int().min(GUARDRAILS.horizon.min).max(GUARDRAILS.horizon.max),
  confidence: z.union([z.literal(80), z.literal(90), z.literal(95)]),
  serviceLevel: z.union([z.literal(90), z.literal(95), z.literal(97.5), z.literal(99)]),
  enabledModels: z.object(modelToggleShape),
  selectedModel: z.union([z.literal("auto"), z.enum(MODEL_IDS)]),
  rankMetric: z.enum(["wape", "mape"]),
  maWindow: z.number().int().min(GUARDRAILS.maWindow.min).max(GUARDRAILS.maWindow.max),
  rfTrees: z.number().int().min(GUARDRAILS.rfTrees.min).max(GUARDRAILS.rfTrees.max),
  rfMaxDepth: z.number().int().min(GUARDRAILS.rfMaxDepth.min).max(GUARDRAILS.rfMaxDepth.max),
  gbmRounds: z.number().int().min(GUARDRAILS.gbmRounds.min).max(GUARDRAILS.gbmRounds.max),
  gbmLearningRate: z.number().min(GUARDRAILS.gbmLearningRate.min).max(GUARDRAILS.gbmLearningRate.max),
  gbmMaxDepth: z.number().int().min(GUARDRAILS.gbmMaxDepth.min).max(GUARDRAILS.gbmMaxDepth.max),
  seed: z.number().int().min(GUARDRAILS.seed.min).max(GUARDRAILS.seed.max),
  unitCost: z.number().min(GUARDRAILS.unitCost.min).max(GUARDRAILS.unitCost.max),
  unitPrice: z.number().min(GUARDRAILS.unitPrice.min).max(GUARDRAILS.unitPrice.max),
  fillGaps: z.boolean(),
  seasonalArima: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  regions: [],
  holdout: 3,
  horizon: 3,
  confidence: 95,
  serviceLevel: 95,
  enabledModels: { naive: true, drift: true, ma: true, snaive: true, holt: true, arima: true, regression: true, rf: true, gbm: true, ensemble: true },
  selectedModel: "auto",
  rankMetric: "wape",
  maWindow: 3,
  rfTrees: 200,
  rfMaxDepth: 4,
  gbmRounds: 150,
  gbmLearningRate: 0.1,
  gbmMaxDepth: 2,
  seed: 42,
  unitCost: 1.2,
  unitPrice: 3.5,
  fillGaps: true,
  seasonalArima: true,
};

function clamp(v: unknown, min: number, max: number, fallback: number, integer = false): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  const c = Math.min(max, Math.max(min, n));
  return integer ? Math.round(c) : c;
}

/** Coerce any partial / stale / tampered settings object into a valid Settings value. */
export function sanitizeSettings(input: unknown): Settings {
  const s = (typeof input === "object" && input !== null ? input : {}) as Partial<Record<keyof Settings, unknown>>;
  const d = DEFAULT_SETTINGS;
  const g = GUARDRAILS;
  const enabledRaw = (typeof s.enabledModels === "object" && s.enabledModels !== null ? s.enabledModels : {}) as Partial<Record<ModelId, unknown>>;
  const enabledModels = Object.fromEntries(MODEL_IDS.map((id) => [id, typeof enabledRaw[id] === "boolean" ? (enabledRaw[id] as boolean) : d.enabledModels[id]])) as Record<ModelId, boolean>;
  if (!Object.values(enabledModels).some(Boolean)) enabledModels.naive = true;
  const conf = Number(s.confidence);
  const svc = Number(s.serviceLevel);
  const selected = typeof s.selectedModel === "string" && (s.selectedModel === "auto" || (MODEL_IDS as readonly string[]).includes(s.selectedModel)) ? (s.selectedModel as Settings["selectedModel"]) : d.selectedModel;
  const out: Settings = {
    regions: Array.isArray(s.regions) ? s.regions.filter((r): r is string => typeof r === "string").slice(0, 200) : d.regions,
    holdout: clamp(s.holdout, g.holdout.min, g.holdout.max, d.holdout, true),
    horizon: clamp(s.horizon, g.horizon.min, g.horizon.max, d.horizon, true),
    confidence: conf === 80 || conf === 90 || conf === 95 ? conf : d.confidence,
    serviceLevel: svc === 90 || svc === 95 || svc === 97.5 || svc === 99 ? svc : d.serviceLevel,
    enabledModels,
    selectedModel: selected,
    rankMetric: s.rankMetric === "mape" ? "mape" : "wape",
    maWindow: clamp(s.maWindow, g.maWindow.min, g.maWindow.max, d.maWindow, true),
    rfTrees: clamp(s.rfTrees, g.rfTrees.min, g.rfTrees.max, d.rfTrees, true),
    rfMaxDepth: clamp(s.rfMaxDepth, g.rfMaxDepth.min, g.rfMaxDepth.max, d.rfMaxDepth, true),
    gbmRounds: clamp(s.gbmRounds, g.gbmRounds.min, g.gbmRounds.max, d.gbmRounds, true),
    gbmLearningRate: clamp(s.gbmLearningRate, g.gbmLearningRate.min, g.gbmLearningRate.max, d.gbmLearningRate),
    gbmMaxDepth: clamp(s.gbmMaxDepth, g.gbmMaxDepth.min, g.gbmMaxDepth.max, d.gbmMaxDepth, true),
    seed: clamp(s.seed, g.seed.min, g.seed.max, d.seed, true),
    unitCost: clamp(s.unitCost, g.unitCost.min, g.unitCost.max, d.unitCost),
    unitPrice: clamp(s.unitPrice, g.unitPrice.min, g.unitPrice.max, d.unitPrice),
    fillGaps: typeof s.fillGaps === "boolean" ? s.fillGaps : d.fillGaps,
    seasonalArima: typeof s.seasonalArima === "boolean" ? s.seasonalArima : d.seasonalArima,
  };
  return out;
}

/** Hold-out size allowed for a series of n periods: 1 to max(1, min(6, n - 4)). */
export function maxHoldout(n: number): number {
  return Math.max(1, Math.min(6, n - 4));
}
