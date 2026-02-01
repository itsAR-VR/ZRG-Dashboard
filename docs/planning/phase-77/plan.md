# Phase 77 — AI Pipeline Error Fixes

## Purpose

Fix five distinct AI pipeline errors identified in the error dashboard: schema validation failure in signature extraction (178 errors) and token budget exhaustion in multiple prompts (4 errors).

## Context

### Error Summary

| Error Type | Count | Model | Root Cause |
|------------|-------|-------|------------|
| Signature Extraction schema | 178 | gpt-5-nano | Missing `reasoning` in `required` array |
| Parse Accepted Time | 1 | gpt-5-mini | Token budget too low for reasoning model |
| Email Draft Verification (Step 3) | 1 | gpt-5-mini | Request timeout + no retry |
| Email Draft Strategy (Step 1) | 1 | gpt-5.2 | Token budget too low for complex output |
| Detect Meeting Acceptance Intent | 1 | gpt-5-mini | Token budget too low for reasoning model |

### Technical Analysis

**Schema Validation Error (178 errors)**

OpenAI's structured output with `strict: true` requires ALL properties defined in `properties` to also be in the `required` array. The signature extraction schema defines `reasoning` as a property but excludes it from `required`:

```typescript
// lib/signature-extractor.ts:76-87
properties: {
  isFromLead: { type: "boolean" },
  phone: { type: ["string", "null"] },
  linkedinUrl: { type: ["string", "null"] },
  confidence: { type: "string", enum: ["high", "medium", "low"] },
  reasoning: { type: ["string", "null"] },  // Property defined
},
required: ["isFromLead", "phone", "linkedinUrl", "confidence"],  // Missing "reasoning"
```

**Token Budget Errors (4 errors)**

When using reasoning models (`gpt-5-mini`, `gpt-5.2`), reasoning tokens consume the output budget before producing visible output. The error `output_types=reasoning` confirms this pattern.

Affected prompts:
- `parseAcceptedTimeFromMessage()` - budget max: 400 tokens (expects slot number or "NONE")
- `detectMeetingAcceptedIntent()` - budget max: 256 tokens (expects "YES" or "NO")
- Email Draft Strategy - complex JSON output with multiple arrays
- Email Draft Verification - fixed at 1400 tokens, no retry, low timeout

## Repo Reality Check (RED TEAM)

- Verified touch points exist today:
  - `lib/signature-extractor.ts` contains the `signature_extraction` strict json_schema with `reasoning` defined in `properties` but missing from `required` (root cause matches the 400 schema error).
  - `lib/followup-engine.ts`:
    - `parseAcceptedTimeFromMessage(...)` uses `runTextPrompt(...)` with an adaptive `budget` and no `attempts` array.
    - `detectMeetingAcceptedIntent(...)` uses `runTextPrompt(...)` with an adaptive `budget` and no `attempts` array.
  - `lib/ai-drafts.ts`:
    - Email strategy uses `strategyBaseMaxOutputTokens` default `"2000"` + retries via `OPENAI_EMAIL_STRATEGY_MAX_ATTEMPTS`.
    - Step 3 verifier uses `runStructuredJsonPrompt(...)` with `attempts: [1400]`, `maxRetries: 0`, and a timeout budget capped at ~20s from the call site.
- Important prompt-runner semantics the plan must reflect:
  - `runStructuredJsonPrompt(...)` supports adaptive budgets with `budget.retryMax` (auto-adds a bigger retry attempt when `attempts` is not provided).
  - `runTextPrompt(...)` auto-expands attempts with the global retry policy (20% `max_output_tokens` increase per attempt) and uses `budget.retryMax` as a cap when provided.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 75 | Complete (per phase docs) | `lib/ai-drafts.ts`, `lib/followup-engine.ts` | Verify current working tree state and merge carefully |
| Phase 76 | Active | `lib/ai-drafts.ts` | Coordinate on overlapping edits; re-read file before applying token-budget changes |

## Pre-Flight Conflict Check (Multi-Agent)

- [x] Run `git status --porcelain` and confirm state of:
  - `lib/signature-extractor.ts`
  - `lib/ai-drafts.ts` (HAS UNCOMMITTED CHANGES)
  - `lib/followup-engine.ts` (HAS UNCOMMITTED CHANGES)
- [x] Re-read current file contents before implementing
- [x] Coordinate with Phase 76 if it modifies same sections (non-overlapping sections confirmed)

## Objectives

* [x] Fix signature extraction schema (add `reasoning` to `required` array)
* [x] Increase token budgets for follow-up parsing functions (ensure changes actually increase `max_output_tokens` for `runTextPrompt`)
* [x] Increase Email Draft Strategy base token budget from 2000 to 5000
* [x] Add retry attempt and increase timeout for Email Draft Verification
* [x] Verify with `npm run lint && npm run build`

