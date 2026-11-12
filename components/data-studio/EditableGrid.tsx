"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, PencilLine, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SimpleSelect, NumberField } from "@/components/shared/Controls";
import { useAppStore } from "@/lib/store/useAppStore";
import { PERIOD_REGEX, type DataRow } from "@/lib/data/schema";
import { formatPeriod, addMonths } from "@/lib/data/parseDates";
import { cn } from "@/lib/utils";

const PAGE = 24;

/** Number cell that allows an empty value (treated as a missing month). */
function GridNumber({ value, onCommit, min, max, decimals = 0, label }: { value: number | null; onCommit: (v: number | null) => void; min: number; max: number; decimals?: number; label: string }) {
  const show = (v: number | null) => (v === null ? "" : decimals ? String(v) : String(Math.round(v)));
  const [text, setText] = useState(show(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focus]);
  const commit = (raw: string) => {
    const t = raw.replace(/,/g, "").trim();
    if (t === "") {
      if (value !== null) onCommit(null);
      return;
    }
    const n = Number(t);
    if (!Number.isFinite(n)) return setText(show(value));
    if (n < min || n > max) {
      toast.error(`${label}: value must be between ${min} and ${max}`);
      return setText(show(value));
    }
    const r = decimals ? Number(n.toFixed(decimals)) : Math.round(n);
    if (r !== value) onCommit(r);
    setText(show(r));
  };
  return (
    <Input
      aria-label={label}
      inputMode={decimals ? "decimal" : "numeric"}
      value={text}
      placeholder="blank"
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        setFocus(false);
        commit(e.currentTarget.value);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      onChange={(e) => {
        const v = e.target.value;
        if (/^-?[\d,]*\.?\d*$/.test(v)) setText(v);
      }}
      className={cn("tabular h-7 w-24 px-2 text-right text-[13px]", value === null && "border-warning")}
    />
  );
}

function TextCell({ value, onCommit, validate, label, className }: { value: string; onCommit: (v: string) => void; validate: (v: string) => string | null; label: string; className?: string }) {
  const [text, setText] = useState(value);
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(value);
  }, [value, focus]);
  return (
    <Input
      aria-label={label}
      value={text}
      onFocus={() => setFocus(true)}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      onBlur={(e) => {
        setFocus(false);
        const v = e.currentTarget.value.trim();
        if (v === value) return;
        const err = validate(v);
        if (err) {
          toast.error(err);
          setText(value);
          return;
        }
        onCommit(v);
      }}
      className={cn("h-7 px-2 text-[13px]", className)}
    />
  );
}

