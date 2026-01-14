import "server-only";

import { InsightsWindowPreset } from "@prisma/client";

export type ResolvedInsightsWindow = {
  preset: InsightsWindowPreset;
  from: Date;
  to: Date;
};

function clampDateRange(from: Date, to: Date): { from: Date; to: Date } {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    const now = new Date();
    const fallbackFrom = new Date(now);
    fallbackFrom.setDate(fallbackFrom.getDate() - 7);
    return { from: fallbackFrom, to: now };
  }
  if (from >= to) {
    const newTo = new Date(to);
    const newFrom = new Date(newTo);
    newFrom.setDate(newFrom.getDate() - 7);
    return { from: newFrom, to: newTo };
  }
  return { from, to };
}

export function resolveInsightsWindow(opts: {
  preset: InsightsWindowPreset;
  windowFrom?: Date | null;
  windowTo?: Date | null;
  now?: Date;
}): ResolvedInsightsWindow {
  const now = opts.now ?? new Date();
  const to = new Date(now);

  if (opts.preset === "H24") {
    const from = new Date(to);
    from.setHours(from.getHours() - 24);
    return { preset: opts.preset, from, to };
  }

  if (opts.preset === "D30") {
    const from = new Date(to);
    from.setDate(from.getDate() - 30);
    return { preset: opts.preset, from, to };
  }

  if (opts.preset === "CUSTOM") {
    const from = opts.windowFrom ? new Date(opts.windowFrom) : new Date(new Date(to).setDate(to.getDate() - 7));
    const customTo = opts.windowTo ? new Date(opts.windowTo) : to;
    const clamped = clampDateRange(from, customTo);
    return { preset: opts.preset, from: clamped.from, to: clamped.to };
  }

  // Default D7
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  return { preset: "D7", from, to };
}

export function formatInsightsWindowLabel(win: ResolvedInsightsWindow): string {
  const label =
    win.preset === "H24"
      ? "Last 24 hours"
      : win.preset === "D30"
        ? "Last 30 days"
      : win.preset === "CUSTOM"
        ? "Custom range"
        : "Last 7 days";
  return `${label} (${win.from.toISOString().slice(0, 10)} → ${win.to.toISOString().slice(0, 10)})`;
}

export function buildInsightScopeKey(opts: {
  window: ResolvedInsightsWindow;
  campaignIds: string[];
  allCampaigns: boolean;
  campaignCap: number | null;
}): string {
  const from = opts.window.from.toISOString();
  const to = opts.window.to.toISOString();
  const campaigns =
    opts.allCampaigns
      ? `all(cap=${opts.campaignCap ?? 10})`
      : opts.campaignIds.length
        ? opts.campaignIds.join(",")
        : "workspace";
  return `preset=${opts.window.preset};from=${from};to=${to};campaigns=${campaigns}`;
}
