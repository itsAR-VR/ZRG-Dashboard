# Phase 87b — Server Action (refreshDraftAvailability)

## Focus
Add `refreshDraftAvailability` server action in `actions/message-actions.ts` that fetches fresh availability slots and updates the draft content while preserving prose.

## Inputs
- Phase 87a outputs: `extractAvailabilitySection`, `replaceAvailabilitySlotsInContent` from `lib/availability-slot-parser.ts`
- Existing utilities:
  - `getWorkspaceAvailabilitySlotsUtc` from `lib/availability-cache.ts`
  - `formatAvailabilitySlots` from `lib/availability-format.ts`
  - `selectDistributedAvailabilitySlots` from `lib/availability-distribution.ts`
  - `getWorkspaceSlotOfferCountsForRange`, `incrementWorkspaceSlotOffersBatch` from `lib/slot-offer-ledger.ts`
  - `ensureLeadTimezone` from `lib/timezone-inference.ts`
  - `getLeadQualificationAnswerState` from `lib/qualification-answer-extraction.ts`

## Work

### 1. Add function signature
```typescript
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
}>
```

### 2. Implementation steps
1. **Access check** via existing helper `requireLeadAccess(draft.leadId)` (preferred over duplicating `requireAuthUser()` + accessible client list)
2. **Fetch draft** with lead data (clientId, offeredSlots, snoozedUntil)
3. **Validate draft status** is "pending" (error if not)
4. **Parse the UI-provided content** using `extractAvailabilitySection(currentContent)`
   - Return error if no availability section found
5. **Determine availability source** (DEFAULT vs DIRECT_BOOK) via `getLeadQualificationAnswerState()`
6. **Fetch fresh slots** via `getWorkspaceAvailabilitySlotsUtc(clientId, { refreshIfStale: true, availabilitySource })`
   - Return error if no slots available
7. **Get lead timezone** via `ensureLeadTimezone()` (fallback to workspace timezone or `"UTC"`)
8. **Build exclusion set** from `lead.offeredSlots` (normalize to ISO) to avoid re-offering the same slots + ledger double-count
9. **Respect snooze**: if `lead.snoozedUntil > now`, pass as `startAfterUtc` into slot selection
10. **Get slot offer counts** and select distributed slots via `selectDistributedAvailabilitySlots()`
    - If selection returns empty (after exclusion), return “no new slots” error and do not modify DB
11. **Format slots** via `formatAvailabilitySlots({ mode: "explicit_tz" })`
12. **Replace availability** in `currentContent` via `replaceAvailabilitySlotsInContent()` (deterministic; no AI)
13. **Update database (transaction preferred):**
    - `AIDraft.content` with new content
    - `Lead.offeredSlots` with new slots JSON
14. **Increment slot offer counts** via `incrementWorkspaceSlotOffersBatch()`
15. **Call `revalidatePath("/")`** and return result

### 3. Error cases
| Case | Error message |
|------|---------------|
| Draft not found | "Draft not found" |
| No access to workspace | "Unauthorized" |
| Draft status != "pending" | "Can only refresh availability for pending drafts" |
| No availability section | "This draft doesn't contain availability times to refresh" |
| No slots from calendar | "No available time slots found. Check your calendar settings." |
| No new slots available (after exclusion) | "No new time slots available right now. Please try again later or adjust your calendar." |

### 4. Location in file
Add after existing `regenerateDraft` function (around line 1451) to keep draft-related actions together.

## Output
- Modified file: `actions/message-actions.ts`
- New export: `refreshDraftAvailability`

## Handoff
Phase 87c will import `refreshDraftAvailability` and wire it to a UI button in `action-station.tsx`.

## Output (Completed)
- Added `refreshDraftAvailability(draftId, currentContent)` in `actions/message-actions.ts` with deterministic slot replacement, exclusion of existing offers, and “no new slots” error handling.

## Handoff (Ready)
Proceed to Phase 87c: update the UI to call `refreshDraftAvailability(...)` with `composeMessage` and add the button/loading state.
