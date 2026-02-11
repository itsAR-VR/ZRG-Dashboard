"use server";

import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/workspace-access";
import { accessibleLeadWhere } from "@/lib/workspace-access-filters";
import { getSupabaseUserEmailsByIds } from "@/lib/supabase/admin";
import { formatDurationMs } from "@/lib/business-hours";

export type LeadResponseTimingRow = {
  channel: string;
  inboundMessageId: string;
  inboundSentAtIso: string;

  setterSentByUserId: string | null;
  setterEmail: string | null;
  setterResponseSentAtIso: string | null;
  setterResponseMs: number | null;
  setterResponseFormatted: string | null;

  aiDraftId: string | null;
  aiResponseMessageId: string | null;
  aiResponseSentAtIso: string | null;
  aiResponseMs: number | null;
  aiResponseFormatted: string | null;

  aiChosenDelaySeconds: number | null;
  aiChosenDelayFormatted: string | null;
  aiActualDelaySeconds: number | null;
  aiActualDelayFormatted: string | null;

  aiScheduledRunAtIso: string | null;
  aiDriftMs: number | null;
  aiDriftFormatted: string | null;
};

function formatMsOrNull(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return formatDurationMs(ms);
}

function formatSecondsOrNull(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  return formatDurationMs(seconds * 1000);
}

export async function getLeadResponseTiming(
  leadId: string,
  opts?: { limit?: number }
): Promise<{ success: boolean; data?: LeadResponseTimingRow[]; error?: string }> {
  try {
    const user = await requireAuthUser();

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, ...accessibleLeadWhere(user.id) },
      select: { id: true },
    });
    if (!lead) {
      return { success: false, error: "Unauthorized" };
    }

    const limit = Math.max(1, Math.min(50, Math.trunc(opts?.limit ?? 10)));

    const events = await prisma.responseTimingEvent.findMany({
      where: { leadId },
      orderBy: { inboundSentAt: "desc" },
      take: limit,
      select: {
        channel: true,
        inboundMessageId: true,
        inboundSentAt: true,
        setterSentByUserId: true,
        setterResponseSentAt: true,
        setterResponseMs: true,
        aiDraftId: true,
        aiResponseMessageId: true,
        aiResponseSentAt: true,
        aiResponseMs: true,
        aiChosenDelaySeconds: true,
        aiActualDelaySeconds: true,
        aiScheduledRunAt: true,
      },
    });

    const setterIds = Array.from(
      new Set(events.map((e) => e.setterSentByUserId).filter((id): id is string => Boolean(id)))
    );
    const emailByUserId = await getSupabaseUserEmailsByIds(setterIds);

    const rows: LeadResponseTimingRow[] = events.map((e) => {
      const driftMs =
        e.aiResponseSentAt && e.aiScheduledRunAt
          ? e.aiResponseSentAt.getTime() - e.aiScheduledRunAt.getTime()
          : null;
      const driftFormatted = driftMs != null && Number.isFinite(driftMs)
        ? `${driftMs < 0 ? "-" : "+"}${formatDurationMs(Math.abs(driftMs))}`
        : null;

      return {
        channel: e.channel,
        inboundMessageId: e.inboundMessageId,
        inboundSentAtIso: e.inboundSentAt.toISOString(),
        setterSentByUserId: e.setterSentByUserId ?? null,
        setterEmail: e.setterSentByUserId ? emailByUserId.get(e.setterSentByUserId) ?? null : null,
        setterResponseSentAtIso: e.setterResponseSentAt ? e.setterResponseSentAt.toISOString() : null,
        setterResponseMs: e.setterResponseMs ?? null,
        setterResponseFormatted: formatMsOrNull(e.setterResponseMs),
        aiDraftId: e.aiDraftId ?? null,
        aiResponseMessageId: e.aiResponseMessageId ?? null,
        aiResponseSentAtIso: e.aiResponseSentAt ? e.aiResponseSentAt.toISOString() : null,
        aiResponseMs: e.aiResponseMs ?? null,
        aiResponseFormatted: formatMsOrNull(e.aiResponseMs),
        aiChosenDelaySeconds: e.aiChosenDelaySeconds ?? null,
        aiChosenDelayFormatted: formatSecondsOrNull(e.aiChosenDelaySeconds),
        aiActualDelaySeconds: e.aiActualDelaySeconds ?? null,
        aiActualDelayFormatted: formatSecondsOrNull(e.aiActualDelaySeconds),
        aiScheduledRunAtIso: e.aiScheduledRunAt ? e.aiScheduledRunAt.toISOString() : null,
        aiDriftMs: driftMs,
        aiDriftFormatted: driftFormatted,
      };
    });

    return { success: true, data: rows };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[getLeadResponseTiming] Failed:", message, error);
    if (message === "Not authenticated" || message === "Unauthorized") {
      return { success: false, error: message };
    }
    return { success: false, error: "Failed to fetch response timing" };
  }
}

