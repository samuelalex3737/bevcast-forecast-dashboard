"use client";

import { useRef, useState } from "react";
import { ClipboardPaste, Download, FileUp, Loader2, PlusCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { NumberField } from "@/components/shared/Controls";
import { ColumnMappingDialog } from "./ColumnMappingDialog";
import { useAppStore, SAMPLE_LABEL } from "@/lib/store/useAppStore";
import { ingestTable, parseTextTable, parseWorkbook, rowsToCsv, MAX_UPLOAD_BYTES } from "@/lib/data/ingest";
import { nextPeriodAfter } from "@/lib/data/clean";
import { formatPeriod } from "@/lib/data/parseDates";
import type { Cell, DataRow, IngestResult } from "@/lib/data/schema";
import { downloadText, yyyymmdd } from "@/lib/utils/download";
import { cn } from "@/lib/utils";

export function DataUploader() {
  const loadDataset = useAppStore((s) => s.loadDataset);
  const addRows = useAppStore((s) => s.addRows);
  const rows = useAppStore((s) => s.rows);
  const fileInput = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [mapping, setMapping] = useState<{ table: Cell[][]; result: IngestResult; name: string; kind: "uploaded" | "pasted" } | null>(null);

  const accept = (res: IngestResult, name: string, kind: "uploaded" | "pasted") => {
    loadDataset(res.rows, { kind, label: name, fileName: name, notices: res.notices, rejected: res.rejected });
    const warns = res.notices.filter((n) => n.level === "warn").length;
    const errs = res.rejected.length;
    toast.success(`Loaded ${res.rows.length} monthly rows from ${name}`, {
      description: `${res.stats.rawRows} input rows${res.frequency !== "monthly" ? `, ${res.frequency} data aggregated to monthly` : ""}${warns ? `, ${warns} warning(s)` : ""}${errs ? `, ${errs} row(s) rejected` : ""}. See Data Health for details.`,
    });
  };

  const handleTable = (table: Cell[][], name: string, kind: "uploaded" | "pasted") => {
    const res = ingestTable(table);
    if (res.ok && res.mappingConfident) {
      accept(res, name, kind);
      return true;
    }
    if (res.headers.length > 0 && res.preview.length > 0) {
      setMapping({ table, result: res, name, kind });
      return true;
    }
    toast.error("Could not read this data", { description: res.notices.find((n) => n.level === "error")?.message ?? "No rows found." });
    return false;
  };

  const onFile = async (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("File too large", { description: `${(file.size / 1024 / 1024).toFixed(1)} MB exceeds the 5 MB limit.` });
      return;
    }
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    if (!["csv", "tsv", "txt", "xlsx", "xls"].includes(ext)) {
      toast.error("Unsupported file type", { description: "Upload a .csv, .tsv, .txt, .xlsx or .xls file." });
      return;
    }
    setBusy(true);
    try {
      const table = ext === "xlsx" || ext === "xls" ? await parseWorkbook(await file.arrayBuffer()) : parseTextTable(await file.text());
      handleTable(table, file.name, "uploaded");
    } catch (e) {
      toast.error("Could not read the file", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const resetToSample = async () => {
    try {
      const r = await fetch("/data/bevcast_sample_sales.csv");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const res = ingestTable(parseTextTable(await r.text()));
      loadDataset(res.rows, { kind: "sample", label: SAMPLE_LABEL, notices: res.notices, rejected: res.rejected });
      toast.success("Sample dataset restored");
    } catch (e) {
      toast.error("Could not load the sample", { description: e instanceof Error ? e.message : String(e) });
    }
    setResetOpen(false);
  };

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a CSV or Excel file: drop it here or press Enter to browse"
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void onFile(f);
        }}
        className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors", drag ? "border-brand bg-brand-soft" : "border-border hover:border-brand/60 hover:bg-muted/40")}
      >
        {busy ? <Loader2 className="size-6 animate-spin text-brand" aria-hidden /> : <FileUp className="size-6 text-brand" aria-hidden />}
        <p className="text-sm font-medium">Drop a CSV or Excel file here, or click to browse</p>
        <p className="text-xs text-muted-foreground">Up to 5 MB. Long or wide layout, monthly, weekly or daily data, any common date format.</p>
        <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setPasteOpen(true)}>
          <ClipboardPaste className="size-3.5" aria-hidden />
          Paste data
        </Button>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)} disabled={rows.length === 0}>
          <PlusCircle className="size-3.5" aria-hidden />
          Add next month&apos;s actual
        </Button>
        <Button size="sm" variant="outline" onClick={() => (downloadText(`bevcast_dataset_${yyyymmdd()}.csv`, rowsToCsv(rows)) ? toast.success("Dataset downloaded") : toast.error("Download failed"))} disabled={rows.length === 0}>
          <Download className="size-3.5" aria-hidden />
          Download dataset
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setResetOpen(true)}>
          <RotateCcw className="size-3.5" aria-hidden />
          Reset to sample
        </Button>
      </div>

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Paste data</DialogTitle>
            <DialogDescription>Copy cells from Excel or Google Sheets (including the header row) and paste them below. Tabs, commas and semicolons are detected automatically.</DialogDescription>
          </DialogHeader>
          <Textarea aria-label="Pasted data" value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={10} placeholder={"month\tregion\tunits\n2025-11\tDubai\t6450"} className="font-mono text-xs" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pasteText.trim().length === 0}
              onClick={() => {
                if (handleTable(parseTextTable(pasteText), "Pasted data", "pasted")) {
                  setPasteOpen(false);
                  setPasteText("");
                }
              }}
            >
              Load pasted data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset to the sample dataset?</DialogTitle>
            <DialogDescription>This replaces the current data, including any edits or uploads, with the simulated 12-month sample. Download your data first if you want to keep it.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void resetToSample()}>
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddMonthDialog open={addOpen} onOpenChange={setAddOpen} rows={rows} onAdd={(newRows) => {
        addRows(newRows);
        toast.success(`Added ${formatPeriod(newRows[0].period, "long")} actuals`, { description: "All models are retraining on the extended series." });
      }} />

      <ColumnMappingDialog
        open={mapping !== null}
        onOpenChange={(o) => !o && setMapping(null)}
        table={mapping?.table ?? []}
        initial={mapping?.result ?? null}
        onApply={(res) => {
          if (mapping) accept(res, mapping.name, mapping.kind);
          setMapping(null);
        }}
      />
    </div>
  );
}

