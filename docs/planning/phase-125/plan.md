# Phase 125 — Fix Draft Availability Refresh (Indexless Safe Replace)

## Purpose
Fix "Refresh availability times" so it reliably updates outdated time offers in an AI draft without brittle, index-based AI edits.

## Context
- Jam `ff2470b8-f70d-49e5-ad96-e12b27f3f1ba` (2026-02-09) shows clicking "Refresh availability times" returns: "Could not safely refresh availability. Please regenerate the draft."
- UI and server path (verified in repo + Jam network):
  - `components/dashboard/action-station.tsx` -> `actions/message-actions.ts:refreshDraftAvailability(...)`
  - `lib/draft-availability-refresh.ts:refreshDraftAvailabilityCore(...)`
  - `lib/availability-refresh-candidates.ts:buildRefreshCandidates(...)`
  - `lib/availability-refresh-ai.ts:refreshAvailabilityInDraftViaAi(...)`
- Root cause:
  - `lib/availability-refresh-ai.ts` currently asks the model to return replacements with `{ startIndex, endIndex, oldText, newText }`.
  - The validator then requires the indices and `oldText` slice to match exactly.
  - In practice, indices drift even when `oldText/newText` are correct, causing `validation_failed:*` and the fail-closed UI error.
- Locked decisions from conversation:
  - Refresh stays "Always AI" (no deterministic-only fallback path).
  - Same-day slots remain excluded ("tomorrow+ only" eligibility).
  - On refresh failure, UI shows an error only (no auto-regeneration).

## Concurrent Phases
Overlaps detected by scanning the last 10 phases and current repo state (`git status --porcelain`).

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 123 | Active (local docs untracked) | Domain: AI draft pipeline + prompt-runner conventions | Keep prompt keys stable; avoid edits to shared prompt-runner infrastructure while landing Phase 125. |
| Phase 124 | Active (local docs untracked) | None expected | Keep commits scoped; do not accidentally bundle follow-ups/RBAC work. |
| Working tree | Dirty | File: `lib/workspace-capabilities.ts` modified | Out of scope for Phase 125; do not include in Phase 125 implementation commits. |

## Objectives
* [x] Replace index-based AI replacement protocol with an indexless, text-locate protocol (`oldText/newText` pairs).
* [x] Apply replacements deterministically and safely by locating unique `oldText` occurrences in the current draft and enforcing non-overlap.
* [x] Preserve fail-closed behavior and existing user-facing error strings.
* [x] Add non-PII debug logging for refresh failures to speed up future triage.
* [x] Add unit tests for the new validator/apply path.
* [x] Verify with `npm test`, `npm run lint`, `npm run build`.
* [ ] Manual Jam repro verification post-deploy (production or locally with real DB/auth).

