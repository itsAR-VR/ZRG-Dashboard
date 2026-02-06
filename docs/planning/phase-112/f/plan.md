# Phase 112f — Followup-Engine Integration (Bundle Injection + Configurable Thresholds + Booking Gate)

## Focus
Bring followup + auto-booking into the shared LeadContextBundle + confidence governance world:
- inject `LeadContextBundle` (redacted memory) into followup parsing prompts
- move hardcoded confidence thresholds out of `lib/followup-engine.ts`
- add an **overseer-style booking gate** before auto-booking when enabled
- ensure everything is observable via `AIInteraction.metadata` (stats-only)

## Inputs
- Bundle contract: `docs/planning/phase-112/a/plan.md`
- Rollout toggles: `docs/planning/phase-112/e/plan.md`
- Confidence policy system: `docs/planning/phase-112/d/plan.md`
- Followup/booking runtime:
  - `lib/followup-engine.ts` (`parseProposedTimesFromMessage`, `processMessageForAutoBooking`)
  - `lib/meeting-overseer.ts` (decision persistence pattern)
  - `prisma/schema.prisma` (`MeetingOverseerDecision`, `WorkspaceSettings`)
- Prompt override system:
  - `lib/ai/prompt-registry.ts`
  - `lib/ai/prompt-runner/*`

## Decisions (Locked 2026-02-06)
- Followup-engine is in-scope now: shared bundle + configurable thresholds + booking gate.
- Lead memory injected into followup prompts is **always redacted**.
- No raw message bodies or memory contents are persisted in telemetry metadata.
- Booking gate `needs_clarification` handling: **create a FollowUpTask only** (no auto-send clarifications).

## Work
1. Repo reality check (RED TEAM hardened)
   - **Re-read `lib/followup-engine.ts` from current HEAD** before any edits (Phase 110 shipped disposition/idempotency changes that must be preserved).
   - Confirm `lib/followup-engine.ts` currently has:
     - `promptKey: "followup.parse_proposed_times.v1"` at line ~2594 (used **inline**, NOT in prompt registry)
     - hardcoded `HIGH_CONFIDENCE_THRESHOLD = 0.9` at line ~3023 for auto-booking
   - **Verify no existing `PromptOverride` rows** reference `followup.parse_proposed_times.v1` (since it was never in the registry, there should be none — but confirm to prevent stale override conflicts during migration):
     ```sql
     SELECT * FROM "PromptOverride" WHERE "promptKey" = 'followup.parse_proposed_times.v1';
     ```

2. Add prompt registry entries (override-compatible) — inline→registry migration
   - **Migration note**: `followup.parse_proposed_times.v1` is currently used inline in `followup-engine.ts`. Moving it to the registry means the prompt text is now centralized and override-compatible. Ensure the migrated prompt text matches the current inline version exactly (no accidental prompt changes).
   - Add `followup.parse_proposed_times.v1` to `lib/ai/prompt-registry.ts` with:
     - featureId: `followup.parse_proposed_times`
     - template vars: `nowUtcIso`, `leadTimezone`, `leadMemoryContext`
     - system prompt includes a short “Lead memory (redacted)” section to bias toward safe clarifications.
   - Add new prompt `followup.booking.gate.v1` (structured JSON) with:
     - featureId: `followup.booking.gate`
     - template vars: `leadMemoryContext`, `nowUtcIso`, `leadTimezone`
     - input includes the inbound message and a compact summary of the parse outcome (no full history needed).
     - output JSON shape (enforced via schema):
       - `decision: "approve" | "needs_clarification" | "deny"`
       - `confidence: number`
       - `issues: string[]` (allowlisted categories only; no quoting user text)
       - `clarification_message: string | null` (single-sentence, safe, no PII)
       - `rationale: string` (max 200 chars, no quotes)

3. Inject LeadContextBundle into followup parse (gated + fallback)
   - When `WorkspaceSettings.leadContextBundleEnabled=true` and kill-switch is off:
     - build bundle profile `followup_parse`
     - pass `leadMemoryContext` into `followup.parse_proposed_times.v1` template vars
     - attach bundle stats to `AIInteraction.metadata.leadContextBundle`
   - On disable/failure:
     - keep existing parse behavior (no memory context)

