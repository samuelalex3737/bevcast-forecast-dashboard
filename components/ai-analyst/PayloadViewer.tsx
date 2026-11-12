"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSnapshot } from "@/lib/store/useAiAnalyst";

/** Transparency: the exact JSON payload sent to the LLM. */
export function PayloadViewer() {
  const snapshot = useSnapshot();
  const [copied, setCopied] = useState(false);
  if (!snapshot) return <p className="text-sm text-muted-foreground">No snapshot yet.</p>;
  const json = JSON.stringify(snapshot, null, 2);
  const kb = (new TextEncoder().encode(JSON.stringify(snapshot)).length / 1024).toFixed(1);
  return (
    <details className="group rounded-xl border bg-card shadow-sm">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-3 text-[13px] font-medium">
        <span>Data sent to the LLM (snapshot {snapshot.snapshot_id}, {kb} KB)</span>
        <span className="text-xs text-muted-foreground group-open:hidden">Show JSON</span>
      </summary>
      <div className="relative border-t">
        <Button
          size="xs"
          variant="outline"
          className="absolute top-2 right-2"
          onClick={() => {
            navigator.clipboard?.writeText(json).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => setCopied(false),
            );
          }}
        >
          {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <pre className="max-h-[480px] overflow-auto p-3 font-mono text-[11.5px] leading-relaxed">{json}</pre>
      </div>
    </details>
  );
}