## Constraints
- Do not log or persist raw draft content or candidate slot labels for telemetry/debugging (no PII leakage).
- No Prisma schema changes in this phase.
- Keep the refresh prompt key stable (`availability.refresh.inline.v1`) and keep changes localized to the availability refresh feature.
- Preserve existing action return shape: `{ success, content?, oldSlots?, newSlots?, error? }`.
- Keep "tomorrow+ only" slot eligibility unchanged (exclude any slot that is on or before today's local date in the lead timezone).

## Success Criteria
1. Clicking "Refresh availability times" on a draft containing outdated time offers succeeds in normal cases (no `validation_failed:*`), and updates the draft content.
2. If the draft has no time offers, refresh returns the existing "No time options found..." message (no behavior regression).
3. If the draft is edited in a way that makes replacements ambiguous (e.g., `oldText` appears multiple times), refresh fails closed with the existing generic safety error (no partial/unsafe edits).
4. Quality gates pass: `npm test`, `npm run lint`, `npm run build`.

## Subphase Index
* a — Update AI refresh contract + implement safe locate-and-replace (no indices)
* b — Server action hardening + non-PII logging + error mapping checks
* c — Tests + QA (unit tests, quality gates, Jam repro verification)

---

## Repo Reality Check

### Verified Touch Points
| File | Exists | Plan Assumption | Verified |
|------|--------|-----------------|----------|
| `lib/availability-refresh-ai.ts` | Yes | Contains `AvailabilityReplacement` type with `startIndex/endIndex`, `validateAvailabilityReplacements()`, `applyValidatedReplacements()`, `refreshAvailabilityInDraftViaAi()` | Correct |
| `lib/draft-availability-refresh.ts` | Yes | Contains `refreshDraftAvailabilityCore()`, `mapRefreshError()`, `RefreshDraftAvailabilityResult` type | Correct |
| `actions/message-actions.ts` | Yes | Contains `refreshDraftAvailability()` server action that delegates to `refreshDraftAvailabilityCore()` | Correct (line 1604) |
| `components/dashboard/action-station.tsx` | Yes | Calls `refreshDraftAvailability()` and reads `{ success, content, newSlots, oldSlots, error }` | Correct (line 713) |
| `lib/ai/prompt-runner/runner.ts` | Yes | Exports `runStructuredJsonPrompt<T>()` used in the refresh AI function | Correct (line 180) |
| `lib/__tests__/availability-refresh-ai.test.ts` | Yes | Existing test file covering `applyValidatedReplacements` + `validateAvailabilityReplacements` | Correct — must be updated, NOT recreated |
| `lib/availability-refresh-candidates.ts` | Yes | Exports `buildRefreshCandidates()`, `detectPreferredTimezoneToken()` | Correct (not touched in this phase) |

### Key Code Facts Verified
- `AvailabilityReplacement` type remains the internal apply type: `{ startIndex, endIndex, oldText, newText }`
- AI response replacements are now indexless pairs: `{ oldText, newText }[]`
- JSON schema requires only `oldText` + `newText` (and forbids extra fields via `additionalProperties: false` + `strict: true`)
- Validator now locates `oldText` in the current draft to compute indices and enforces:
  - candidate membership (`new_text_not_candidate`)
  - unique `newText` (`duplicate_new_text`)
  - unique `oldText` occurrence (`old_text_not_found`, `old_text_not_unique`)
  - non-overlapping computed ranges (`overlapping_ranges`)
- Prompt key remains `availability.refresh.inline.v1`
- Model remains `gpt-5-nano` with `reasoningEffort: "minimal"`
- `mapRefreshError()` in `draft-availability-refresh.ts` (line 27-38): handles `no_time_offers`, `validation_failed:*`, `max_passes_exceeded`, and default
- Multi-pass loop: up to `maxPasses` (default 10) with chunked replacements (default 5)
- `refreshDraftAvailabilitySystem()` (line 162-194): system-level entry point also in `draft-availability-refresh.ts`

## RED TEAM Findings

### GAP-1 [HIGH] — Existing test file will be overwritten if recreated
**What:** Phase 125c says "Create `lib/__tests__/availability-refresh-ai.test.ts`" but this file already exists (134 lines, 4 test cases covering the OLD index-based API).
**Risk:** A naive "create file" operation will either fail or destroy existing test coverage for `applyValidatedReplacements` (which still works post-change).
**Fix:** Phase 125c must UPDATE the existing test file — keep existing `applyValidatedReplacements` tests, rewrite `validateAvailabilityReplacements` tests to use the new indexless signature, and add the new locate-specific tests (oldText not found, oldText not unique).

### GAP-2 [HIGH] — `AvailabilityReplacement` type is exported and used by test file + draft-availability-refresh
**What:** The plan says replacements become `{ oldText, newText }` only, but the `AvailabilityReplacement` type with `startIndex/endIndex` is exported from `availability-refresh-ai.ts` and imported by the existing test file. Internally, `applyValidatedReplacements()` still needs indices to do back-to-front slicing.
**Risk:** If we remove `startIndex/endIndex` from the type entirely, `applyValidatedReplacements()` breaks. If we keep the type, the AI response contract and the internal type diverge.
**Fix:** Plan 125a should explicitly call out the two-type design:
1. **AI response type** (new): `{ oldText: string, newText: string }[]` — what the model returns
2. **Internal type** (`AvailabilityReplacement`): unchanged `{ startIndex, endIndex, oldText, newText }` — computed by the locate step
3. The validator takes the AI response type in, locates `oldText`, and produces the internal type
4. `applyValidatedReplacements()` remains unchanged (operates on internal type)

### GAP-3 [MEDIUM] — JSON schema change will break `strict: true` if not updated together
**What:** `refreshAvailabilityInDraftViaAi()` uses `strict: true` with an explicit JSON schema object (lines 179-201) that requires `startIndex` and `endIndex`. The new AI contract drops these fields.
**Risk:** If the schema is updated but the `AvailabilityRefreshAiResponse` TypeScript type isn't updated to match, or vice versa, the runtime and compile-time contracts diverge. With `strict: true`, the model will refuse to return fields not in the schema.
**Fix:** Phase 125a must update ALL THREE in lockstep:
1. JSON schema object (remove `startIndex/endIndex`, keep `oldText/newText`)
2. `AvailabilityRefreshAiResponse` TypeScript type (same shape)
3. Validation function input type (accept the new shape, produce `AvailabilityReplacement`)

### GAP-4 [MEDIUM] — New validation failure codes need `mapRefreshError()` confirmation
**What:** Phase 125a introduces new validation failure reasons: `oldText_not_found`, `oldText_not_unique`. These will be returned as `validation_failed:oldText_not_found`, etc. The `mapRefreshError()` function uses `error.startsWith("validation_failed:")` so it will catch them, BUT:
**Risk:** If an implementer adds logging on specific failure codes in Phase 125b, they need to know the exact new error code strings. The plan is vague about the exact strings.
**Fix:** Phase 125a should define the exact error codes:
- `"validation_failed:invalid_old_text"` — oldText is empty / not a string
- `"validation_failed:invalid_new_text"` — newText is empty / not a string
- `"validation_failed:old_text_not_found"` — oldText not present in draft
- `"validation_failed:old_text_not_unique"` — oldText appears >1 time in draft (unsafe ambiguity)
- `"validation_failed:overlapping_ranges"` — computed ranges overlap (preserved from current)
- Retain existing: `new_text_not_candidate`, `duplicate_new_text`, `replacements_not_array`, `chunk_size_exceeded`
- Remove: `invalid_indices`, `out_of_bounds`, `old_text_mismatch` (no longer applicable)

### GAP-5 [MEDIUM] — Multi-pass loop assumes oldText stability across passes
**What:** The refresh function runs up to 10 passes. Each pass sends the CURRENT draft (after previous replacements) to the AI. The AI returns `oldText` strings that must be found in the current draft.
**Risk:** After pass 1 replaces some time offers, pass 2's draft is different. If the AI hallucates an `oldText` that was in the ORIGINAL draft but not the current one, locate will fail. This is actually BETTER than the old behavior (indices would definitely be wrong post-replacement), but the plan doesn't explicitly acknowledge this improvement or consider edge cases.
**Fix:** Add a note in Phase 125a that the multi-pass flow inherently benefits from the indexless approach since `oldText` is validated against the current state, and pass-to-pass drift in indices is eliminated. No code change needed, but add a test case in Phase 125c: "replacement in pass 2 uses updated draft" (conceptual assertion).

### GAP-6 [LOW] — `systemFallback` prompt still mentions indices in examples
**What:** While the plan says to "forbid returning indices," the current `systemFallback` prompt doesn't have examples. However, since the JSON schema with `strict: true` enforces the shape, the model CAN'T return indices even if it wanted to. But the prompt text should still be clear.
**Risk:** Minimal, since `strict: true` prevents extra fields. But keeping the prompt clean reduces confusion.
**Fix:** Ensure Phase 125a's prompt update explicitly says "Do NOT include startIndex or endIndex" for clarity, even though the schema enforces this.

### GAP-7 [LOW] — `refreshDraftAvailabilitySystem()` is untested and could be used by other phases
**What:** `draft-availability-refresh.ts` exports `refreshDraftAvailabilitySystem()` (line 162), a system-level wrapper that could be used by CLI scripts or background jobs. Phase 125 changes the core function it calls.
**Risk:** If Phase 123's draft pipeline ever calls `refreshDraftAvailabilitySystem()`, the contract must remain stable. The return type `RefreshDraftAvailabilityResult` (line 12-19) is unchanged, so this is LOW risk.
**Fix:** No code change needed, but acknowledge in Phase 125b that `refreshDraftAvailabilitySystem()` is an additional consumer and confirm its return shape is preserved.

### GAP-8 [LOW] — Missing test: empty replacements array with `done: true`
**What:** The test plan covers success and failure cases, but doesn't explicitly cover the "no changes needed" path where the AI returns `{ replacements: [], hasTimeOffers: true, done: true }`.
**Fix:** Add a test case in Phase 125c: "validate empty replacements returns ok with no changes."

## Open Questions (Need Human Input)

None — all decisions were locked in the planning conversation.

## Assumptions (Agent, ≥90% Confidence)

1. **gpt-5-nano with `strict: true` will consistently return valid `{ oldText, newText }` pairs** — Confidence 95%. The model has been reliable with structured outputs; removing indices simplifies the task.
2. **Phase 123 will not modify `lib/availability-refresh-ai.ts`** — Confidence 98%. Phase 123 focuses on draft pipeline memory/revision, not availability refresh.
3. **No other code paths import `AvailabilityReplacement` beyond tests and `draft-availability-refresh.ts`** — Confidence 95%. Verified via grep.
4. **`oldText` uniqueness check is sufficient for safety** — Confidence 92%. If a time offer appears identically twice in a draft (e.g., "10:00 AM EST" offered twice), the locate-based approach will correctly fail closed. This is safer than the index approach which could silently pick the wrong occurrence.

## Phase Summary (running)
- 2026-02-09 — Implemented indexless availability refresh replacements + safe locate-based validation, added non-PII failure logging, updated unit tests, and verified with `npm test`, `npm run lint`, `npm run build`. (files: `lib/availability-refresh-ai.ts`, `lib/draft-availability-refresh.ts`, `lib/__tests__/availability-refresh-ai.test.ts`)

## Phase Summary
- Shipped:
  - Indexless availability refresh contract (`{ oldText, newText }`) with deterministic locate-based validation (no brittle indices).
  - Non-PII failure logging for refresh failures.
  - Updated unit tests for validator behavior.
- Verified:
  - `npm test`: pass
  - `npm run lint`: pass (warnings only, pre-existing)
  - `npm run build`: pass
- Notes:
  - Manual Jam repro verification is pending a deploy (or a local run with real DB/auth).
  - Repo currently has unrelated uncommitted changes in `prisma/schema.prisma` (references `DraftPipelineRun` without the model) and `lib/workspace-capabilities.ts`. These are out of Phase 125 scope and should be resolved before re-running repo-wide gates.