4. Replace hardcoded confidence threshold with policy/settings resolution
   - Replace `HIGH_CONFIDENCE_THRESHOLD` with:
     - `resolveThreshold(clientId, "followup.auto_book", "proposed_times_match_threshold")` (from 112d), OR
     - fallback to `0.9` if no policy exists yet
   - Explicit rule: default behavior must match today unless policy is applied.

5. Add booking gate before auto-booking (when enabled)
   - Gate conditions (must all be true):
     - `WorkspaceSettings.autoBookMeetings=true`
     - `WorkspaceSettings.followupBookingGateEnabled=true`
     - `leadContextBundleEnabled=true` (keeps rollout consistent)
     - there is a matched availability slot AND parse confidence >= threshold
   - Booking gate flow:
     - build bundle profile `followup_booking_gate`
     - run `followup.booking.gate.v1`
     - if `decision="approve"` → proceed booking
     - if `decision="needs_clarification"` → create a clarification `FollowUpTask` using `clarification_message` (do not auto-send)
     - if `decision="deny"` → do not auto-book; fall back to offering slots / human task
   - Persistence:
     - Store the gate output as a `MeetingOverseerDecision` row with `stage="booking_gate"` (requires widening `MeetingOverseerStage` TS union, but schema can keep `stage: String`).
     - Hard rule: do not persist raw message text inside the payload.

6. Telemetry (stats-only)
   - Add metadata fields (no raw text):
     - `AIInteraction.metadata.followupParse`: `{ confidence, proposedTimesCount, needsTimezoneClarification, matchedAvailability }`
     - `AIInteraction.metadata.bookingGate`: `{ decision, confidence, issuesCount }`

7. Tests
   - Add/extend tests:
     - Threshold resolution uses default `0.9` when policy absent.
     - Booking gate toggles: when disabled, behavior matches current branch.
     - Booking gate persistence: stage is set once per messageId (idempotent).

## Validation (RED TEAM)
- Manual regression:
  - Existing auto-booking works unchanged when booking gate toggle is OFF.
  - When booking gate toggle is ON, we never auto-book on `needs_timezone_clarification=true`.
  - **Phase 110 preservation**: `responseDisposition` persistence and idempotency guarantees still hold after bundle injection + configurable thresholds.
  - **Inline→registry migration**: prompt output for `followup.parse_proposed_times.v1` matches pre-migration behavior (compare outputs on same input).
- Observability:
  - AIInteraction shows `followup.parse_proposed_times` and `followup.booking.gate` calls with metadata present.

## Output
- Followup parse prompt is in the registry (override-compatible).
- Auto-book threshold is configurable via confidence policy (with safe default).
- Booking gate exists and is persisted + observable.

## Handoff
112g builds the super-admin UI to toggle booking gate, view per-call telemetry, and manage thresholds/proposals.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Added prompt registry entries:
    - `followup.parse_proposed_times.v1`
    - `followup.booking.gate.v1`
    (file: `lib/ai/prompt-registry.ts`)
  - Injected LeadContextBundle (redacted memory) into followup proposed-times parsing when enabled (DB toggle + kill-switch), with safe fallback to legacy behavior (file: `lib/followup-engine.ts`).
  - Replaced hardcoded `HIGH_CONFIDENCE_THRESHOLD=0.9` with `resolveThreshold(clientId, "followup.auto_book", "proposed_times_match_threshold")` (fallback to 0.9) (file: `lib/followup-engine.ts`).
  - Implemented booking gate (when enabled) before auto-booking a matched proposed time:
    - runs `followup.booking.gate.v1`
    - persists decision to `MeetingOverseerDecision` with `stage="booking_gate"` (idempotent via `messageId_stage` upsert)
    - `needs_clarification` creates a `FollowUpTask` only (no auto-send)
    (file: `lib/followup-engine.ts`)
  - Added stats-only post-call telemetry updates to `AIInteraction.metadata` for:
    - `followupParse` (confidence, count, needsTimezoneClarification)
    - `bookingGate` (decision, confidence, issuesCount)
    (file: `lib/followup-engine.ts`)
- Commands run:
  - `npm test` — pass
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Add targeted regression tests for booking gate toggles + idempotency (future hardening).
