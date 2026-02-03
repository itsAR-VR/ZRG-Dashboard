# Phase 96c — Action Wiring + DB/Ledger Updates (UI + system)

## Focus
Replace the existing deterministic refresh logic with the Phase 96 AI engine, while keeping the public server action contract stable and updating DB/ledger only on success.

## Inputs
- Phase 96a: `buildRefreshCandidates` from `lib/availability-refresh-candidates.ts`
- Phase 96b: `refreshAvailabilityInDraftViaAi` from `lib/availability-refresh-ai.ts`
- Existing refresh entrypoints:
  - UI action: `actions/message-actions.ts:1460` — `refreshDraftAvailability(draftId, currentContent)`
  - System variant: `lib/draft-availability-refresh.ts:26` — `refreshDraftAvailabilitySystem(...)`
- Existing DB/ledger patterns:
  - `prisma.aIDraft.update`
  - `prisma.lead.update` setting `offeredSlots`
  - `incrementWorkspaceSlotOffersBatch` from `lib/slot-offer-ledger.ts`

## Pre-Flight Conflict Check (RED TEAM)

Before editing these files, re-read their current state:
- [ ] `actions/message-actions.ts` — check for Phase 95 changes to action cluster
- [ ] `lib/draft-availability-refresh.ts` — check git status shows it modified

## Work

### Step 1: Update UI action in `actions/message-actions.ts`

Replace the body of `refreshDraftAvailability` (starting ~line 1471) with:

```ts
export async function refreshDraftAvailability(
  draftId: string,
  currentContent: string
): Promise<{
  success: boolean;
  content?: string;
  draftId?: string;
  oldSlots?: string[];
  newSlots?: string[];
  error?: string;
}> {
  try {
    // 1. Fetch draft + lead
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
    await requireLeadAccess(draft.leadId);

    if (draft.status !== "pending") {
      return { success: false, error: "Can only refresh availability for pending drafts" };
    }

    // 2. Determine availability source
    const answerState = await getLeadQualificationAnswerState({
      leadId: draft.leadId,
      clientId: draft.lead.clientId,
    });
    const availabilitySource: AvailabilitySource =
      answerState.requiredQuestionIds.length > 0 && !answerState.hasAllRequiredAnswers
        ? "DIRECT_BOOK"
        : "DEFAULT";

    // 3. Build candidate slots
    const { candidates, labelToDatetimeUtcIso } = await buildRefreshCandidates({
      clientId: draft.lead.clientId,
      leadId: draft.leadId,
      leadOfferedSlotsJson: draft.lead.offeredSlots,
      snoozedUntil: draft.lead.snoozedUntil,
      availabilitySource,
    });

    if (candidates.length === 0) {
      return { success: false, error: "No available time slots found. Check your calendar settings." };
    }

    // 4. Get lead timezone
    const tzResult = await ensureLeadTimezone(draft.leadId);
    const leadTimeZone = tzResult.timezone || "UTC";

    // 5. Run AI refresh engine
    const refreshResult = await refreshAvailabilityInDraftViaAi({
      draft: currentContent,
      candidates,
      labelToDatetimeUtcIso,
      leadTimeZone,
      nowUtcIso: new Date().toISOString(),
    });

    if (!refreshResult.success) {
      if (refreshResult.error === "no_time_offers") {
        return {
          success: false,
          error: "No time options found in this draft to refresh. Regenerate to insert availability.",
        };
      }
      return { success: false, error: refreshResult.error || "Failed to refresh availability" };
    }

    // 6. If no replacements applied but times are valid, return success with no-op
    if (refreshResult.replacementsApplied.length === 0) {
      return {
        success: true,
        content: currentContent,
        draftId,
        oldSlots: [],
        newSlots: [],
      };
    }

    // 7. Collect new slot labels for DB update
    const newSlotLabels = refreshResult.replacementsApplied.map((r) => r.newText);
    const oldSlotLabels = refreshResult.replacementsApplied.map((r) => r.oldText);
    const offeredAtIso = new Date().toISOString();
    const offeredAt = new Date(offeredAtIso);

    // 8. Build new offeredSlots array
    const newOfferedSlots = newSlotLabels.map((label) => ({
      datetime: labelToDatetimeUtcIso[label],
      label,
      offeredAt: offeredAtIso,
      availabilitySource,
    }));

    // 9. Transactional DB update
    await prisma.$transaction([
      prisma.aIDraft.update({
        where: { id: draftId },
        data: { content: refreshResult.updatedDraft },
      }),
      prisma.lead.update({
        where: { id: draft.leadId },
        data: {
          offeredSlots: JSON.stringify(newOfferedSlots),
        },
      }),
    ]);

    // 10. Increment offer ledger
    await incrementWorkspaceSlotOffersBatch({
      clientId: draft.lead.clientId,
      slotUtcIsoList: newOfferedSlots.map((s) => s.datetime),
      offeredAt,
      availabilitySource,
    });

    // 11. Revalidate and return
    revalidatePath("/");

    return {
      success: true,
      content: refreshResult.updatedDraft,
      draftId,
      oldSlots: oldSlotLabels,
      newSlots: newSlotLabels,
    };
  } catch (error) {
    console.error("[refreshDraftAvailability] Failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
```

### Step 2: Update system action in `lib/draft-availability-refresh.ts`

Apply the same logic pattern but:
- Remove `requireLeadAccess` (system action bypasses auth)
- Remove `revalidatePath` (not applicable to system context)
- Keep the same return type for compatibility

### Step 3: Add imports

In both files, add:
```ts
import { buildRefreshCandidates } from "@/lib/availability-refresh-candidates";
import { refreshAvailabilityInDraftViaAi } from "@/lib/availability-refresh-ai";
```

### Step 4: Remove old deterministic logic

Delete or comment out the imports/usage of:
- `extractAvailabilitySection` (no longer needed for refresh)
- `replaceAvailabilitySlotsInContent` (replaced by AI engine)
- `selectDistributedAvailabilitySlots` (moved to candidate builder)
- `formatAvailabilitySlots` (moved to candidate builder)

Note: Keep `extractAvailabilitySection` import if used elsewhere in the file.

## Validation (RED TEAM)

- [ ] Verify return type matches existing action signature (no breaking changes to UI).
- [ ] Verify error messages are user-friendly (not raw AI errors).
- [ ] Verify `revalidatePath("/")` is called only in UI action.
- [ ] Verify DB transaction is atomic (both AIDraft + Lead update or neither).
- [ ] Verify ledger increment happens after successful transaction.
- [ ] Verify empty replacements case returns success (no-op, not error).

## Output
- Replaced deterministic refresh logic with AI-driven core:
  - Added `refreshDraftAvailabilityCore(...)` in `lib/draft-availability-refresh.ts` using `buildRefreshCandidates` + `refreshAvailabilityInDraftViaAi`.
  - `refreshDraftAvailabilitySystem(...)` now fetches the draft and delegates to the core helper (no auth, no revalidate).
  - Error mapping added: `no_time_offers` → user-friendly regen message; validation/max-pass errors → safe retry/regen copy.
  - New env cap: `OPENAI_AVAILABILITY_REFRESH_CANDIDATE_CAP` (default 50).
- `actions/message-actions.ts` now calls `refreshDraftAvailabilityCore(...)` after access check and revalidates on success.
- Removed deterministic availability-section parsing and slot-distribution logic from the UI action.

## Handoff
Phase 96d should add unit tests for the deterministic validation/apply layer and update the Refresh Availability toast/error messaging (if needed) plus manual QA steps.
