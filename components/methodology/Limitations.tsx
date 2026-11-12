"use client";

import type { EngineResult } from "@/lib/forecast";
import { useAppStore } from "@/lib/store/useAppStore";
import { MODEL_INFO } from "@/lib/forecast/models/registry";

export function ModelList() {
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {MODEL_INFO.map((m) => (
        <li key={m.id} className="rounded-lg border p-3">
          <p className="text-[13px] font-semibold">
            {m.name} <span className="font-normal text-muted-foreground">- {m.family}, {m.minObs}+ months</span>
          </p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{m.why}</p>
        </li>
      ))}
    </ul>
  );
}

export function ValidationDesign({ res }: { res: EngineResult }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-[13px]">
      <li>Chronological hold-out: the last {res.holdoutSize} month(s) are hidden, models train on the first {res.split.trainPeriods.length}, then forecast the hidden months recursively (multi-step), exactly as they would forecast the future.</li>
      <li>Expanding-window walk-forward: for each of {res.wfOrigins.length} origins, models are refit on all prior months and forecast one month ahead. Origins are shared across models so scores are comparable.</li>
      <li>Ranking: primary metric ({res.settings.rankMetric.toUpperCase()}) on the hold-out, tie-break by walk-forward WAPE. Random splits are never used because they would leak the future into training.</li>
      <li>The final forecast refits the selected model on all {res.n} months and uses the Scenario Planner&apos;s temperature and promo assumptions.</li>
      <li>Determinism: tree models use a seeded mulberry32 generator (seed {res.settings.seed}); identical inputs always give identical outputs.</li>
    </ul>
  );
}

export function Limitations({ res }: { res: EngineResult }) {
  const kind = useAppStore((s) => s.datasetKind);
  const items = [
    `With ${res.n} months, the data covers ${res.n < 24 ? "less than two full years, so true yearly seasonality cannot be identified: the summer peak is confounded with launch-phase growth. Temperature acts as a proxy for the season, but only a second year can confirm the cycle" : "at least two years, so a yearly cycle can be estimated, but launch dynamics may still distort the first year"}.`,
    `Lag features consume the first ${res.features.rowsLost} month(s), so the tree models train on ${res.features.trainingRows} rows (fewer still inside the hold-out), which makes them prone to overfitting.`,
    `The hold-out has only ${res.holdoutSize} month(s), so the accuracy ranking is fragile; compare it with the walk-forward scores before trusting a winner.`,
    "Hold-out scores use the realised temperature and promo of the test months. Real forecasts depend on assumed future temperatures, so live error will be higher.",
    "Prediction intervals assume errors grow with the square root of the horizon and are roughly symmetric; they ignore parameter uncertainty and structural breaks.",
    "The variance-reduction rule for ARIMA differencing can over-difference a moderately persistent stationary series; it suits trending launch data.",
    "Regional allocation uses each region's recent share, which assumes the regional mix stays stable over the horizon.",
    ...(kind === "sample" ? ["The sample dataset is simulated. Results illustrate the method and must not be read as real market evidence."] : []),
  ];
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-[13px]">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

export function Assumptions() {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-[13px]">
      <li>Future temperature defaults to the mean of the same calendar month in the history (nearest calendar months if missing); promo defaults to 0 except December (UAE National Day and year-end).</li>
      <li>All Markets is the sum of the selected regions; temperature is the unit-weighted average and promo is 1 if any region promoted.</li>
      <li>Missing months are filled by linear interpolation (hollow markers) unless &quot;Leave gap&quot; is chosen; negative sales are rejected; outliers are flagged, never deleted.</li>
      <li>Forecasts and interval bounds are floored at zero.</li>
      <li>Unit cost and price (AED) drive the cost-of-error comparison and are editable in the Control Panel.</li>
    </ul>
  );
}
