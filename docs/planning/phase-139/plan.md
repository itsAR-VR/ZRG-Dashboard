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

* [x] Detect timezone from conversation content using regex-first extraction with AI fallback only when needed.
* [x] Inject explicit date context into prompt builders so relative phrases resolve correctly.
* [x] Pre-filter availability by timing preference and lead-local business hours.
* [x] Ensure all user-visible suggested/confirmation times use lead timezone when known.
* [x] Add timezone extraction to meeting overseer via versioned schema rollout.
* [x] Integrate safely with active Phase 138 changes in shared files.

## Constraints

- Keep `ensureLeadTimezone` signature backward-compatible via optional `opts`.
- Regex-first detection for low latency/cost; AI fallback only for location inference misses.
- Preserve existing deterministic/enrichment-based timezone tiers; add conversation tier without removing existing paths.
- Business-hours filter must fail-open if it would produce zero slots.
- Use existing `runStructuredJsonPrompt` conventions and budgets.
- No Prisma schema changes in this phase.

## Success Criteria

- [x] Lead message "before noon PST" -> suggested slots and booking confirmation display in PST.
- [x] Lead mention "mostly in Miami now" -> timezone resolves to `America/New_York` without asking timezone again.
- [x] Lead in Dubai -> no slots outside 7:00 to <21:00 lead-local when filtered candidates exist.
- [x] "This Friday" preference narrows offered slots to Friday candidates when available.
- [x] Overseer `v2` extraction can return `detected_timezone` without breaking existing flows.
- [x] `npm run lint` passes.
- [x] `npm run build` succeeds.

## Subphase Index

* a — Conversation-Aware Timezone Extraction + Contract Updates
* b — Date Context + Prompt Timezone Awareness
* c — Lead-Local Business-Hours Filtering + Lead-Timezone Labels
* d — Booking Confirmation + Meeting Overseer v2 Timezone Integration
* e — Cross-Phase Integration and Verification Hardening

## Repo Reality Check (Post-Implementation)

- `lib/timezone-inference.ts` now exports `isValidIanaTimezone`, supports `extractTimezoneFromConversation(...)`, and accepts optional `conversationText` in `ensureLeadTimezone(...)`.
- `lib/ai-drafts.ts` now injects date + lead-timezone context into draft prompt builders and pre-filters slot candidates by weekday/relative-week timing preferences.
- `lib/availability-distribution.ts` now supports optional `leadTimeZone` with 07:00-<21:00 lead-local filtering and fail-open fallback.
- `lib/followup-engine.ts` now resolves timezone with conversation text for auto-booking and enforces lead-timezone-first confirmation rendering.
- `lib/meeting-overseer.ts` now uses `meeting.overseer.extract.v2` and normalizes compatibility for older payloads without `detected_timezone`.

## Phase Summary (running)

- 2026-02-11 23:38:38Z — Implemented lead-timezone scheduling corrections across timezone inference, draft prompts, slot distribution, booking confirmations, and meeting overseer v2 extraction; added regression tests and validated gates. (files: `lib/timezone-inference.ts`, `lib/ai-drafts.ts`, `lib/availability-distribution.ts`, `lib/followup-engine.ts`, `lib/meeting-overseer.ts`, `lib/background-jobs/sms-inbound-post-process.ts`, `lib/__tests__/timezone-inference-conversation.test.ts`, `lib/__tests__/availability-distribution.test.ts`, `lib/__tests__/followup-booking-signal.test.ts`)
- 2026-02-11 23:38:38Z — Validation evidence: targeted timezone/distribution/booking-signal tests passed; `npm run lint` passed (warnings only); `npm run build` passed after clearing stale `.next/lock`.
- 2026-02-11 23:38:38Z — Post-implementation review documented in `docs/planning/phase-139/review.md`; final RED TEAM pass reported no critical blockers for Phase 139 scope.

## Multi-Agent Coordination Check (2026-02-11)

### Overlaps Confirmed

- Phase 138: `lib/followup-engine.ts`, `lib/meeting-overseer.ts`, `lib/ai-drafts.ts` (auto-booking pipeline, overseer schema, draft suppression).
- Phase 140: `lib/ai-drafts.ts` (pricing validation/prompt Step 3).
- Phase 141: `lib/ai-drafts.ts` runtime toggles (planned).
- Phase 137: no direct code overlap with Phase 139 scope; shared repo-wide lint/build gates only.

### Conflict / Race Risks

- `lib/ai-drafts.ts` is a three-phase hot spot (138/139/140) and upcoming 141; merge by function/symbol, not line numbers.
- `lib/meeting-overseer.ts` schema v2 (139) must stay compatible with 138 booking qualification logic.
- Build gate interpretation differs: Phase 138 reports a repo-wide build blocker unrelated to scheduling; Phase 139 recorded build passing after `.next/lock` cleanup. Treat build status as environment-dependent, not definitive across phases.

### Required Cross-Phase Checks

- Re-verify `lib/ai-drafts.ts` changes after Phase 140/141 merges to ensure timezone context and pricing/toggles coexist.
- Re-verify `lib/followup-engine.ts` and `lib/meeting-overseer.ts` after Phase 138 updates to confirm return-shape/schema compatibility.

### Residual Risks

- Build gate can regress due to unrelated prerender errors noted in Phase 138; Phase 139 validation is not a global build guarantee.
- Lint warnings remain pre-existing; no Phase 139-specific warning reductions tracked.
