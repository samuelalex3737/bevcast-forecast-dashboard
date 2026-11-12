"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/lib/store/useAppStore";
import { askAnalyst, useSnapshot } from "@/lib/store/useAiAnalyst";
import { GroundedText } from "./GroundingBadge";
import { cn } from "@/lib/utils";

export function AskAnalyst() {
  const snapshot = useSnapshot();
  const chat = useAppStore((s) => s.chat);
  const push = useAppStore((s) => s.pushChat);
  const clear = useAppStore((s) => s.clearChat);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chat.length]);

  const region = snapshot?.regional_allocation[0]?.region;
  const suggestions = [
    "What happens if we skip the December promo?",
    "Why did this model beat the machine-learning models?",
    region ? `How much should we ship to ${region} next month?` : "How should we split stock across regions?",
    "How risky is the production plan if winter is colder than usual?",
  ];

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || !snapshot || busy) return;
    setQ("");
    push({ role: "user", content: text, at: Date.now(), snapshotId: snapshot.snapshot_id });
    setBusy(true);
    const history = chat.slice(-6).map((c) => ({ role: c.role, content: c.content.slice(0, 2000) }));
    const res = await askAnalyst(snapshot, text, history);
    push({ role: "assistant", content: res.answer, source: res.source, at: Date.now(), snapshotId: snapshot.snapshot_id });
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <Button key={s} size="sm" variant="outline" className="h-auto py-1.5 text-left whitespace-normal" onClick={() => void ask(s)} disabled={!snapshot || busy}>
            {s}
          </Button>
        ))}
      </div>
      <div className="max-h-[420px] min-h-32 space-y-3 overflow-y-auto rounded-xl border bg-muted/20 p-3" aria-live="polite">
        {chat.length === 0 ? <p className="py-6 text-center text-[13px] text-muted-foreground">Ask anything about the live forecast. Answers use only the numbers in the current snapshot.</p> : null}
        {chat.map((c, i) => (
          <div key={i} className={cn("flex gap-2", c.role === "user" && "flex-row-reverse")}>
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", c.role === "user" ? "bg-secondary" : "bg-brand text-brand-foreground")}>{c.role === "user" ? <User className="size-3.5" aria-hidden /> : <Bot className="size-3.5" aria-hidden />}</span>
            <div className={cn("max-w-[85%] rounded-xl px-3 py-2 text-[13.5px] leading-relaxed", c.role === "user" ? "bg-secondary" : "border bg-card")}>
              {c.role === "assistant" && snapshot ? <GroundedText text={c.content} payload={snapshot} /> : c.content}
              {c.role === "assistant" ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[10px]">{c.source === "llm" ? "LLM" : "Rule-based"}</Badge>
                  {c.snapshotId && snapshot && c.snapshotId !== snapshot.snapshot_id ? <Badge variant="outline" className="border-warning text-[10px] text-warning">older data</Badge> : null}
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {busy ? (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Analyst is thinking...
          </p>
        ) : null}
        <div ref={endRef} />
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
        }}
      >
        <Textarea
          aria-label="Ask the analyst a question"
          value={q}
          maxLength={500}
          rows={2}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(q);
            }
          }}
          placeholder="e.g. Which region is growing fastest?"
          className="min-h-10 flex-1 resize-none"
        />
        <Button type="submit" disabled={!q.trim() || !snapshot || busy} aria-label="Send question">
          <Send className="size-4" aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="icon" onClick={clear} disabled={chat.length === 0} aria-label="Clear conversation">
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </form>
    </div>
  );
}
