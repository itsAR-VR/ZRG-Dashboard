# Phase 96 — AI Availability Refresh (Inline + Section Times)

## Purpose
Fix the "Refresh availability times" action so it works even when drafts **do not** contain the structured `AVAILABLE TIMES` bullet section (e.g., times are offered inline in prose). The refreshed draft must remain identical except for the swapped time options, using **GPT-5 Nano (`gpt-5-nano`)** at low temperature.

## Context
Jam report: `https://jam.dev/c/55500533-fbe9-4fea-bb5a-d2b23a83e372`

Observed behavior:
- Draft offers times inline (e.g., "9:00 AM EST on Mon, Feb 2 or 3:00 PM EST on Fri, Feb 6").
- Clicking Refresh calls `refreshDraftAvailability(draftId, currentContent)` and returns:
  - `This draft doesn't contain availability times to refresh`

Root cause:
- Current refresh logic requires a structured availability section that `extractAvailabilitySection()` can parse. Inline time offers are not supported, so the action errors.

Decisions locked from the conversation:
- Do **not** rely on deterministic parsing/replacement for refresh; use a low-temperature LLM to identify and swap time options.
- Model must be **fast**: use **`gpt-5-nano`**.
- Replace **any** time offers in the draft that are:
  - not present in the current availability list, or
  - "today" or in the past (where "today" is based on the **lead timezone**).
- Replacement times must be **verbatim** from a capped availability list (to validate correctness).
- Provide the LLM up to **50** candidate availability slot labels.
- Preserve the draft's timezone token style (e.g., keep using explicit "EST/PST" style; do not switch to "(your time)").
- Avoid re-offering slots already present in `Lead.offeredSlots`.
- No partial writes: if we can't safely refresh all targeted time offers within guardrails, return an error and do not update DB.
- Operational failsafe: **max 10 AI passes** (chunked).
- If the draft contains no identifiable time offers to swap, return an error that suggests regenerating the draft.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 95 | Uncommitted working tree | `components/dashboard/action-station.tsx` button cluster; draft actions | Re-read current UI cluster before changing Refresh UX/handlers; avoid button order regressions. |
| Phase 94 | Uncommitted working tree | AI prompt runner patterns, timeouts/budgets | Follow Phase 94 timeout/budget conventions; ensure new prompt is bounded (50 slots, low maxOutputTokens). |
| Phase 87 | Landed | `refreshDraftAvailability` behavior and messaging | Phase 96 intentionally changes Phase 87's "deterministic only" constraint; keep the same external action signature but replace internal logic with AI + strict validation. |

Repo note (pre-flight):
- Working tree is currently dirty (multiple modified files + untracked phase folders). Implementation must re-read target files before editing and merge semantics carefully.

## Objectives
* [x] Build a bounded candidate-slot list (≤50) that excludes repeats and today/past (lead TZ).
* [x] Implement an AI-driven refresh engine using `gpt-5-nano` returning structured replacements (indices + old/new text).
* [x] Add strict validation to ensure only time strings are changed and replacements are verbatim from candidate slots.
* [x] Wire the engine into both UI and system refresh paths; update DB + slot ledger only on success.
* [x] Add tests for the deterministic validation/apply layer and a manual QA checklist mirroring the Jam steps.

## Constraints
- **Model:** Use `gpt-5-nano` for refresh.
- **Verbatim replacements:** AI may only insert labels that exactly match one of the candidate slot labels provided.
- **Strict diff guard:** Only apply changes returned as validated replacements; no free-form "rewritten draft" accepted.
- **No partial DB writes:** If we can't complete refresh safely, return an error and do not update `AIDraft`/`Lead`/ledger.
- **Availability cap:** Provide at most 50 candidate slots to AI to control latency/cost.
- **Time basis:** "today/past" filtering is based on lead timezone (fallback workspace timezone → UTC).
- **Exclude repeats:** Do not offer slots already in `Lead.offeredSlots`.
- **Max passes:** 10; chunk replacements per pass (implementation-defined).
- **No secrets:** Never log or persist tokens, cookies, or secrets from network traces.

## Success Criteria
* [x] Jam scenario: clicking Refresh updates inline offered times to valid future availability (and no longer errors).
* [x] Refresh works for both:
  - drafts with a structured `AVAILABLE TIMES` section, and
  - drafts with inline/prose time offers.
* [x] Only time offers change; all other text/formatting remains identical.
* [x] Refresh rejects unsafe AI outputs (invalid indices, non-verbatim insertions, or non-time edits).
* [x] Tests and build gates pass (`npm run test`, `npm run lint`, `npm run build`).

