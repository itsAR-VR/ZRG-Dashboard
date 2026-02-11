# Phase 139 — Robust Lead-Timezone Scheduling

## Purpose

Fix timezone handling across AI draft generation and auto-booking so the system consistently detects lead timezone from conversation context and renders user-visible times in the lead's timezone.

## Context

Production bugs show timezone inference and scheduling interpretation are incomplete:

- Lead states timezone/location in conversation ("PST", "Miami", "Dubai"), but current inference often misses it.
- Relative date phrases ("this Friday", "next week") are interpreted without explicit date anchor context.
- Slot selection can produce lead-local late-night offers.
- Booking confirmations can appear in workspace timezone when lead timezone should be used.

This phase is a systemic correction, not a per-case patch.

## Repo Reality Check (RED TEAM)

Verified current implementation and contracts:

- `lib/timezone-inference.ts`
  - `ensureLeadTimezone(leadId)` currently takes only `leadId`.
  - Inference flow order is: known region signals -> existing lead timezone -> US state mapping -> AI metadata -> workspace fallback.
  - `isValidIanaTimezone` exists but is private.
- `lib/availability-distribution.ts`
  - `selectDistributedAvailabilitySlots()` currently has no `leadTimeZone` input and no business-hours guard.
- `lib/availability-format.ts`
  - Formatting helpers are workspace-timezone driven by caller-provided `timeZone`.
- `lib/ai-drafts.ts`
  - `generateResponseDraft()` resolves timezone but does not pass conversation text into `ensureLeadTimezone`.
  - Prompt builders do not include "today" context.
- `lib/followup-engine.ts`
  - `processMessageForAutoBooking()` calls `ensureLeadTimezone(leadId)` without conversation text.
  - `sendAutoBookingConfirmation()` formats with `opts.timeZone`.
- `lib/meeting-overseer.ts`
  - Extract schema has no `detected_timezone`.

Additional verified callsite impact:

- `ensureLeadTimezone` is used in multiple files beyond `ai-drafts` and `followup-engine` (`lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/*`, `app/api/webhooks/email/route.ts`, etc.). Signature change must remain backward-compatible.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 137 | Active | `lib/ai-drafts.ts` (dirty) | Keep 139 changes limited to scheduling/timezone sections only. |
| Phase 138 | Active | `lib/followup-engine.ts`, `lib/ai-drafts.ts`, `lib/meeting-overseer.ts` | Re-read latest file states before each edit and integrate 138 return-type/schema changes first. |
| Phase 140 | Active | `lib/ai-drafts.ts` | Avoid pricing/knowledge-context regions while patching scheduling logic. |

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes

- Shared-file merge races in `lib/ai-drafts.ts` and `lib/followup-engine.ts` with active phases.
- Schema break risk if `meeting.overseer.extract` is changed in-place instead of versioned.
- Incomplete timezone contract rollout if helper exports/signatures are changed without callsite audit.

### Missing or ambiguous requirements (resolved)

- Display policy was ambiguous ("dual-timezone" vs "single-timezone"): resolved to **lead-timezone-only for user-visible labels**.
- Business-hours empty-result behavior was ambiguous: resolved to **fail-open**.
- Overseer rollout compatibility was ambiguous: resolved to **versioned `meeting.overseer.extract.v2`**.

### Repo mismatches corrected in this phase plan

- Corrected `ensureLeadTimezone` order to match repo reality.
- Removed brittle line-number anchors; use function-level anchors instead.

## Resolved Decisions (2026-02-11)

- User-visible time labels: **lead timezone only** when known; workspace timezone only as fallback.
- Business-hours filtering (lead-local 7:00 to <21:00): **fail open** when filter empties candidates.
- Meeting overseer timezone extraction rollout: **new `meeting.overseer.extract.v2` prompt/schema** with compatibility path.
- Keep using existing enrichment/platform timezone sources when available; conversation inference is additive.

## Objectives

* [ ] Detect timezone from conversation content using regex-first extraction with AI fallback only when needed.
* [ ] Inject explicit date context into prompt builders so relative phrases resolve correctly.
* [ ] Pre-filter availability by timing preference and lead-local business hours.
* [ ] Ensure all user-visible suggested/confirmation times use lead timezone when known.
* [ ] Add timezone extraction to meeting overseer via versioned schema rollout.
* [ ] Integrate safely with active Phase 138 changes in shared files.

## Constraints

- Keep `ensureLeadTimezone` signature backward-compatible via optional `opts`.
- Regex-first detection for low latency/cost; AI fallback only for location inference misses.
- Preserve existing deterministic/enrichment-based timezone tiers; add conversation tier without removing existing paths.
- Business-hours filter must fail-open if it would produce zero slots.
- Use existing `runStructuredJsonPrompt` conventions and budgets.
- No Prisma schema changes in this phase.

## Success Criteria

- Lead message "before noon PST" -> suggested slots and booking confirmation display in PST.
- Lead mention "mostly in Miami now" -> timezone resolves to `America/New_York` without asking timezone again.
- Lead in Dubai -> no slots outside 7:00 to <21:00 lead-local when filtered candidates exist.
- "This Friday" preference narrows offered slots to Friday candidates when available.
- Overseer `v2` extraction can return `detected_timezone` without breaking existing flows.
- `npm run lint` passes.
- `npm run build` succeeds.

## Subphase Index

* a — Conversation-Aware Timezone Extraction + Contract Updates
* b — Date Context + Prompt Timezone Awareness
* c — Lead-Local Business-Hours Filtering + Lead-Timezone Labels
* d — Booking Confirmation + Meeting Overseer v2 Timezone Integration
* e — Cross-Phase Integration and Verification Hardening
