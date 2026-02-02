# Phase 79 — Lead-Provided Scheduler Link Awareness

## Purpose

When a lead provides their own calendar link (Calendly, HubSpot Meetings, Cal.com, etc.), stop the AI from suggesting workspace availability slots. Instead, acknowledge the lead's link and flag for manual review.

## Context

**Jam Report:** [1787b6d4-3aa7-4f61-b372-dbdee3e34203](https://jam.dev/c/1787b6d4-3aa7-4f61-b372-dbdee3e34203)

### Current Behavior

1. `Lead.externalSchedulingLink` is captured when detected in inbound messages (Phase 52d)
2. `lib/lead-scheduler-link.ts` creates a manual review task when `sentimentTag === "Meeting Booked"`
3. Phase 76 added signature context extraction which surfaces `schedulingLinks` from signatures
4. BUT: AI draft generation **ignores** `externalSchedulingLink` and always offers workspace availability

### The Bug

When a lead says "here's my Calendly, book a time" or includes a scheduling link in their email:
- The AI still says "How about Tuesday 2pm or Wednesday 10am?" (our times)
- Should instead say "I'll find a time on your calendar" or acknowledge their link

### Related Components

- **Phase 52d**: Added `Lead.externalSchedulingLink` + `externalSchedulingLinkLastSeenAt`
- **Phase 76**: Added `lib/email-signature-context.ts` for signature extraction
- **Booking Process 5**: Documented manual-review flow for lead-provided links (`docs/notes/booking-process-5.md`)

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 76 | Complete | `lib/ai-drafts.ts`, signature context | Build on signature context extraction |
| Phase 77 | Complete | `lib/ai-drafts.ts`, token budgets | Non-overlapping changes |
| Phase 78 | Complete | DB schema compat | Independent |

## Objectives

* [x] Make AI draft generation aware of `Lead.externalSchedulingLink`
* [x] When lead has scheduler link: set `should_offer_times: false` in strategy
* [x] Inject prompt instruction to acknowledge lead's link instead of offering times
* [x] Expand manual task creation to trigger on "Meeting Requested" (not just "Meeting Booked")
* [x] Verify with `npm run lint && npm run build`

## Constraints

- Do not auto-book on lead's calendar (that's future automation, see booking-process-5.md)
- Keep prompt changes minimal and focused
- Maintain existing behavior for leads WITHOUT external scheduling links

## Success Criteria

- [x] AI draft does NOT include workspace availability when `Lead.externalSchedulingLink` exists
- [x] AI draft acknowledges lead's scheduling link
- [x] FollowUpTask created for leads with "Meeting Requested" + scheduling link
- [x] `npm run lint` passes
- [x] `npm run build` passes

## Key Files

| File | Change |
|------|--------|
| `lib/ai-drafts.ts` | Add `externalSchedulingLink` to lead query; inject awareness into strategy prompt |
| `lib/lead-scheduler-link.ts` | Expand trigger to include "Meeting Requested" sentiment |

## Subphase Index

* a — Draft generation awareness (ai-drafts.ts modifications)
* b — Manual task trigger expansion (lead-scheduler-link.ts)

## Phase Summary

- `lib/ai-drafts.ts`: made draft generation aware of `Lead.externalSchedulingLink` and added prompt-level overrides to prevent offering our times/link when the lead provided their own scheduler link.
- `lib/lead-scheduler-link.ts`: expanded manual review task creation to include `"Meeting Requested"` (not just `"Meeting Booked"`), with sentiment-appropriate messaging.
- Verification: `npm run lint` (warnings only) and `npm run build` (Next build completed; `.next/BUILD_ID` present).
