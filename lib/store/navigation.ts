"use client";

import { useAppStore, type TabId } from "./useAppStore";

/** Switch tab, then scroll a panel into view once it has rendered. */
export function goTo(tab: TabId, anchor?: string) {
  useAppStore.getState().setActiveTab(tab);
  if (!anchor || typeof window === "undefined") return;
  let tries = 0;
  const tick = () => {
    const el = document.getElementById(anchor);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (tries++ < 20) window.setTimeout(tick, 50);
  };
  window.setTimeout(tick, 30);
}
