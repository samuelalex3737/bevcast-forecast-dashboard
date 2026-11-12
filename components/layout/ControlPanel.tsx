"use client";

import { RotateCcw } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LabeledSlider, NumberField, SimpleSelect } from "@/components/shared/Controls";
import { useAppStore } from "@/lib/store/useAppStore";
import { GUARDRAILS, maxHoldout, type Settings } from "@/lib/forecast/settings";
import { MODEL_INFO, shortName } from "@/lib/forecast/models/registry";
import { MODEL_IDS, type ModelId } from "@/lib/forecast/types";
import { MODEL_COLORS } from "@/lib/insights/palette";
import type { ReactNode } from "react";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function ToggleRow({ label, hint, checked, onChange, disabled, disabledReason }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; disabledReason?: string }) {
  const control = <Switch checked={checked} onCheckedChange={(v) => onChange(Boolean(v))} disabled={disabled} aria-label={label} />;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{label}</p>
        {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      </div>
      {disabled && disabledReason ? (
        <Tooltip>
          <TooltipTrigger render={<span tabIndex={0} />}>{control}</TooltipTrigger>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
      ) : (
        control
      )}
    </div>
  );
}

export function ControlPanel() {
  const open = useAppStore((s) => s.controlPanelOpen);
  const setOpen = useAppStore((s) => s.setControlPanelOpen);
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const resetSettings = useAppStore((s) => s.resetSettings);
  const result = useAppStore((s) => s.result);
  const allRegions = result?.regions ?? Array.from(new Set(useAppStore.getState().rows.map((r) => r.region)));
  const n = result?.n ?? 0;
  const hMax = maxHoldout(n);
  const enabledCount = MODEL_IDS.filter((id) => settings.enabledModels[id]).length;
  const set = (patch: Partial<Settings>) => setSettings(patch);

  const statusOf = (id: ModelId) => result?.models.find((m) => m.id === id);
  const toggleRegion = (region: string, on: boolean) => {
    const current = settings.regions.length ? settings.regions : allRegions;
    const next = on ? Array.from(new Set([...current, region])) : current.filter((r) => r !== region);
    set({ regions: next.length === allRegions.length || next.length === 0 ? [] : next });
  };

  const selectableModels = [
    { value: "auto", label: `Auto (best by hold-out ${settings.rankMetric.toUpperCase()})` },
    ...MODEL_IDS.filter((id) => settings.enabledModels[id]).map((id) => {
      const m = statusOf(id);
      return { value: id, label: `${shortName(id)}${m && m.status !== "ok" ? " (unavailable)" : ""}` };
    }),
  ];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Control Panel</SheetTitle>
          <SheetDescription>Every change retrains all models and refreshes every chart, KPI, caption and AI interpretation.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
          <Section title="Scope">
            <div className="space-y-2">
              <p className="text-[13px] font-medium">Regions</p>
              <label className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={settings.regions.length === 0} onCheckedChange={(v) => v && set({ regions: [] })} aria-label="All markets" />
                All Markets (sum)
              </label>
              <div className="grid grid-cols-1 gap-1.5 pl-1 sm:grid-cols-2">
                {allRegions.map((r) => {
                  const checked = settings.regions.length === 0 || settings.regions.includes(r);
                  const isLast = settings.regions.length === 1 && settings.regions[0] === r;
                  return (
                    <label key={r} className="flex min-w-0 items-center gap-2 text-[13px]">
                      <Checkbox checked={checked} disabled={isLast} onCheckedChange={(v) => toggleRegion(r, Boolean(v))} aria-label={r} />
                      <span className="truncate">{r}</span>
                    </label>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {allRegions.map((r) => (
                  <Button key={r} size="xs" variant={settings.regions.length === 1 && settings.regions[0] === r ? "default" : "outline"} onClick={() => set({ regions: [r] })}>
                    Only {r.length > 14 ? `${r.slice(0, 12)}...` : r}
                  </Button>
                ))}
              </div>
            </div>
          </Section>
          <Separator />
          <Section title="Validation and forecast">
            <LabeledSlider label="Hold-out test size (months)" value={Math.min(settings.holdout, hMax)} min={1} max={hMax} onChange={(v) => set({ holdout: v })} hint={`limit min(6, n-4) with n = ${n}`} />
            <LabeledSlider label="Forecast horizon (months)" value={settings.horizon} min={GUARDRAILS.horizon.min} max={GUARDRAILS.horizon.max} onChange={(v) => set({ horizon: v })} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <p className="text-[13px] font-medium">Interval level</p>
                <SimpleSelect ariaLabel="Confidence level" value={String(settings.confidence)} onChange={(v) => set({ confidence: Number(v) as Settings["confidence"] })} options={[{ value: "80", label: "80%" }, { value: "90", label: "90%" }, { value: "95", label: "95%" }]} />
              </div>
              <div className="space-y-1">
                <p className="text-[13px] font-medium">Ranking metric</p>
                <SimpleSelect ariaLabel="Primary ranking metric" value={settings.rankMetric} onChange={(v) => set({ rankMetric: v === "mape" ? "mape" : "wape" })} options={[{ value: "wape", label: "WAPE" }, { value: "mape", label: "MAPE" }]} />
              </div>
            </div>
            <ToggleRow label="Fill missing months by interpolation" hint="Off = leave gaps; models treat remaining months as consecutive" checked={settings.fillGaps} onChange={(v) => set({ fillGaps: v })} />
            <ToggleRow
              label="Seasonal differencing for ARIMA (lag 12)"
              hint="Applied when it reduces variance by more than 10%"
              checked={settings.seasonalArima}
              onChange={(v) => set({ seasonalArima: v })}
              disabled={n < 24}
              disabledReason="Needs 24+ months of data"
            />
          </Section>
          <Separator />
          <Section title="Models">
            <div className="space-y-1">
              <p className="text-[13px] font-medium">Forecast model</p>
              <SimpleSelect ariaLabel="Forecast model" value={settings.selectedModel} onChange={(v) => set({ selectedModel: v as Settings["selectedModel"] })} options={selectableModels} />
            </div>
            <div className="space-y-2.5">
              {MODEL_INFO.map((m) => {
                const run = statusOf(m.id);
                const on = settings.enabledModels[m.id];
                const lastOn = on && enabledCount === 1;
                return (
                  <div key={m.id} className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: MODEL_COLORS[m.id] }} aria-hidden />
                      <span className="truncate text-[13px]">{shortName(m.id)}</span>
                      {run && run.status !== "ok" && run.status !== "disabled" ? (
                        <Badge variant="outline" className="block max-w-[150px] justify-start truncate text-left text-[10px]" title={run.reason ?? undefined}>
                          {run.reason}
                        </Badge>
                      ) : null}
                    </div>
                    {lastOn ? (
                      <Tooltip>
                        <TooltipTrigger render={<span tabIndex={0} />}>
                          <Switch checked disabled aria-label={`${m.name} (last enabled model)`} />
                        </TooltipTrigger>
                        <TooltipContent>At least one model must stay on.</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Switch checked={on} aria-label={`Enable ${m.name}`} onCheckedChange={(v) => set({ enabledModels: { ...settings.enabledModels, [m.id]: Boolean(v) } })} />
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
          <Separator />
          <Section title="Hyperparameters">
            <LabeledSlider label="Moving Average window k" value={settings.maWindow} min={GUARDRAILS.maWindow.min} max={GUARDRAILS.maWindow.max} onChange={(v) => set({ maWindow: v })} />
            <LabeledSlider label="Random Forest trees" value={settings.rfTrees} min={GUARDRAILS.rfTrees.min} max={GUARDRAILS.rfTrees.max} step={10} onChange={(v) => set({ rfTrees: v })} />
            <LabeledSlider label="Random Forest max depth" value={settings.rfMaxDepth} min={GUARDRAILS.rfMaxDepth.min} max={GUARDRAILS.rfMaxDepth.max} onChange={(v) => set({ rfMaxDepth: v })} />
            <LabeledSlider label="Boosting rounds" value={settings.gbmRounds} min={GUARDRAILS.gbmRounds.min} max={GUARDRAILS.gbmRounds.max} step={10} onChange={(v) => set({ gbmRounds: v })} />
            <LabeledSlider label="Boosting learning rate" value={settings.gbmLearningRate} min={GUARDRAILS.gbmLearningRate.min} max={GUARDRAILS.gbmLearningRate.max} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => set({ gbmLearningRate: Math.round(v * 100) / 100 })} />
            <LabeledSlider label="Boosting max depth" value={settings.gbmMaxDepth} min={GUARDRAILS.gbmMaxDepth.min} max={GUARDRAILS.gbmMaxDepth.max} onChange={(v) => set({ gbmMaxDepth: v })} />
            <NumberField label="Random seed" value={settings.seed} min={GUARDRAILS.seed.min} max={GUARDRAILS.seed.max} onCommit={(v) => set({ seed: v })} />
          </Section>
          <Separator />
          <Section title="Business">
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Unit cost" prefix="AED" value={settings.unitCost} min={GUARDRAILS.unitCost.min} max={GUARDRAILS.unitCost.max} decimals={2} step={0.05} onCommit={(v) => set({ unitCost: v })} />
              <NumberField label="Unit price" prefix="AED" value={settings.unitPrice} min={GUARDRAILS.unitPrice.min} max={GUARDRAILS.unitPrice.max} decimals={2} step={0.05} onCommit={(v) => set({ unitPrice: v })} />
            </div>
            {settings.unitPrice <= settings.unitCost ? <p className="text-[11px] text-warning">Price is not above cost, so lost margin from under-forecasting is zero.</p> : null}
            <div className="space-y-1">
              <p className="text-[13px] font-medium">Service level for safety stock</p>
              <SimpleSelect ariaLabel="Service level" value={String(settings.serviceLevel)} onChange={(v) => set({ serviceLevel: Number(v) as Settings["serviceLevel"] })} options={[{ value: "90", label: "90%" }, { value: "95", label: "95%" }, { value: "97.5", label: "97.5%" }, { value: "99", label: "99%" }]} />
            </div>
          </Section>
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
          <Button variant="outline" size="sm" onClick={resetSettings}>
            <RotateCcw className="size-3.5" aria-hidden />
            Reset controls
          </Button>
          <Button size="sm" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