## Subphase Index
* a — Candidate Slot List Builder (≤50, TZ-safe, exclude repeats)
* b — AI Refresh Engine (gpt-5-nano structured replacements + validation)
* c — Action Wiring + DB/Ledger Updates (UI + system)
* d — Tests + UX + QA Checklist

---

## Repo Reality Check (RED TEAM)

### What Exists Today

| Component | File Path | Verified |
|-----------|-----------|----------|
| UI refresh action | `actions/message-actions.ts:1460` (`refreshDraftAvailability`) | ✓ |
| System refresh action | `lib/draft-availability-refresh.ts:26` (`refreshDraftAvailabilitySystem`) | ✓ |
| Availability section parser | `lib/availability-slot-parser.ts` (`extractAvailabilitySection`, `replaceAvailabilitySlotsInContent`) | ✓ |
| Workspace slots fetcher | `lib/availability-cache.ts` (`getWorkspaceAvailabilitySlotsUtc`) | ✓ |
| Slot offer ledger | `lib/slot-offer-ledger.ts` (`getWorkspaceSlotOfferCountsForRange`, `incrementWorkspaceSlotOffersBatch`) | ✓ |
| Slot distribution | `lib/availability-distribution.ts` (`selectDistributedAvailabilitySlots`) | ✓ |
| Slot formatting | `lib/availability-format.ts` (`formatAvailabilitySlots`) | ✓ |
| Timezone inference | `lib/timezone-inference.ts` (`ensureLeadTimezone`) | ✓ |
| Qualification state | `lib/qualification-answer-extraction.ts` (`getLeadQualificationAnswerState`) | ✓ |
| Prompt runner | `lib/ai/prompt-runner/runner.ts` (`runStructuredJsonPrompt`) | ✓ |
| UI button | `components/dashboard/action-station.tsx:1130-1145` (Clock icon button) | ✓ |

### Current Failure Point (Line Reference)

`actions/message-actions.ts:1497-1500`:
```ts
const section = extractAvailabilitySection(currentContent);
if (!section) {
  return { success: false, error: "This draft doesn't contain availability times to refresh" };
}
```

`lib/draft-availability-refresh.ts:54-57`:
```ts
const section = extractAvailabilitySection(currentContent);
if (!section) {
  return { success: false, error: "no_availability_section" };
}
```

### gpt-5-nano Usage Pattern (Verified)

Existing usages follow this pattern (e.g., `lib/timezone-inference.ts:204`):
```ts
model: "gpt-5-nano",
reasoningEffort: "low" | "minimal",
```

Phase 96b should use `reasoningEffort: "minimal"` and `temperature: ~0.1` for maximum determinism.

---

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-Risk Failure Modes

| Risk | Mitigation |
|------|------------|
| **AI hallucinates time strings not in candidate list** | Strict validation: `newText ∈ candidates` exact match check before applying. Fail entire refresh if any replacement fails validation. |
| **AI returns overlapping replacement ranges** | Validation must reject overlapping `[startIndex, endIndex)` intervals. Apply replacements in reverse order to preserve indices. |
| **AI modifies non-time text (salutation, body, signature)** | Validation: `draft.slice(startIndex, endIndex) === oldText` must hold. Consider heuristic that `oldText` must contain time-like patterns (AM/PM, digits, day names). |
| **Infinite loop / timeout if AI never returns `done: true`** | Max 10 passes hard limit. If exhausted, fail with error (no partial write). |
| **Draft has no time offers at all** | AI should indicate `replacements: []` + `done: true`. Distinguish from "has times but all are valid" vs "no times found". Need explicit signal field. |

### Missing or Ambiguous Requirements

| Gap | Resolution |
|-----|------------|
| **How to detect "draft has no time offers at all" vs "all times are already valid"?** | Add `hasTimeOffers: boolean` field to AI response schema. If `hasTimeOffers: false` and `replacements.length === 0`, return error suggesting regeneration. If `hasTimeOffers: true` and `replacements.length === 0`, times are already valid—return success with no changes. |
| **What if the candidate list is empty after filtering?** | Return error "No available time slots found" (already handled in current code at line 1515). |
| **What if AI returns replacements but all fail validation?** | Fail entire refresh, no DB write. Log details for debugging. |
| **Timezone token style preservation** | Plan says "preserve EST/PST style"—but the AI prompt must explicitly instruct this. Add constraint: "Match the timezone abbreviation style already used in the draft." |
| **Chunk size for replacements?** | Plan mentions `chunkSize=10` but doesn't justify. Recommend `chunkSize=5` to reduce validation complexity per pass. |

### Repo Mismatches (Fix the Plan)