function AddMonthDialog({ open, onOpenChange, rows, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; rows: DataRow[]; onAdd: (rows: DataRow[]) => void }) {
  const period = nextPeriodAfter(rows);
  const regions = Array.from(new Set(rows.map((r) => r.region)));
  const hasTemp = rows.some((r) => r.temp !== null);
  const hasPromo = rows.some((r) => r.promo !== null);
  const [units, setUnits] = useState<Record<string, number | null>>({});
  const [temp, setTemp] = useState<number | null>(null);
  const [promo, setPromo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customPeriod, setCustomPeriod] = useState<string>("");

  const target = customPeriod || period || "";
  const submit = () => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(target)) return setError("Month must be in YYYY-MM format.");
    if (rows.some((r) => r.period === target)) return setError(`${formatPeriod(target, "long")} already exists. Edit it in the grid instead.`);
    const missing = regions.filter((r) => units[r] === null || units[r] === undefined);
    if (missing.length) return setError(`Enter units for ${missing.join(", ")}.`);
    onAdd(regions.map((region) => ({ period: target, region, units: units[region] as number, temp: hasTemp ? temp : null, promo: hasPromo ? (promo ? 1 : 0) : null })));
    setUnits({});
    setTemp(null);
    setPromo(false);
    setError(null);
    setCustomPeriod("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add next month&apos;s actual</DialogTitle>
          <DialogDescription>Append a new month of real sales. Every model retrains instantly and the AI interpretation regenerates on the new data.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="add-period" className="text-[13px] font-medium">
              Month (YYYY-MM)
            </label>
            <Input id="add-period" value={target} onChange={(e) => setCustomPeriod(e.target.value.trim())} className="h-8" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {regions.map((r) => (
              <NumberField key={r} label={`${r} units`} value={units[r] ?? null} min={0} max={100000000} onCommit={(v) => setUnits((u) => ({ ...u, [r]: v }))} />
            ))}
          </div>
          {hasTemp ? <NumberField label="Average temperature (°C)" value={temp} min={-20} max={55} decimals={1} onCommit={setTemp} /> : null}
          {hasPromo ? (
            <label className="flex items-center gap-2 text-[13px]">
              <Switch checked={promo} onCheckedChange={(v) => setPromo(Boolean(v))} aria-label="Promo running this month" />
              Promo running this month
            </label>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>Add month and retrain</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
