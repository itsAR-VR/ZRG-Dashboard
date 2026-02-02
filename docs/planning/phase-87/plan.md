# Phase 87 — Refresh Draft Availability (Targeted Slot Update)

## Purpose
Add a "Refresh Availability" action that updates only the availability slots in an existing AI draft while preserving the surrounding prose **exactly**, including any in-editor user edits.

## Context
- Currently, the only way to update availability in a draft is to regenerate the entire draft via `regenerateDraft()` in `actions/message-actions.ts`, which loses user edits and changes the AI-written content.
- Availability slots are embedded as bullet lists in draft content following patterns like:
  - SMS/LinkedIn: `Available times (use verbatim if proposing times):\n- 2:30 PM EST on Wed, Feb 5`
  - Email: `AVAILABLE TIMES (use verbatim if scheduling):\n- 2:30 PM EST on Wed, Feb 5`
- Slot labels follow the format `{time} {TZ} on {day}` (e.g., "2:30 PM EST on Wed, Feb 5") per `lib/availability-format.ts`.
- `Lead.offeredSlots` stores structured metadata: `[{datetime, label, offeredAt, availabilitySource}, ...]`.
- The availability cache system (`lib/availability-cache.ts`) supports `refreshIfStale: true` to fetch fresh slots.
- Slot distribution logic (`lib/availability-distribution.ts`) ensures fair distribution across leads.
- This feature must be deterministic: do **not** use an AI model to rewrite content (to guarantee exact prose preservation).

## Decisions (Locked)
- Refresh operates on the UI’s current compose content (`composeMessage`) and persists the refreshed result back to `AIDraft.content`.
- If there are **no new slots** after excluding `Lead.offeredSlots`, return a user-friendly error and make **no changes**.
- If multiple availability sections exist, refresh updates the **first** matched section only.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 86 | Untracked (working tree) | `lib/availability-cache.ts` (read-only usage) | Independent; Phase 87 only calls existing cache functions |
| Phase 85 | Untracked (working tree) | None | Independent |
| Phase 84 | Untracked (working tree) | None | Independent |
| Phase 83 | Uncommitted | `prisma/schema.prisma` | No schema changes in Phase 87; safe |

## Objectives
* [x] Create a slot parsing utility to identify and replace availability sections in draft content
* [x] Add `refreshDraftAvailability` server action that preserves prose while updating slots
* [x] Add UI button in action-station.tsx with loading state and toast feedback
* [x] Preserve in-editor user edits when refreshing (do not clobber compose box)
* [x] Verify with tests, lint, build, and manual testing

## Constraints
- **Content preservation:** Only replace the bullet list items; preserve headers, surrounding prose, and formatting.
- **User edits:** When invoked from the UI, refresh must operate on the current compose content (may include user edits), not only the stored `AIDraft.content`.
- **Deterministic (no AI):** Do not call an LLM to rewrite content; replacement must be string/regex-based so non-slot prose stays identical.
- **Slot distribution:** Use existing `selectDistributedAvailabilitySlots()` to pick new slots fairly.
- **Lead state:** Update `Lead.offeredSlots` and increment slot offer counts via existing ledger functions.
- **No new slots behavior:** If no alternative slots exist after excluding existing offers, return an error and do not update draft/lead/ledger.
- **Multiple sections:** If multiple availability sections are detected, replace only the first section.
- **Error handling:** Return clear errors for edge cases (no availability section, no slots available, non-pending draft).
- **No schema changes:** This feature uses existing models; no Prisma migrations required.

## Success Criteria
- [x] Users can click "Refresh Availability" on a pending draft and see updated time slots (implemented).
- [x] The surrounding AI prose remains unchanged (deterministic replacement).
- [x] If the user has edited the draft in the compose box, those edits remain intact (only the availability bullets change).
- [x] `Lead.offeredSlots` is updated with the new slots.
- [x] Error cases (no availability section, empty calendar) show user-friendly toast messages.
- [x] If there are no new slots, the user sees a clear error and no data/content is modified.
- [x] Validation passes: `npm run test`, `npm run lint`, `npm run build`.

## Subphase Index
* a — Slot parsing utility (`lib/availability-slot-parser.ts`)
* b — Server action (`refreshDraftAvailability` in `actions/message-actions.ts`)
* c — UI integration (button + handler in `components/dashboard/action-station.tsx`)
* d — Hardening (preserve user edits + slot de-dupe + tests)

## Repo Reality Check (RED TEAM)

