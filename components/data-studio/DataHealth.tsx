"use client";

import { CheckCircle2, Info, TriangleAlert, XCircle } from "lucide-react";
import type { EngineResult } from "@/lib/forecast";
import { useAppStore } from "@/lib/store/useAppStore";
import { cn } from "@/lib/utils";

const STYLE = {
  pass: { icon: CheckCircle2, cls: "bg-success-soft text-success", label: "Pass" },
  warn: { icon: TriangleAlert, cls: "bg-warning-soft text-warning", label: "Warn" },
  fail: { icon: XCircle, cls: "bg-danger-soft text-danger", label: "Fail" },
} as const;

export function DataHealth({ res }: { res: EngineResult }) {
  const notices = useAppStore((s) => s.ingestNotices);
  const info = notices.filter((n) => n.level === "info" && n.code !== "detect");
  return (
    <div className="space-y-3">
      <ul className="grid gap-2 md:grid-cols-2">
        {res.health.map((h) => {
          const s = STYLE[h.status];
          const Icon = s.icon;
          return (
            <li key={h.id} className="flex gap-2.5 rounded-lg border p-2.5">
              <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-semibold", s.cls)}>
                <Icon className="size-3.5" aria-hidden />
                {s.label}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium">{h.label}</p>
                <p className="text-[12px] leading-snug text-muted-foreground">{h.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {info.length ? (
        <details className="rounded-lg border bg-muted/30 p-2.5 text-[12px]">
          <summary className="flex cursor-pointer items-center gap-1.5 font-medium">
            <Info className="size-3.5" aria-hidden />
            Ingestion notes ({info.length})
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            {info.map((n, i) => (
              <li key={i}>{n.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
