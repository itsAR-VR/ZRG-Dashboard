# Phase 128 — Fix “Inconsistent Cost Suggestions” + Compose-with-AI Booking Escalation Error

## Purpose
Fix a Master Inbox bug where clicking **Compose with AI** fails with `Human review required: max_booking_attempts_exceeded`, and address inconsistent AI pricing outputs (real price vs placeholders like `${PRICE}` / `$X-$Y`) for “how much does it cost?” replies.

## Context
Evidence pulled from monday.com item `Inconsistent Cost Suggesstions` (board `AI Bugs + Feature Requests`, item `11211767137`) and the linked Jam:
- Jam: `https://jam.dev/c/4451d3ca-8102-48d6-b287-c85e2b16358b`
  - Repro: clicking **Compose with AI** shows error: `Human review required: max_booking_attempts_exceeded`
  - Network trace shows the Server Action responded `{ success: false, error: "Human review required: max_booking_attempts_exceeded" }`
- Screenshots in the monday item show inconsistent pricing suggestions:
  - One draft contains explicit pricing (e.g., `$5,000/year` and `$500/month`)
  - Other drafts contain placeholders (`${PRICE}` or `$X-$Y`)

Code root cause (repo reality, verified):
- `actions/message-actions.ts:regenerateDraft()` calls `lib/ai-drafts.ts:generateResponseDraft(...)`
- `lib/ai-drafts.ts` calls `lib/booking-process-instructions.ts:getBookingProcessInstructions(...)`
- When `getBookingProcessInstructions()` returns `requiresHumanReview=true`, `generateResponseDraft()` returns `{ success:false, error: "Human review required: <reason>" }`, which blocks manual “Compose with AI” entirely.
- `max_booking_attempts_exceeded` is raised in `lib/booking-process-instructions.ts` when `lib/booking-progress.ts:shouldEscalateForMaxWaves()` is true (`currentWave > maxWavesBeforeEscalation`).
- Today, `recordOutboundForBookingProgress(...)` is called for *all* outbound sends (e.g. `lib/email-send.ts`), so “booking waves” can advance during normal non-booking conversations, making it realistic to hit the max-waves backstop during ordinary inbox work.

Locked product decisions (from conversation):
- When escalation is active, **Compose with AI must still generate a draft** (do not block users with an error).
- Auto-send behavior remains governed only by confidence/threshold (do not force `needs_review` due to booking escalation).
- Pricing consistency: **Always merge** campaign/default persona `serviceDescription` with Workspace Settings `serviceDescription`.

## Concurrent Phases
Overlaps detected by scanning the last 10 phases and repo state (`git status --porcelain` shows a dirty working tree including `lib/ai-drafts.ts` and booking/auto-send related files).

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 123 | Active/Local | `lib/ai-drafts.ts`, auto-send loop context | Re-read current `lib/ai-drafts.ts` before edits; keep Phase 128 changes minimal and additive to avoid semantic regressions. |
| Phase 125 | Active/Local | Draft availability refresh + Action Station UI | Avoid touching refresh logic; only adjust regen / draft generation + persona context. |
| Phase 127 | Active/Local | Draft pipeline + retention + observability | Avoid schema/workflow changes; keep Phase 128 schema-free. |
| Phase 126 | Active/Local | Prisma schema and analytics work | Phase 128 should remain schema-free; do not bundle schema work. |
| Phase 124 | Active/Local | Settings/RBAC + follow-ups | No intended overlap; keep commit boundaries clean. |

