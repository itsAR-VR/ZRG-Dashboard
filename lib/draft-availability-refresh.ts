import "server-only";

import { prisma } from "@/lib/prisma";
import { incrementWorkspaceSlotOffersBatch } from "@/lib/slot-offer-ledger";
import { ensureLeadTimezone } from "@/lib/timezone-inference";
import { getLeadQualificationAnswerState } from "@/lib/qualification-answer-extraction";
import { buildRefreshCandidates, detectPreferredTimezoneToken } from "@/lib/availability-refresh-candidates";
import { refreshAvailabilityInDraftViaAi } from "@/lib/availability-refresh-ai";
import { computeRefreshedOfferedSlots } from "@/lib/offered-slots-refresh";
import type { AvailabilitySource } from "@prisma/client";

export type RefreshDraftAvailabilityResult = {
  success: boolean;
  content?: string;
  draftId?: string;
  oldSlots?: string[];
  newSlots?: string[];
  error?: string;
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function mapRefreshError(error: string): string {
  if (error === "no_time_offers") {
    return "No time options found in this draft to refresh. Regenerate to insert availability.";
  }
  if (error.startsWith("validation_failed:")) {
    return "Could not safely refresh availability. Please regenerate the draft.";
  }
  if (error === "max_passes_exceeded") {
    return "Refresh took too long. Please regenerate the draft.";
  }
  return "Failed to refresh availability. Please try again.";
}

export async function refreshDraftAvailabilityCore(opts: {
  draft: {
    id: string;
    status: string;
    leadId: string;
    lead: {
      id: string;
      clientId: string;
      offeredSlots: string | null;
      snoozedUntil: Date | null;
    };
  };
  currentContent: string;
}): Promise<RefreshDraftAvailabilityResult> {
  const { draft, currentContent } = opts;

  if (draft.status !== "pending") {
    return { success: false, error: "Can only refresh availability for pending drafts" };
  }

  const answerState = await getLeadQualificationAnswerState({ leadId: draft.leadId, clientId: draft.lead.clientId });
  const requestedAvailabilitySource: AvailabilitySource =
    answerState.requiredQuestionIds.length > 0 && !answerState.hasAllRequiredAnswers ? "DIRECT_BOOK" : "DEFAULT";

  const preferredToken = detectPreferredTimezoneToken(currentContent);
  const tzResult = await ensureLeadTimezone(draft.leadId);
  const timeZone = tzResult.timezone || "UTC";

  const candidateCap = parsePositiveInt(process.env.OPENAI_AVAILABILITY_REFRESH_CANDIDATE_CAP, 50);
  const candidatesResult = await buildRefreshCandidates({
    clientId: draft.lead.clientId,
    leadId: draft.leadId,
    leadOfferedSlotsJson: draft.lead.offeredSlots,
    snoozedUntil: draft.lead.snoozedUntil,
    availabilitySource: requestedAvailabilitySource,
    candidateCap,
    preferredTimeZoneToken: preferredToken,
    timeZoneOverride: timeZone,
  });

  if (candidatesResult.candidates.length === 0) {
    return { success: false, error: "No available time slots found. Check your calendar settings." };
  }

  const offeredAtIso = new Date().toISOString();
  const refreshResult = await refreshAvailabilityInDraftViaAi({
    clientId: draft.lead.clientId,
    leadId: draft.leadId,
    draft: currentContent,
    candidates: candidatesResult.candidates,
    labelToDatetimeUtcIso: candidatesResult.labelToDatetimeUtcIso,
    leadTimeZone: candidatesResult.timeZone,
    nowUtcIso: offeredAtIso,
  });

  if (!refreshResult.success) {
    return { success: false, error: mapRefreshError(refreshResult.error) };
  }

  if (refreshResult.replacementsApplied.length === 0) {
    return {
      success: true,
      content: currentContent,
      draftId: draft.id,
      oldSlots: [],
      newSlots: [],
    };
  }

  const newSlots = refreshResult.replacementsApplied.map((r) => r.newText);
  const oldSlots = refreshResult.replacementsApplied.map((r) => r.oldText);
  const slotUtcIsoList: string[] = [];
  for (const label of newSlots) {
    const iso = candidatesResult.labelToDatetimeUtcIso[label];
    if (!iso) {
      return { success: false, error: "Failed to resolve refreshed slot times. Please try again." };
    }
    slotUtcIsoList.push(iso);
  }

  const updatedOfferedSlots = computeRefreshedOfferedSlots({
    existingOfferedSlotsJson: draft.lead.offeredSlots,
    updatedDraft: refreshResult.updatedDraft,
    replacementsApplied: refreshResult.replacementsApplied,
    labelToDatetimeUtcIso: candidatesResult.labelToDatetimeUtcIso,
    offeredAtIso,
    availabilitySource: candidatesResult.availabilitySource,
  });

  await prisma.$transaction([
    prisma.aIDraft.update({
      where: { id: draft.id },
      data: { content: refreshResult.updatedDraft },
    }),
    prisma.lead.update({
      where: { id: draft.leadId },
      data: {
        offeredSlots: updatedOfferedSlots.length > 0 ? JSON.stringify(updatedOfferedSlots) : null,
      },
    }),
  ]);

  await incrementWorkspaceSlotOffersBatch({
    clientId: draft.lead.clientId,
    slotUtcIsoList,
    offeredAt: new Date(offeredAtIso),
    availabilitySource: candidatesResult.availabilitySource,
  });

  return {
    success: true,
    content: refreshResult.updatedDraft,
    draftId: draft.id,
    oldSlots,
    newSlots,
  };
}

/**
 * System version of refreshDraftAvailability for use in CLI scripts and background jobs.
 * Does not require auth or call revalidatePath.
 */
export async function refreshDraftAvailabilitySystem(
  draftId: string,
  currentContent: string
): Promise<RefreshDraftAvailabilityResult> {
  try {
    const draft = await prisma.aIDraft.findUnique({
      where: { id: draftId },
      select: {
        id: true,
        status: true,
        leadId: true,
        lead: {
          select: {
            id: true,
            clientId: true,
            offeredSlots: true,
            snoozedUntil: true,
          },
        },
      },
    });

    if (!draft) return { success: false, error: "Draft not found" };

    return await refreshDraftAvailabilityCore({ draft, currentContent });
  } catch (error) {
    console.error("[refreshDraftAvailabilitySystem] Failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
