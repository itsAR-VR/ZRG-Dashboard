# Phase 38 — AI JSON Parsing Robustness (Email Draft Strategy)

## Purpose
Fix the remaining AI JSON parsing failures in the email draft strategy step, and add enhanced telemetry to diagnose truncation issues more effectively.

## Context
The AI dashboard is reporting errors:

1. **Email Draft Strategy (Step 1)** — `strategy_parse_failed: Could not parse strategy JSON`
   - Model: `gpt-5.1`
   - Location: `lib/ai-drafts.ts` lines 556-574 (`parseStrategyJson`) and line 932 (`markAiInteractionError`)
   - Root cause: The model is likely returning truncated or malformed JSON that doesn't parse

2. **Lead Scoring** — ~~`Unexpected end of JSON input`~~ **FIXED in commit 15ace5c**
   - The lead scoring issue was already addressed with:
     - Switched to `extractFirstCompleteJsonObjectFromText` with `incomplete` status handling
     - Increased token budgets (min 400, max 1000)
     - Added retry logic for SyntaxError (truncated JSON)
     - Increased max retries from 2 to 3

The email draft strategy code still uses a simple `JSON.parse()` wrapped in try-catch without:
- Checking for incomplete/truncated JSON before parsing
- Logging the raw text that failed to parse (for debugging)
- Retrying with more tokens on truncation

## Repo Reality Check (RED TEAM)

- What exists today:
  - `lib/ai-drafts.ts`
    - Step 1 (email strategy) requests Structured Outputs via `text.format.type="json_schema"` with `strict: true`.
    - `parseStrategyJson()` uses truncation-aware extraction + validation and returns a structured parse status.
  - `lib/ai/response-utils.ts`
    - `extractFirstCompleteJsonObjectFromText()` exists and returns `{ status: "complete" | "incomplete" | "none" }`.
  - `lib/ai/openai-telemetry.ts`
    - `markAiInteractionError(interactionId, errorMessage)` exists and updates `AIInteraction.errorMessage` (capped to 10k).
  - `prisma/schema.prisma`
    - `AIInteraction` has `errorMessage` but no dedicated “raw output sample” field.
- What the plan assumes:
  - The dominant failure mode is truncated Structured Output JSON (rather than schema mismatch).
  - Capturing a small, capped sample of the model output is acceptable for admin-only debugging (with strict caps and no transcript storage).
- Verified touch points:
  - `lib/ai-drafts.ts`: `parseStrategyJson`, `generateResponseDraft` strategy step, `markAiInteractionError(...)` call site
  - `lib/ai/response-utils.ts`: `extractFirstCompleteJsonObjectFromText`, `getTrimmedOutputText`, `summarizeResponseForTelemetry`
  - `lib/ai/openai-telemetry.ts`: `runResponseWithInteraction`, `markAiInteractionError`

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 37 | Complete | None | UI-only changes; no overlap with AI/lib files |
| Phase 36 | Complete | Files: `lib/ai-drafts.ts` | Phase 36 added `bookingProcessInstructions`; changes are additive, no conflict |
| Phase 30 | Complete | Files: `lib/ai-drafts.ts` | Phase 30 introduced two-step email pipeline; this phase improves its robustness |

## Pre-Flight Conflict Check

- [x] Ran `git status` — no unexpected modifications to `lib/ai-drafts.ts`, `lib/ai/response-utils.ts`, `lib/ai/openai-telemetry.ts`, or `prisma/schema.prisma`
- [x] Scanned last 10 phases — no overlapping edits planned for these same files
- [x] Re-read current state of target code (don’t rely on line numbers)

## Objectives
* [x] Apply truncation-aware JSON extraction to email draft strategy parsing
* [x] Add retry with increased tokens on truncation (matching lead scoring pattern)
* [x] Improve error telemetry to capture raw response text for debugging
* [x] Ensure retries respect the overall timeout budget (no runaway latency)
* [x] Validate fixes with lint and build