| Issue | Correction |
|-------|------------|
| Plan 96a references `Lead.offeredSlots` as JSON string with `{ datetime, label, offeredAt, availabilitySource }` | ✓ Verified: `lib/draft-availability-refresh.ts:144-150` confirms structure. No fix needed. |
| Plan 96c references `revalidatePath("/")` for UI action | ✓ Verified: `actions/message-actions.ts` imports `revalidatePath`. No fix needed. |
| Plan 96b says use `runStructuredJsonPrompt` | ✓ Verified in `lib/ai/prompt-runner/runner.ts`. Pattern requires `featureId` and `promptKey` for telemetry. Add these to plan. |

### Performance / Timeouts

| Risk | Mitigation |
|------|------------|
| AI refresh could timeout under load | Set explicit `timeoutMs` per-call (suggest 15s per pass, configurable via `OPENAI_AVAILABILITY_REFRESH_TIMEOUT_MS`). Total budget: 10 passes × 15s = 150s max (well under Vercel function limit). |
| 50 slots in prompt could push token limits | At ~10 tokens per slot label, 50 slots ≈ 500 tokens. Draft content up to 2000 chars ≈ 500 tokens. Total input ≈ 1500 tokens. Safe for gpt-5-nano. |
| Output token budget | Max 10 replacements × ~50 tokens each = 500 tokens. Set `maxOutputTokens: 800` to be safe. |

### Security / Permissions

| Risk | Mitigation |
|------|------------|
| AI refresh must respect user access | ✓ Already handled: `requireLeadAccess(draft.leadId)` in UI action. System action bypasses auth (by design for background jobs). |
| AI prompt could leak sensitive data | Don't include conversation history in refresh prompt—only draft content and candidate slots. No PII beyond what's in the draft. |

### Testing / Validation

| Gap | Mitigation |
|-----|------------|
| No existing tests for inline time detection | Add unit tests in Phase 96d for the AI validation/apply layer. |
| No integration test for end-to-end refresh | Manual QA checklist: reproduce Jam scenario, verify Refresh button works. |
| Edge case: draft with zero time offers | Test that error message suggests regeneration. |
| Edge case: draft with all-valid time offers | Test that refresh succeeds with no changes (returns current content). |

### Multi-Agent Coordination

| Check | Status |
|-------|--------|
| Last 10 phases scanned for overlap | ✓ Phase 94 (AI timeouts) + Phase 95 (Fast Regen) + Phase 87 (original refresh) all touch related areas. |
| Uncommitted changes in `lib/ai-drafts.ts` | ⚠️ Yes—Phase 94 modified this file. Re-read before implementing Phase 96. |
| Uncommitted changes in `lib/draft-availability-refresh.ts` | ⚠️ Yes—in working tree. Re-read before editing. |
| Uncommitted changes in `actions/message-actions.ts` | ⚠️ Appears clean in git status. Verify before editing. |
| Coordination strategy | Phase 96c must re-read target files. If Phase 94/95 land first, merge semantically. |

---

## Assumptions (Agent)

1. **Assumption:** `gpt-5-nano` can reliably identify time strings in prose and return accurate `startIndex`/`endIndex` pairs.
   - *Confidence:* ~85%
   - *Mitigation:* Strict validation ensures bad outputs are rejected. If validation failure rate is high, escalate to `gpt-5-mini`.

2. **Assumption:** 50 candidate slots is sufficient coverage for most workspaces.
   - *Confidence:* ~95%
   - *Mitigation:* Configurable cap via env var if needed later.

3. **Assumption:** AI can reliably distinguish "no time offers in draft" from "all times are already valid."
   - *Confidence:* ~80%
   - *Mitigation:* Add explicit `hasTimeOffers` field to schema. If AI misreports, UX may show confusing message—acceptable for v1.

4. **Assumption:** Temperature ~0.1 provides sufficient determinism for structured replacement output.
   - *Confidence:* ~90%
   - *Mitigation:* If AI output varies too much, drop to temperature 0.0.

---

## Decisions Locked (from RED TEAM review)

1. **Valid times behavior:** Return success + info toast "Availability times are already current" when all times are already valid (no-op scenario).

2. **Multi-section handling:** AI treats the draft holistically and replaces all outdated time offers regardless of format (inline prose + structured sections).

---

## Validation
- `npm run test` — pass (117 tests).
- `npm run lint` — 0 errors, 22 warnings (existing baseline-browser-mapping + hooks/img warnings).
- `npm run build` — success (baseline-browser-mapping warning emitted).

## Phase Summary
- Added AI-driven availability refresh with guarded, candidate-only replacements (gpt-5-nano, minimal reasoning, low temp).
- Unified system + UI refresh paths to use the new engine, updating drafts + offered slot ledger only on validated changes.
- Added deterministic validation/candidate tests and improved refresh UX to distinguish no-op vs missing times.