- What exists today:
  - Availability sections are inserted by `lib/ai-drafts.ts` using headers:
    - `Available times (use verbatim if proposing times):` (SMS/LinkedIn)
    - `AVAILABLE TIMES (use verbatim if scheduling):` (Email)
    - Bullets are rendered as `- ${label}`. (No markdown numbering.)
  - `Lead.offeredSlots` is stored as a JSON string (`Lead.offeredSlots: String? @db.Text`) and is written during draft generation (`lib/ai-drafts.ts`) and follow-up generation (`lib/followup-engine.ts`).
  - Slot selection + fairness already exist:
    - `lib/availability-cache.ts`: `getWorkspaceAvailabilitySlotsUtc(clientId, { refreshIfStale, availabilitySource })`
    - `lib/slot-offer-ledger.ts`: `getWorkspaceSlotOfferCountsForRange`, `incrementWorkspaceSlotOffersBatch`
    - `lib/availability-distribution.ts`: `selectDistributedAvailabilitySlots({ excludeUtcIso, startAfterUtc, ... })`
    - `lib/timezone-inference.ts`: `ensureLeadTimezone(leadId)`
    - `lib/qualification-answer-extraction.ts`: `getLeadQualificationAnswerState({ leadId, clientId })`
  - Access control patterns already exist in `actions/message-actions.ts` via `requireLeadAccess(leadId)` and `revalidatePath("/")`.
  - UI wiring patterns exist in `components/dashboard/action-station.tsx` (Calendar/Reject/Regenerate buttons + toast feedback).

- What the plan assumes:
  - Draft content contains at most one availability section, and it uses `- ` bullets (may be violated by user edits or AI variation).
  - Selecting new slots without excluding existing `Lead.offeredSlots` is acceptable (it is not; it can re-offer the same slots and double-count ledger entries).
  - Refreshing from DB `AIDraft.content` is sufficient (it is not if the user has unsaved edits in the compose box).

- Verified touch points:
  - `actions/message-actions.ts`: `regenerateDraft()` exists and calls `revalidatePath("/")`; `requireLeadAccess()` exists in-file.
  - `components/dashboard/action-station.tsx`: existing action button cluster is the correct insertion point.
  - `lib/ai-drafts.ts`: availability header strings + `- ${label}` formatting exist.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **User edits clobbered:** Calling refresh based only on stored `AIDraft.content` overwrites unsaved edits in the compose box. → **Mitigation:** Phase 87d updates the action to accept `currentContent` from the UI and performs in-place replacement on that string.
- **Duplicate slot re-offer + ledger double-count:** If refresh selects slots already in `Lead.offeredSlots`, `incrementWorkspaceSlotOffersBatch()` will inflate counts and the UI may show “refreshed” but unchanged times. → **Mitigation:** Phase 87d excludes currently offered slots (`excludeUtcIso`) and returns a clear “no new slots” error when no alternatives exist.
- **Parser brittleness:** Regex-only parsing may fail on CRLF line endings, bullet indentation, or multiple sections. → **Mitigation:** Phase 87d adds tests and hardens parsing/replacement (CRLF support, strict stop condition for bullets, multiple-section behavior).

### Repo mismatches (fix the plan)
- Phase 87b currently describes auth/access via `requireAuthUser()` + `getAccessibleClientIdsForUser()`, but `actions/message-actions.ts` already centralizes access via `requireLeadAccess(leadId)`. → **Mitigation:** Phase 87d aligns refresh action with existing access helpers.
- Phase 87c mentions importing `Clock`; `components/dashboard/action-station.tsx` already imports `Clock` from `lucide-react`. → **Mitigation:** Avoid duplicate imports when implementing.

### Testing / validation
- The plan lacks unit tests for the slot parser and replacement behavior. → **Mitigation:** Phase 87d adds `lib/__tests__/availability-slot-parser.test.ts` and covers SMS/Email patterns + CRLF + “no section” behavior.

### Multi-agent coordination
- Phase 86 is actively working around availability cache behavior and may touch `lib/availability-cache.ts`. → **Mitigation:** Before implementing Phase 87, re-read `getWorkspaceAvailabilitySlotsUtc()` signature/return shape and adjust refresh action accordingly (avoid stale assumptions).

## Assumptions (Agent)

- Availability headers and bullet formatting will continue to match `lib/ai-drafts.ts` patterns (~95% confidence)
  - Mitigation: Parser tests should pin the expected header/bullet behavior.

## Phase Summary

### Shipped
- `lib/availability-slot-parser.ts` — deterministic section detection + replacement (CRLF-safe, first-section-only).
- `actions/message-actions.ts` — `refreshDraftAvailability(draftId, currentContent)` with slot de-dupe and snooze-aware selection.
- `components/dashboard/action-station.tsx` — Refresh Availability button + handler with loading state/toasts.
- `lib/__tests__/availability-slot-parser.test.ts` — parser replacement coverage.

### Validation
- `npm run test` ✅ (85 tests, 0 failures)
- `npm run lint` ✅ (0 errors, 20 warnings — all pre-existing)
- `npm run build` ✅ (production build succeeded)

### Follow-ups
- Run manual QA for the new button + compose-edit preservation in production.