## Constraints
- Follow the existing pattern established in `lib/lead-scoring.ts` (commit 15ace5c)
- Use `extractFirstCompleteJsonObjectFromText` from `lib/ai/response-utils.ts`
- Keep backward compatibility with existing email draft generation flow
- Maintain the two-step (strategy → generation) architecture from Phase 30
- Do not increase timeouts beyond reasonable webhook limits
- Do not persist full lead transcripts in telemetry; cap and minimize any stored samples
- Avoid schema migrations unless clearly justified (prefer `errorMessage`-based context first)

## Success Criteria
- Email draft strategy parsing handles truncated JSON gracefully (retry with more tokens)
- Error telemetry includes raw response text for failed parses (capped at reasonable length)
- Retry attempts are distinguishable in telemetry (e.g., `promptKey` suffix) and do not exceed the configured `timeoutMs` budget
- `npm run lint` passes without new errors
- `npm run build` succeeds

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **Runaway latency:** adding retries can exceed `timeoutMs` unless we enforce an overall time budget → timebox retries and clamp per-attempt timeouts based on remaining budget.
- **“Valid JSON, invalid shape”:** `parseStrategyJson` currently does not validate `times_to_offer`, even though the schema requires it → validate required fields (including `times_to_offer` type) and treat failures as `invalid`.
- **Telemetry blind spots:** a generic `strategy_parse_failed` string loses the why (incomplete vs none vs invalid) → include parse status, attempt counts, and a compact `summarizeResponseForTelemetry(...)` string.
- **PII/data minimization:** storing raw model output can include lead/company identifiers → cap aggressively, avoid transcripts, and consider logging-only vs DB persistence.

### Repo mismatches (fix the plan)
- SQL examples must quote camelCase columns in Postgres (e.g., `"featureId"`, `"createdAt"`, `"errorMessage"`) unless the DB uses mapped snake_case.

### Performance / timeouts
- Define an explicit token + timeout escalation policy (max tokens per attempt, max attempts) and ensure total wall-clock time remains within the caller’s `timeoutMs`.

### Security / permissions
- Treat raw samples as sensitive: cap length, avoid including user-provided transcript, and keep usage limited to admin debugging.

### Testing / validation
- Add a verification step to inspect `AIInteraction.outputTokens` vs configured `max_output_tokens` for the strategy feature to confirm truncation hypothesis.

## Subphase Index
* a — Apply truncation-aware parsing to email draft strategy
* b — Add retry logic for truncated strategy JSON
* c — Enhanced telemetry for JSON parse failures
* d — Hardening: timeboxed retries, schema size limits, and safe/debuggable telemetry

## Open Questions (Need Human Input)

- [x] Telemetry storage decision: keep DB storage as-is and add logs (Vercel) with the same “AI dashboard + Vercel visibility” pattern as lead scoring. (resolved 2026-01-19)
  - Implemented: categorized `AIInteraction.errorMessage` updates on final strategy parse failure + structured console logging.
- [x] Final failure behavior: do not fail; always fall back to a single-step generation, and if OpenAI still yields no output, produce a deterministic safe draft. (resolved 2026-01-19)

## Phase Summary

**Completed 2026-01-19**

- `lib/ai-drafts.ts`: strategy parsing now uses `extractFirstCompleteJsonObjectFromText` + strict runtime validation and returns a structured parse status.
- `lib/ai-drafts.ts`: Step 1 (strategy) retries with minimal latency and higher token budgets (starts at 2000, caps at 5000) and uses `.retryN` `promptKey` suffixes; retries are timeboxed to the strategy timeout budget.
- `lib/ai-drafts.ts`: final strategy parse failures are now categorized (`strategy_truncated` / `strategy_empty` / `strategy_invalid`) and recorded in `AIInteraction.errorMessage` with capped samples + `summarizeResponseForTelemetry(...)`, plus `console.error` for Vercel visibility.
- `lib/ai-drafts.ts`: schema size constraints were added to reduce truncation risk; email single-step fallback now retries and the overall draft path uses a deterministic safe fallback so `generateResponseDraft` won’t hard-fail due to empty OpenAI output.
- Validation: `npm run lint` passes (warnings only), `npm run build` succeeds.
- Review artifact: `docs/planning/phase-38/review.md`