export function EditableGrid() {
  const rows = useAppStore((s) => s.rows);
  const updateRow = useAppStore((s) => s.updateRow);
  const deleteRow = useAppStore((s) => s.deleteRow);
  const deletePeriod = useAppStore((s) => s.deletePeriod);
  const addRow = useAppStore((s) => s.addRow);
  const renameRegion = useAppStore((s) => s.renameRegion);
  const outlierList = useAppStore((s) => s.result?.diagnostics.outlierPeriods);
  const outliers = outlierList ?? [];
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("all");
  const [regionDialog, setRegionDialog] = useState<"add" | "rename" | null>(null);

  const regions = useMemo(() => Array.from(new Set(rows.map((r) => r.region))), [rows]);
  const periods = useMemo(() => Array.from(new Set(rows.map((r) => r.period))).sort(), [rows]);
  const hasTemp = rows.some((r) => r.temp !== null);
  const hasPromo = rows.some((r) => r.promo !== null);
  const indexed = rows.map((r, i) => ({ r, i })).filter(({ r }) => filter === "all" || r.region === filter);
  const pages = Math.max(1, Math.ceil(indexed.length / PAGE));
  const safePage = Math.min(page, pages - 1);
  const view = indexed.slice(safePage * PAGE, safePage * PAGE + PAGE);
  const outlierSet = new Set(outliers.map((o) => o.period));
  const [delPeriod, setDelPeriod] = useState<string>("");

  const addBlankRow = () => {
    const last = periods[periods.length - 1];
    const region = filter !== "all" ? filter : regions[0] ?? "All Markets";
    if (!last) return;
    const next = addMonths(last, 1);
    const ref = rows.find((r) => r.period === last && r.region === region);
    addRow({ period: next, region, units: ref?.units ?? 0, temp: hasTemp ? ref?.temp ?? null : null, promo: hasPromo ? 0 : null });
    setPage(Math.ceil((indexed.length + 1) / PAGE) - 1);
    toast.success(`Added ${region} ${formatPeriod(next)} (copied last value, edit as needed)`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-48">
          <SimpleSelect ariaLabel="Filter grid by region" value={filter} onChange={(v) => { setFilter(v); setPage(0); }} options={[{ value: "all", label: "All regions" }, ...regions.map((r) => ({ value: r, label: r }))]} />
        </div>
        <Button size="sm" variant="outline" onClick={addBlankRow} disabled={!rows.length}>
          <Plus className="size-3.5" aria-hidden />
          Add month row
        </Button>
        <Button size="sm" variant="outline" onClick={() => setRegionDialog("add")} disabled={!rows.length}>
          <Plus className="size-3.5" aria-hidden />
          Add region
        </Button>
        <Button size="sm" variant="outline" onClick={() => setRegionDialog("rename")} disabled={!rows.length}>
          <PencilLine className="size-3.5" aria-hidden />
          Rename region
        </Button>
        <div className="flex items-center gap-1.5">
          <div className="w-36">
            <SimpleSelect ariaLabel="Month to delete" value={delPeriod || "none"} onChange={(v) => setDelPeriod(v === "none" ? "" : v)} options={[{ value: "none", label: "Delete a month..." }, ...periods.map((p) => ({ value: p, label: formatPeriod(p) }))]} />
          </div>
          <Button
            size="sm"
            variant="destructive"
            disabled={!delPeriod}
            onClick={() => {
              deletePeriod(delPeriod);
              toast.success(`Deleted ${formatPeriod(delPeriod, "long")} for all regions`, { description: "The gap is detected and handled in preprocessing." });
              setDelPeriod("");
            }}
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-28">Month</TableHead>
              <TableHead>Region</TableHead>
              <TableHead className="text-right">Units</TableHead>
              {hasTemp ? <TableHead className="text-right">Temp °C</TableHead> : null}
              {hasPromo ? <TableHead>Promo</TableHead> : null}
              <TableHead className="w-10"><span className="sr-only">Delete</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.map(({ r, i }) => (
              <TableRow key={`${i}-${r.period}-${r.region}`} className={cn(outlierSet.has(r.period) && "bg-warning-soft/50")}>
                <TableCell>
                  <TextCell label={`Month for row ${i + 1}`} value={r.period} validate={(v) => (PERIOD_REGEX.test(v) ? null : "Month must be YYYY-MM, e.g. 2026-03")} onCommit={(v) => updateRow(i, { period: v })} className="w-24 font-mono" />
                </TableCell>
                <TableCell>
                  <TextCell label={`Region for row ${i + 1}`} value={r.region} validate={(v) => (v.length === 0 ? "Region cannot be empty" : v.length > 80 ? "Region name is too long" : null)} onCommit={(v) => updateRow(i, { region: v })} className="min-w-36" />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end">
                    <GridNumber label={`Units for ${r.region} ${r.period}`} value={r.units} min={0} max={1e9} onCommit={(v) => updateRow(i, { units: v })} />
                  </div>
                </TableCell>
                {hasTemp ? (
                  <TableCell className="text-right">
                    <div className="flex justify-end">
                      <GridNumber label={`Temperature for ${r.region} ${r.period}`} value={r.temp} min={-60} max={70} decimals={1} onCommit={(v) => updateRow(i, { temp: v })} />
                    </div>
                  </TableCell>
                ) : null}
                {hasPromo ? (
                  <TableCell>
                    <Switch checked={r.promo === 1} onCheckedChange={(v) => updateRow(i, { promo: v ? 1 : 0 })} aria-label={`Promo for ${r.region} ${r.period}`} />
                  </TableCell>
                ) : null}
                <TableCell>
                  <Button size="icon-xs" variant="ghost" aria-label={`Delete row ${r.region} ${r.period}`} onClick={() => deleteRow(i)}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {indexed.length} row(s). Blank units are treated as missing months. Rows highlighted amber are flagged outliers.
        </span>
        <div className="flex items-center gap-1">
          <Button size="icon-xs" variant="outline" aria-label="Previous page" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            <ChevronLeft className="size-3.5" aria-hidden />
          </Button>
          <span className="tabular px-1">
            {safePage + 1} / {pages}
          </span>
          <Button size="icon-xs" variant="outline" aria-label="Next page" disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)}>
            <ChevronRight className="size-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <RegionDialog
        mode={regionDialog}
        regions={regions}
        lastPeriod={periods[periods.length - 1] ?? null}
        onClose={() => setRegionDialog(null)}
        onRename={(from, to) => {
          renameRegion(from, to);
          toast.success(`Renamed ${from} to ${to}`);
        }}
        onAdd={(row) => {
          addRow(row);
          toast.success(`Added region ${row.region}`, { description: "Earlier months are treated as zero sales (late launch)." });
        }}
        hasPromo={hasPromo}
      />
    </div>
  );
}

function RegionDialog({ mode, regions, lastPeriod, onClose, onRename, onAdd, hasPromo }: { mode: "add" | "rename" | null; regions: string[]; lastPeriod: string | null; onClose: () => void; onRename: (from: string, to: string) => void; onAdd: (row: DataRow) => void; hasPromo: boolean }) {
  const [from, setFrom] = useState(regions[0] ?? "");
  const [name, setName] = useState("");
  const [units, setUnits] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    setName("");
    setUnits(null);
    setFrom(regions[0] ?? "");
  }, [mode, regions]);

  const submit = () => {
    const n = name.trim();
    if (!n) return setError("Enter a region name.");
    if (n.length > 80) return setError("Region name is too long.");
    if (mode === "rename") {
      onRename(from, n);
      return onClose();
    }
    if (regions.includes(n)) return setError(`${n} already exists.`);
    if (!lastPeriod) return setError("Add data first.");
    if (units === null) return setError(`Enter units for ${formatPeriod(lastPeriod)}.`);
    onAdd({ period: lastPeriod, region: n, units, temp: null, promo: hasPromo ? 0 : null });
    onClose();
  };

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "rename" ? "Rename a region" : "Add a region"}</DialogTitle>
          <DialogDescription>{mode === "rename" ? "Renaming to an existing region merges the two (duplicates are summed and flagged)." : `The new region starts in ${lastPeriod ? formatPeriod(lastPeriod, "long") : "the last month"}; add more months in the grid.`}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {mode === "rename" ? (
            <div className="space-y-1">
              <p className="text-[13px] font-medium">Region</p>
              <SimpleSelect ariaLabel="Region to rename" value={from} onChange={setFrom} options={regions.map((r) => ({ value: r, label: r }))} />
            </div>
          ) : null}
          <div className="space-y-1">
            <label htmlFor="region-name" className="text-[13px] font-medium">
              {mode === "rename" ? "New name" : "Region name"}
            </label>
            <Input id="region-name" value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
          </div>
          {mode === "add" ? <NumberField label={`Units in ${lastPeriod ? formatPeriod(lastPeriod) : "last month"}`} value={units} min={0} max={1e9} onCommit={setUnits} /> : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>{mode === "rename" ? "Rename" : "Add region"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