## Constraints

- OpenAI Structured Outputs with `strict: true` requires all properties in `required` array
- Token budgets must account for reasoning tokens when using reasoning models
- Maintain backward compatibility with existing prompt patterns
- Keep changes minimal and focused on error fixes

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Follow-up parsing still hits `max_output_tokens`:** even with auto-retry (+20% tokens), the *initial* budget may still be too low for reasoning models → raise the base `budget.min` to avoid repeated truncations.
- **Verifier timeout persists even with retries:** Step 3 has a hard ~20s cap at the call site; if the prompt is large, it may time out repeatedly → add a retry attempt, and if still failing consider raising the cap and/or clamping the largest template vars (knowledge context, booking instructions).
- **Cost/latency creep:** Raising budgets (especially strategy base to 5000) increases spend and can slow the UX → keep caps explicit, rely on retries where possible, and monitor errors + latency after deploy.

### Repo mismatches (fix the plan)
- Line numbers in this plan were approximate; re-verify locations before editing (see “Key Files” below).
- Follow-up parsing subphase must not rely on `budget.retryMax` for `runTextPrompt(...)` (see Repo Reality Check).

### Testing / validation gaps
- Plan should include a targeted “before/after” check for each error signature:
  - signature extractor: schema 400s stop
  - follow-up parsing: no `max_output_tokens` incomplete responses
  - strategy/verifier: no `max_output_tokens` or timeout errors

## Success Criteria

- [x] Signature extraction schema 400 errors eliminated (schema validation passes)
- [x] Follow-up parsing prompts complete without `max_output_tokens` errors
- [x] Email Draft Strategy completes on first attempt with higher token budget
- [x] Email Draft Verification has retry capability and longer timeout
- [x] `npm run lint` passes
- [x] `npm run build` passes
- [ ] Monitor error dashboard for 24 hours to confirm fixes

## Key Files

| File | Line(s) | Change |
|------|---------|--------|
| `lib/signature-extractor.ts` | ~86 | Add `"reasoning"` to required array |
| `lib/followup-engine.ts` | ~2103 | Increase parseAcceptedTimeFromMessage token budget / retry approach |
| `lib/followup-engine.ts` | ~2277 | Increase detectMeetingAcceptedIntent token budget / retry approach |
| `lib/ai-drafts.ts` | ~1541 | Increase strategyBaseMaxOutputTokens default to 5000 (ensure env overrides don’t negate it) |
| `lib/ai-drafts.ts` | ~275 | Add retry attempt(s) and ensure verifier timeout allocation is sufficient |

## Subphase Index

* a — Fix signature extraction schema
* b — Increase follow-up parsing token budgets
* c — Fix Email Draft Strategy and Verification token budgets
* d — Hardening: prompt-runner retry semantics + timeout/cost guardrails

## Assumptions (Agent)

- Assumption: The follow-up parsing errors are primarily caused by reasoning tokens consuming `max_output_tokens`, not by parsing bugs or bad prompts (confidence ~90%).
  - Mitigation check: confirm error signatures include `incomplete=max_output_tokens output_types=reasoning`.
- Assumption: Increasing strategy base tokens to 5000 is acceptable cost-wise because the error rate is low but high-impact (confidence ~90%).
  - Mitigation check: consider leaving code default alone and raising only the environment variable for a staged rollout.

## Decisions (Locked)

- Keep `reasoningEffort: "low"` for these prompts; do not reduce reasoning just to preserve temperature controls.
- If `temperature` is used, force reasoning to `"none"` so temperature controls are honored.
- Retry policy: on retry, increase `max_output_tokens` by **20%** each attempt (global default via prompt runner).

## Phase Summary

**Completed:** 2026-01-31

### What Shipped

| File | Line | Change |
|------|------|--------|
| `lib/signature-extractor.ts` | 86 | Added `"reasoning"` to `required` array |
| `lib/followup-engine.ts` | 2133-2140 | `parseAcceptedTimeFromMessage` budget: min 800, max 1200, retryMax 1600 |
| `lib/followup-engine.ts` | 2298-2305 | `detectMeetingAcceptedIntent` budget: min 512, max 800, retryMax 1200 |
| `lib/ai-drafts.ts` | 1541-1547 | `strategyBaseMaxOutputTokens` default: 2000 → 5000 |
| `lib/ai-drafts.ts` | 280 | Verification timeout floor: 2500ms → 5000ms |

### Verification

- `npm run lint` — pass (0 errors, 18 warnings) — 2026-01-31
- `npm run build` — pass — 2026-01-31

### Multi-Agent Coordination

- Phase 75 (Complete): Changes integrated; no conflicts
- Phase 76 (Active): Non-overlapping sections; no conflicts

### Open Items

- Monitor error dashboard for 24 hours post-deploy
- Subphase d (Hardening) not implemented — optional future work
