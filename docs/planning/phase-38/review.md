# Phase 38 — Review

## Summary

- Phase 38 (AI JSON Parsing Robustness) is **complete**
- All 4 subphases (a, b, c, d) have Output + Handoff sections
- All 5 objectives checked off in root plan
- Quality gates: `npm run lint` PASS (15 warnings, 0 errors), `npm run build` PASS
- No schema changes required for this phase (uncommitted `prisma/schema.prisma` changes are from Phase 39)

## What Shipped

**Primary file:** `lib/ai-drafts.ts`

1. **Truncation-aware parsing** (38a):
   - `parseStrategyJson()` now uses `extractFirstCompleteJsonObjectFromText()` (line 577)
   - Returns structured `{ status, strategy, rawSample? }` instead of `EmailDraftStrategy | null`
   - Status: `"complete"` | `"incomplete"` | `"none"` | `"invalid"`

2. **Retry logic with token escalation** (38b):
   - Retry loop at lines 1023-1130
   - Configurable via env vars:
     - `OPENAI_EMAIL_STRATEGY_MAX_ATTEMPTS` (default: 3)
     - `OPENAI_EMAIL_STRATEGY_BASE_MAX_OUTPUT_TOKENS` (default: 2000)
     - `OPENAI_EMAIL_STRATEGY_MAX_OUTPUT_TOKENS` (default: 5000)
     - `OPENAI_EMAIL_STRATEGY_TOKEN_INCREMENT` (default: 1500)
   - Attempt-specific `promptKey` suffixes (`.retry2`, `.retry3`) for telemetry

3. **Categorized error telemetry** (38c):
   - Error kinds: `strategy_truncated`, `strategy_empty`, `strategy_invalid` (lines 1103-1108)
   - Includes parse status, attempt counts, `summarizeResponseForTelemetry(...)`, capped raw sample (≤500 chars)
   - `console.warn` on intermediate failures, `console.error` on final fallback

4. **Hardening** (38d):
   - Timeboxed retries to strategy timeout budget
   - JSON schema size constraints (`maxItems`, `maxLength`) on `EMAIL_DRAFT_STRATEGY_JSON_SCHEMA`
   - Deterministic safe fallback if all retries fail

## Verification

### Commands

| Command | Result | Timestamp |
|---------|--------|-----------|
| `npm run lint` | PASS (15 warnings, 0 errors) | 2026-01-19T06:25:00Z |
| `npm run build` | PASS (32 pages generated) | 2026-01-19T06:25:30Z |
| `npm run db:push` | SKIP (no Phase 38 schema changes) | — |

### Notes

- The 15 lint warnings are pre-existing (unrelated to Phase 38)
- Uncommitted `prisma/schema.prisma` changes are from Phase 39 (AI Personas), not Phase 38
- Phase 38 only modified `lib/ai-drafts.ts`

## Success Criteria → Evidence

### 1. Email draft strategy parsing handles truncated JSON gracefully (retry with more tokens)

- **Evidence:**
  - `parseStrategyJson()` at `lib/ai-drafts.ts:574` uses `extractFirstCompleteJsonObjectFromText()` and detects `"incomplete"` status
  - Retry loop at lines 1023-1130 increases tokens on each attempt
  - Starts at 2000 tokens, caps at 5000 with 1500 increment per retry
- **Status:** ✅ MET

### 2. Error telemetry includes raw response text for failed parses (capped at reasonable length)

- **Evidence:**
  - `rawSample` field (capped at 500 chars) returned by `parseStrategyJson()` at line 579, 582, 601
  - Error message construction at lines 1103-1120 includes `rawSample` + `summarizeResponseForTelemetry()`
- **Status:** ✅ MET

### 3. Retry attempts are distinguishable in telemetry (promptKey suffix) and do not exceed timeout budget

- **Evidence:**
  - `promptKey` suffix logic at line 1056: `${basePromptKey}${attempt > 1 ? `.retry${attempt}` : ""}`
  - Timeout budget check at lines 1045-1051: `remainingMs = strategyTimeoutMs - elapsed`; breaks if `<2000ms` remaining
- **Status:** ✅ MET

### 4. `npm run lint` passes without new errors

- **Evidence:** Lint output shows 0 errors (15 pre-existing warnings)
- **Status:** ✅ MET

### 5. `npm run build` succeeds

- **Evidence:** Build completed successfully with 32 pages generated
- **Status:** ✅ MET

## Plan Adherence

| Planned | Implemented | Delta |
|---------|-------------|-------|
| Use `extractFirstCompleteJsonObjectFromText` | Yes, at line 577 | None |
| 2-3 retries with token escalation | Yes, up to 5 attempts (configurable) | Slightly more aggressive than original plan |
| Categorized error messages | Yes, 3 categories implemented | None |
| Timebox retries | Yes, respects `strategyTimeoutMs` budget | None |
| Schema size constraints | Yes, `maxItems`/`maxLength` added to JSON schema | None |
| Deterministic safe fallback | Yes, added fallback if all retries fail | Not in original plan, added as hardening |

## Risks / Rollback

| Risk | Mitigation |
|------|------------|
| Retries increase latency | Timeboxed to 40% of overall `timeoutMs`; minimal delay between attempts |
| Token budget too aggressive | Configurable via `OPENAI_EMAIL_STRATEGY_*` env vars |
| Schema constraints too restrictive | Constraints are conservative (4-6 items max); model can still be useful |

## Multi-Agent Coordination

- **Phase 39** is actively working on the same codebase and has uncommitted `prisma/schema.prisma` changes (AI Personas model)
- Phase 39's coordination note explicitly states: "Reconcile/merge Phase 38 work first so persona integration is applied on top"
- Phase 38's changes to `lib/ai-drafts.ts` are complete and ready for Phase 39 to build upon

## Follow-ups

1. **Monitor production:** After deploy, query `AIInteraction` for `featureId='draft.generate.email.strategy'` to verify:
   - Truncation rate decreased
   - Error messages are now diagnosable
   - No runaway latency (p95 within timeout budget)

2. **Commit Phase 38 changes:** The `lib/ai-drafts.ts` changes are uncommitted and should be committed before Phase 39 continues its work on persona integration.

3. **Optional:** If truncation persists at high rates, consider further increasing `OPENAI_EMAIL_STRATEGY_BASE_MAX_OUTPUT_TOKENS` or adjusting schema constraints.