## Objectives
* [x] Stop booking-wave escalation from blocking AI draft generation (manual compose + automatic drafts).
* [ ] ~~Reduce/eliminate spurious `max_booking_attempts_exceeded`~~ — RED TEAM finding: `recordOutboundForBookingProgress()` already no-ops when a lead has no campaign/booking process (lines 616-631 of `booking-progress.ts`). Waves only advance when a booking process IS active. The real fix is fail-open in 128a (don't block drafting when escalation triggers). Wave-counting logic is correct as-is.
* [x] Eliminate pricing placeholders when pricing context exists by always merging `serviceDescription` sources (persona + workspace settings).
* [x] Add focused tests and pass quality gates (`npm test`, `npm run lint`, `npm run build`).
* [ ] Verify the Jam repro is fixed and update the monday item with results (manual validation pending).

## Constraints
- Do not commit secrets/tokens/PII.
- Prefer schema-free changes in this phase.
- Keep existing action return shapes stable (`{ success, data?, error? }`).
- Booking escalation may remain as a safety backstop, but must not block drafting; it should only affect booking-specific instruction injection (times/link), and should log clearly for diagnosis.
- Auto-send path must remain confidence-based only (no new escalation gating).

## Success Criteria
1. Clicking **Compose with AI** no longer fails with `Human review required: max_booking_attempts_exceeded` for leads in that state; a draft is generated.
2. When booking escalation is active, generated drafts:
   - do not propose time slots / booking links automatically
   - still answer the inbound question (e.g., pricing) normally
3. Booking escalation is treated as a soft signal (suppresses booking nudges, but never blocks drafting).
4. Pricing suggestions stop using placeholders when `serviceDescription` contains pricing details; otherwise the draft asks a clarifying question (no hallucinated numbers).
5. Quality gates pass: `npm test`, `npm run lint`, `npm run build`.

## Open Questions (Need Human Input)

- [ ] Do you want us to do a live app validation (staging/prod) for the Jam repro before calling this fully done? (confidence <90%)
  - Why it matters: local tests/builds confirm compile-time correctness, but only a live session confirms the UI flow no longer shows the Compose-with-AI error and that escalation suppression behaves as intended in real data.
  - Current assumption in this phase: validate post-deploy / manually by an operator if agent auth is unavailable.

## Repo Reality Check (RED TEAM)

- What exists today:
  - `lib/ai-drafts.ts` no longer hard-blocks drafting when booking escalation is active; escalation now suppresses booking nudges (times/links) and appends an explicit “no times/links” prompt appendix.
  - `lib/booking-process-instructions.ts` now returns `requiresHumanReview: false` with `escalationReason: "max_booking_attempts_exceeded"` (soft signal, no UI-blocking error).
  - `lib/ai-drafts.ts:resolvePersona()` still picks ONE source (campaign persona OR default persona OR settings), but `serviceDescription` is now merged at the `generateResponseDraft()` call site.
  - `lib/ai-drafts.ts:sanitizeDraftContent()` strips booking link placeholders, truncated URLs, and pricing placeholders (`${PRICE}`, `$X-$Y`, etc.).
  - `lib/ai-drafts.ts:detectDraftIssues()` flags pricing placeholders so email draft generation will retry before persisting.
  - `recordOutboundForBookingProgress()` already no-ops when lead has no campaign/booking process (lines 616-631 of `booking-progress.ts`)
- Verified touch points:
  - `actions/message-actions.ts:1403` — `regenerateDraft()`
  - `lib/ai-drafts.ts:1240` — `generateResponseDraft()`
  - `lib/ai-drafts.ts:536` — `resolvePersona()` (private, not exported)
  - `lib/booking-process-instructions.ts:56` — `getBookingProcessInstructions()`
  - `lib/booking-progress.ts:537` — `shouldEscalateForMaxWaves()`
  - `lib/inbound-post-process/pipeline.ts:329` — calls `generateResponseDraft()`
  - `components/dashboard/action-station.tsx:684` — calls `regenerateDraft()`

## RED TEAM Findings (Gaps / Weak Spots)

### GAP 1 — CRITICAL: 128b merge location is wrong
128b originally said to merge `serviceDescription` inside `resolvePersona()`. But when a campaign persona exists (line 549), `resolvePersona()` returns early at line 563 — it **never reads `settings.serviceDescription`**. **Fix:** Merge at the call site (`generateResponseDraft`, after line 1469), where both `persona.serviceDescription` and `settings.serviceDescription` are accessible.

### GAP 2 — MEDIUM: Pricing placeholder post-generation rewrite is over-engineered
128b originally proposed a full "rewrite" of drafts with pricing placeholders. This is risky (hallucinated replacements, broken formatting). **Fix:** Extend existing `sanitizeDraftContent()` (line 185) with pricing placeholder regex detection + strip. The prompt-level "no placeholders" instruction is the primary defense; the sanitizer is the safety net.

### GAP 3 — MEDIUM: Phase 123 uncommitted changes to `lib/ai-drafts.ts`
Phase 123 has added `runId` return field and `DraftPipelineRun` artifact persistence to `generateResponseDraft()`. These are in the working tree. **Fix:** 128a must re-read `lib/ai-drafts.ts` before editing and preserve Phase 123's `runId` field and artifact logic.

### GAP 4 — LOW: Objective 2 incorrectly blames `recordOutboundForBookingProgress`
`recordOutboundForBookingProgress()` already no-ops for non-booking leads. Waves only advance when a booking process IS active. **Fix:** Objective 2 struck. The fix is purely fail-open in 128a.

### GAP 5 — LOW: "No placeholders" instruction missing from SMS + LinkedIn prompt builders
128b only targeted email prompt builder. SMS uses `buildSmsPrompt` (~line 600) and LinkedIn uses `buildLinkedInPrompt` (~line 678). **Fix:** Add instruction to all three.

## Assumptions (Agent)

- Pricing placeholder regex `/\$\{[A-Z_]+\}|\$[A-Z](?:-\$[A-Z])?(?!\w)/g` will not false-positive on real dollar amounts like `$5,000` because real prices have digits after `$`, not uppercase letters. (confidence ~95%)
  - Mitigation: Test with real pricing strings from workspace settings.
- Merging `serviceDescription` at the call site (line 1469) is safe because `resolvePersona()` is private and only called in `generateResponseDraft()`. (confidence ~95%)
  - Mitigation: Grep confirmed no other callers.
- The "manual scheduling only" instruction won't confuse the model for non-scheduling inbound questions because it's phrased conditionally ("If scheduling is needed..."). (confidence ~90%)

## Subphase Index
* a — Booking escalation: fail-open draft generation (no blocking error) + suppress booking instructions (times/links) safely
* b — Pricing consistency: always-merge serviceDescription at call site (persona + workspace settings) + guardrails against placeholders via `sanitizeDraftContent()` extension
* c — Tests: add focused coverage for escalation fail-open + serviceDescription merge + placeholder regex safety
* d — Verification + comms: tests/lint/build, Jam repro, and monday item update

## Phase Summary (running)
- 2026-02-09 — Implemented escalation fail-open so Compose-with-AI no longer errors on `max_booking_attempts_exceeded` and booking nudges are suppressed during escalation (files: `lib/booking-process-instructions.ts`, `lib/ai-drafts.ts`, `docs/planning/phase-128/a/plan.md`)
- 2026-02-09 — Hardened pricing consistency: merged persona + workspace `serviceDescription`, blocked pricing placeholders (retry + sanitize), added tests, and verified `npm test`, `npm run lint`, `npm run build`. (files: `lib/ai-drafts.ts`, `lib/__tests__/ai-drafts-service-description-merge.test.ts`, `lib/__tests__/ai-drafts-pricing-placeholders.test.ts`, `scripts/test-orchestrator.ts`, `docs/planning/phase-128/b/plan.md`, `docs/planning/phase-128/c/plan.md`, `docs/planning/phase-128/d/plan.md`)
