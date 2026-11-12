"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SimpleSelect } from "@/components/shared/Controls";
import type { Cell, ColumnMapping, DataLayout, IngestResult } from "@/lib/data/schema";
import { ingestTable } from "@/lib/data/ingest";

const FIELDS: { key: keyof ColumnMapping; label: string; required: boolean; help: string }[] = [
  { key: "period", label: "Date / period", required: true, help: "Month, date or period column" },
  { key: "target", label: "Sales (target)", required: true, help: "Units, sales, quantity or revenue" },
  { key: "region", label: "Region", required: false, help: "Market, city, store (optional)" },
  { key: "temp", label: "Temperature", required: false, help: "Average temperature (optional)" },
  { key: "promo", label: "Promo flag", required: false, help: "1/0, yes/no (optional)" },
];

export function ColumnMappingDialog({
  open,
  onOpenChange,
  table,
  initial,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  table: Cell[][];
  initial: IngestResult | null;
  onApply: (result: IngestResult) => void;
}) {
  const [mapping, setMapping] = useState<ColumnMapping>({ period: null, target: null, region: null, temp: null, promo: null });
  const [layout, setLayout] = useState<DataLayout>("long");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      setMapping(initial.mapping);
      setLayout(initial.layout === "wide-periods-as-columns" ? "long" : initial.layout);
      setError(null);
    }
  }, [initial]);

  const headers = initial?.headers ?? [];
  const options = [{ value: "none", label: "None" }, ...headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` }))];

  const apply = () => {
    if (mapping.period === null) return setError("Choose the date / period column.");
    if (layout === "long" && mapping.target === null) return setError("Choose the sales column.");
    const used = Object.values(mapping).filter((v): v is number => v !== null);
    if (new Set(used).size !== used.length) return setError("Each column can only be mapped once.");
    const res = ingestTable(table, { mapping, layout });
    if (!res.ok) return setError(res.notices.find((n) => n.level === "error")?.message ?? "These columns did not produce usable rows.");
    onApply(res);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Map your columns</DialogTitle>
          <DialogDescription>Automatic detection was not certain. Confirm which column holds each field; optional fields can be left as None.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-[13px] font-medium">Layout</p>
            <SimpleSelect
              ariaLabel="Data layout"
              value={layout}
              onChange={(v) => setLayout(v === "wide-regions-as-columns" ? "wide-regions-as-columns" : "long")}
              options={[
                { value: "long", label: "Long: one row per month (and region)" },
                { value: "wide-regions-as-columns", label: "Wide: one numeric column per region" },
              ]}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.filter((f) => !(layout === "wide-regions-as-columns" && (f.key === "target" || f.key === "region"))).map((f) => (
              <div key={f.key} className="space-y-1">
                <p className="text-[13px] font-medium">
                  {f.label}
                  {f.required ? <span className="text-danger"> *</span> : null}
                </p>
                <SimpleSelect ariaLabel={f.label} value={mapping[f.key] === null ? "none" : String(mapping[f.key])} onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === "none" ? null : Number(v) }))} options={options} />
                <p className="text-[11px] text-muted-foreground">{f.help}</p>
              </div>
            ))}
          </div>
          {layout === "wide-regions-as-columns" ? <p className="text-[12px] text-muted-foreground">Every column not mapped above is treated as one region&apos;s sales.</p> : null}
          <div>
            <p className="mb-1.5 text-[13px] font-medium">Preview (first 5 rows)</p>
            <div className="overflow-x-auto rounded-md border">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    {headers.map((h, i) => (
                      <TableHead key={i} className="whitespace-nowrap">
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(initial?.preview ?? []).map((r, i) => (
                    <TableRow key={i}>
                      {headers.map((_, j) => (
                        <TableCell key={j} className="whitespace-nowrap">
                          {r[j] ?? ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
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
          <Button onClick={apply}>Apply mapping</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
