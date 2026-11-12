"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Droplets, FileDown, Moon, SlidersHorizontal, Sun } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppStore } from "@/lib/store/useAppStore";
import { LiveIndicator } from "./LiveIndicator";
import { cn } from "@/lib/utils";

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button variant="outline" size="icon" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </Button>
  );
}

export function Header() {
  const label = useAppStore((s) => s.datasetLabel);
  const kind = useAppStore((s) => s.datasetKind);
  const fileName = useAppStore((s) => s.fileName);
  const setOpen = useAppStore((s) => s.setControlPanelOpen);
  const badgeText = kind === "sample" ? "Sample (simulated)" : kind === "edited" ? label : `Uploaded: ${fileName ?? label}`;

  return (
    <header className="no-print sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-foreground shadow-sm">
            <Droplets className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-base leading-tight font-semibold tracking-tight">BevCast</h1>
            <p className="hidden truncate text-xs text-muted-foreground md:block">AI Demand Forecasting - New Flavored Water Launch</p>
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger render={<span tabIndex={0} className="hidden max-w-[220px] min-w-0 lg:inline-flex" />}>
            <Badge variant={kind === "sample" ? "secondary" : "outline"} className="max-w-full truncate">
              {badgeText}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{kind === "sample" ? "Simulated 12-month launch dataset for four UAE markets. Upload your own data in the Data Studio." : `Current dataset: ${label}`}</TooltipContent>
        </Tooltip>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <LiveIndicator />
          <Button variant="default" size="sm" className="h-8" onClick={() => setOpen(true)}>
            <SlidersHorizontal className="size-4" aria-hidden />
            <span className="hidden sm:inline">Control Panel</span>
            <span className="sr-only sm:hidden">Open control panel</span>
          </Button>
          <ThemeToggle />
          <Link href="/report" aria-label="Export report" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8")}>
            <FileDown className="size-4" aria-hidden />
            <span className="hidden sm:inline">Export report</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
