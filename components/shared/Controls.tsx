"use client";

import { useEffect, useId, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface Option {
  value: string;
  label: string;
}

export function SimpleSelect({ value, onChange, options, ariaLabel, className, disabled }: { value: string; onChange: (v: string) => void; options: Option[]; ariaLabel: string; className?: string; disabled?: boolean }) {
  return (
    <Select<string>
      value={value}
      items={options}
      disabled={disabled}
      onValueChange={(v) => {
        if (typeof v === "string") onChange(v);
      }}
    >
      <SelectTrigger aria-label={ariaLabel} className={cn("w-full min-w-0", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Slider with the current value, guardrails (min/max) and an accessible label. */
export function LabeledSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format = (v) => String(v),
  hint,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const safeMax = Math.max(min, max);
  return (
    <div className={cn("space-y-2", disabled && "opacity-60")}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        <span className="tabular rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold">{format(local)}</span>
      </div>
      <Slider
        id={id}
        aria-label={label}
        value={[Math.min(safeMax, Math.max(min, local))]}
        min={min}
        max={safeMax}
        step={step}
        disabled={disabled || safeMax === min}
        onValueChange={(v) => {
          const n = Array.isArray(v) ? v[0] : v;
          if (typeof n === "number") setLocal(n);
        }}
        onValueCommitted={(v) => {
          const n = Array.isArray(v) ? v[0] : v;
          if (typeof n === "number" && Number.isFinite(n)) onChange(Math.min(safeMax, Math.max(min, n)));
        }}
      />
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>min {format(min)}</span>
        {hint ? <span className="truncate px-2">{hint}</span> : null}
        <span>max {format(safeMax)}</span>
      </div>
    </div>
  );
}

/**
 * Numeric input that only accepts valid characters, clamps to [min, max] on commit (blur / Enter)
 * and never lets an invalid value reach the store.
 */
export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  decimals = 0,
  onCommit,
  prefix,
  className,
  compact,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
  onCommit: (v: number) => void;
  prefix?: string;
  className?: string;
  compact?: boolean;
}) {
  const id = useId();
  const show = (v: number | null) => (v === null || !Number.isFinite(v) ? "" : decimals > 0 ? String(Number(v.toFixed(decimals))) : String(Math.round(v)));
  const [text, setText] = useState(show(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);
  const pattern = decimals > 0 ? (min < 0 ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/) : min < 0 ? /^-?\d*$/ : /^\d*$/;
  const commit = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    if (raw.trim() === "" || !Number.isFinite(n)) {
      setText(show(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    const rounded = decimals > 0 ? Number(clamped.toFixed(decimals)) : Math.round(clamped);
    setText(show(rounded));
    if (rounded !== value) onCommit(rounded);
  };
  return (
    <div className={cn("space-y-1", className)}>
      {!compact ? (
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
      ) : null}
      <div className="relative">
        {prefix ? <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">{prefix}</span> : null}
        <Input
          id={id}
          aria-label={label}
          inputMode={decimals > 0 ? "decimal" : "numeric"}
          value={text}
          step={step}
          className={cn("tabular h-8", prefix && "pl-10")}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            const v = e.target.value.replace(",", ".");
            if (pattern.test(v)) setText(v);
          }}
          onBlur={(e) => {
            setFocused(false);
            commit(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setText(show(value));
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </div>
      {!compact ? (
        <p className="text-[11px] text-muted-foreground">
          {min} to {max}
        </p>
      ) : null}
    </div>
  );
}
