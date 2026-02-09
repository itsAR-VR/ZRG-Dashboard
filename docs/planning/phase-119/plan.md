# Phase 119 — Reduce AI Truncation + Step 3 Rewrite Noise (Insights Thread Extract + Email Verifier)

## Purpose
Roll out durable fixes to stop recurring `max_output_tokens` truncation errors in **Insights: Thread Extract** and reduce noisy **Email Draft Verification (Step 3)** guardrail failures, without changing the default model away from `gpt-5-mini`.

## Context
- Production surfaced high-volume errors:
  - **Insights: Thread Extract** (`gpt-5-mini`) repeatedly returns `Post-process error: hit max_output_tokens (incomplete=max_output_tokens output_types=reasoning,message)` (reported: ~530 errors).
  - **Email Draft Verification (Step 3)** (`gpt-5.2`) triggers `email_step3_rewrite_guardrail` (reported: 6 errors).
- Root causes (grounded in repo semantics):
  - For GPT-5 reasoning models, **reasoning tokens consume `max_output_tokens`**, so a strict JSON schema + medium/high reasoning can hit budget before emitting valid output.
  - Step 3 verifier sometimes “helpfully rewrites” instead of applying minimal edits; the guardrail correctly rejects these, but the current system produces noisy failures.
- Repo state right now (must be handled explicitly):
  - Working tree contains uncommitted changes addressing these issues in:
    - `lib/insights-chat/thread-extractor.ts`, `lib/insights-chat/chat-answer.ts`
    - `lib/ai/prompt-runner/*`, `lib/ai/openai-telemetry.ts`
    - `lib/ai-drafts.ts`, `lib/ai-drafts/step3-guardrail.ts`, `lib/ai-drafts/step3-verifier.ts`
    - plus new tests under `lib/ai-drafts/__tests__/`
  - These were produced during exploration and must be reviewed, wired into the test runner, and committed in a controlled way.

## Concurrent Phases
Overlaps detected by scanning the last 10 phases (118 → 109).

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 109 | Complete | Insights extraction budgets + `lib/insights-chat/thread-extractor.ts` | Phase 119 builds on 109; do not revert 109’s reliability hardening. |
| Phase 116 | Complete | `lib/ai-drafts.ts` touched historically | Re-read current `lib/ai-drafts.ts` state; keep changes additive and safe-fallback. |
| Phase 111 | Complete | Test harness patterns (`scripts/test-orchestrator.ts`) | Follow existing node-test + tsx conventions and keep tests deterministic. |
| Phase 118/117 | Complete (committed to main) | No direct file overlap | Ensure Phase 119 commits are clean and do not drag in unrelated changes. |

## Objectives
* [ ] Consolidate, validate, and commit the current fix set for Insights Thread Extract truncations.
* [ ] Consolidate, validate, and commit Step 3 verifier hardening so rewrite guardrails trip rarely and safely.
* [ ] Deploy and verify error-rate reduction via the in-app AI Dashboard and Vercel logs.
* [ ] Add the minimal long-term durability improvements (retry budget semantics + fallback paths) if error rates remain above threshold after rollout.

## Constraints
- Do not commit secrets/tokens/PII.
- Keep **Insights default model** on `gpt-5-mini` (no default switch to `gpt-5.2`).
- No Prisma schema changes in this phase (no new DB columns); any “severity” tracking must be done without migrations.
- Preserve repo conventions:
  - Server Actions return `{ success, data?, error? }`.
  - Cron/admin endpoints validate secrets before reading request bodies.
- Quality gates required before “done”:
  - `npm test`
  - `npm run lint`
  - `npm run build`

## Success Criteria
1. **Insights**: `insights.thread_extract` stops producing repeated `max_output_tokens` truncations in normal operation.
   - Target: error rate < 1% over a 24h window for that feature/model in AI Dashboard.
2. **Email Step 3**: `email_step3_rewrite_guardrail` becomes rare and never blocks draft creation.
   - Target: guardrail triggers < 1% of Step 3 calls; Step 2 draft remains usable when Step 3 is discarded.
3. No regressions:
   - `npm test`, `npm run lint`, `npm run build` pass locally.
   - Cron endpoints still succeed with correct auth.

## Subphase Index
* a — Consolidate + validate + commit the current fix set (tests included)
* b — Deploy + production verification + monitoring thresholds
* c — Durability improvements (retry budget semantics + Insights fallback) if thresholds aren't met
* d — Documentation/runbook updates for new knobs + operational guidance

---

## RED TEAM Findings (Phase-Gaps Audit)

_Audited: 2026-02-09 · Repo reality verified against working tree + HEAD (d4f5ccf)_

### Repo Reality Check

| File / Artifact | Plan Claim | Verified | Notes |
|---|---|---|---|
| `lib/insights-chat/thread-extractor.ts` | Budget config exists with retryMax/retryExtraTokens | **YES** | `budget: { min: 1000, max: 3200, retryMax: 6400, retryExtraTokens: 1600, ... }` |
| `lib/insights-chat/chat-answer.ts` | Token budget handling | **PARTIAL** | No `retryMax` or `retryExtraTokens` — relies on runner defaults. If chat answers truncate, same hardening is needed. |
| `lib/ai/prompt-runner/runner.ts` | Retry expansion uses retryExtraTokens | **YES** | Uses `expandOutputTokenAttempts()` from `lib/ai/prompt-runner/attempts.ts` which expands by `max(ceil(prev*multiplier), prev+retryExtraTokens)` capped by `retryMax`. |
| `lib/ai/prompt-runner/types.ts` | Budget types include retryExtraTokens | **YES** | `retryExtraTokens?: number` exists in `PromptBudgetParams`. Also has unused `retryMinBaseTokens?: number`. |
| `lib/ai/prompt-runner/attempts.ts` | Retry attempt expansion helper exists | **YES** | Pure helper for deterministic unit tests and runner parity across structured/text prompts. |
| `lib/ai/openai-telemetry.ts` | Metadata allowlist restricts fields | **YES** | Allowlist: `["leadContextBundle", "followupParse", "bookingGate", "autoSendRevision"]` |
| `lib/ai-drafts.ts` | Step 3 integrated with guardrail + fallback | **YES** | `runEmailDraftVerificationStep3()` calls guardrail; returns original draft on failure. Never blocks draft delivery. |
| `lib/ai-drafts/step3-verifier.ts` | Verification logic exists | **YES** | Mechanical edits only: em-dash normalize, forbidden terms, booking link canonicalize/dedupe. |
| `lib/ai-drafts/step3-guardrail.ts` | Guardrail with configurable thresholds | **YES** | 5 env vars, all with defaults. Logic: `(ratio > 0.45 && delta > 250) || delta > 900 || (lineRatio > 0.5 && lineDelta >= 3)` |
| `lib/ai-drafts/__tests__/step3-verifier.test.ts` | Tests exist | **YES** | 9 tests covering em-dash, booking link, forbidden terms. Uses `node:test` + `assert/strict`. |
| `lib/ai-drafts/__tests__/step3-guardrail.test.ts` | Tests exist | **YES** | Expanded with boundary-condition coverage + identical-draft checks. |
| `lib/__tests__/prompt-runner-attempt-expansion.test.ts` | Tests exist | **YES** | Verifies `retryExtraTokens` semantics (multiplier vs additive, cap behavior). |
| `scripts/test-orchestrator.ts` | Tests wired into `npm test` | **YES** | Registered Step 3 verifier/guardrail tests and prompt-runner attempt-expansion test. |
| `lib/ai/prompt-registry.ts` | Prompts defined for Step 3 + Insights | **YES** | `draft.verify.email.step3.v1`, `insights.thread_extract.v1/.v2`, `insights.chat_answer.v1/.v2/.v3` all present. |
| `AGENTS.md` / docs | Env knobs documented | **NO** | None of the Phase 119 env vars are documented anywhere in repo docs. |

### Gap Findings

#### GAP-1: Test Orchestrator Not Updated (RESOLVED)
- **Resolution**: Added Step 3 tests and prompt-runner attempt-expansion test to `scripts/test-orchestrator.ts`. `npm test` now executes them.

#### GAP-2: `retryExtraTokens` Is Semantic Dead Code (RESOLVED)
- **Resolution**: Implemented additive retry headroom in prompt-runner attempt expansion (`lib/ai/prompt-runner/attempts.ts`) and wired into `lib/ai/prompt-runner/runner.ts` for both structured-json and text prompts. Added unit tests.
- **Remaining**: `retryMinBaseTokens` remains unused and should be removed or documented if it’s truly intended for future work.

#### GAP-3: Guardrail Test Coverage Is Thin (PARTIALLY RESOLVED)
- **Resolution**: Added boundary-condition + identical-draft coverage.
- **Remaining**: No direct tests for env var coercion behavior (fallbacks on invalid env strings).

#### GAP-4: `chat-answer.ts` Budget Missing Retry Expansion Fields
- **Risk**: Low (today) — Chat answers are smaller than thread extracts. But if volume scales, the same truncation pattern could appear.
- **Fix**: Add `retryMax` and `retryExtraTokens` to chat-answer budget config. Can be deferred to 119c if 119b shows no chat-answer truncations.

#### GAP-5: Phase 119d References `AGENTS.md` but File Is Named `CLAUDE.md`
- **Risk**: Low — 119d step 1 says "Existing repo conventions in `AGENTS.md`". The actual repo conventions file is `CLAUDE.md`. If an `AGENTS.md` also exists, both should be checked.
- **Fix**: Verify which file(s) to update; use `CLAUDE.md` as the canonical reference.

#### GAP-6: 119c "Lite Extraction" Schema Compatibility Unspecified
- **Risk**: Medium — 119c proposes a "lite" extraction fallback with reduced schema, but doesn't specify:
  - How the DB/UI handles a lite result (missing fields? nulls? different shape?)
  - Whether `InsightsExtraction` model or its consumers tolerate partial data.
  - What "valid shape expected by DB/UI" means concretely — need to trace the consumers.
- **Fix**: Add a step in 119c to enumerate all consumers of thread-extract output and verify they handle optional/reduced fields gracefully.

#### GAP-7: No Rollback Plan for 119a Commits
- **Risk**: Low — Since 119a commits are additive (no schema changes, no destructive ops), rollback is a simple `git revert`. But the plan should state this explicitly.
- **Fix**: Add a one-liner to 119a: "Rollback: `git revert` the commit series. No migrations to undo."

#### GAP-8: Phase 118 Status Ambiguity
- **Risk**: Low — Root plan says Phase 118/117 is "In progress (release packaging)" but the research shows both are committed to main. If 118 is actually complete, the coordination table should reflect that.
- **Fix**: Update the Concurrent Phases table to mark 117/118 as Complete.

#### GAP-9: Deployment/Verification Blocked in This Sandbox
- **Risk**: High — We cannot deploy to Vercel or fetch Vercel logs/AI Dashboard evidence from this environment.
- **Cause**: Outbound DNS resolution fails (e.g. `api.vercel.com` ENOTFOUND).
- **Fix**: Run Phase 119b from a normal dev environment or CI runner with network access.

### Assumptions (≥90% Confidence)

1. **The working-tree changes are the complete fix set.** The modified/new files listed in 119a Inputs match `git status`. No additional files are needed for the truncation/guardrail fixes.
   - _Mitigation_: `git diff --stat` before committing to confirm file list.

2. **Local quality gates pass** (`npm test`, `npm run lint`, `npm run build`).
   - _Mitigation_: Re-run gates after any further prompt-runner or prompt changes.

3. **Step 3 guardrail thresholds (0.45 ratio, 250/900 delta) are reasonable defaults** for production.
   - _Mitigation_: Env vars allow runtime tuning without redeploy.

4. **No Prisma schema changes are needed** — confirmed no new models/fields in working tree diff.

### Open Questions (<90% Confidence)

1. **Q: Does the "lite" extraction fallback (119c) require DB schema changes?**
   If the lite result has fewer fields than the full extraction, do `InsightsExtraction` consumers (UI components, cron summaries) handle missing data gracefully?
   - _Confidence_: 70%
   - _Action_: Before starting 119c, trace all read-sites for thread-extract output.

2. **Q: Is `OPENAI_PROMPT_MAX_ATTEMPTS=2` sufficient for insights truncation recovery?**
   With multiplier 1.2, attempt 2 gets 1.2× budget. For a 3200-token max, that's only 3840 on retry — still well below retryMax of 6400. A third attempt might be needed.
   - _Confidence_: 75%
   - _Action_: After 119b monitoring, check if failures are attempt-2 exhaustion. If so, bump default or add to 119c scope.

## Phase Summary (running)
- 2026-02-09 — Consolidated + validated fixes; implemented `retryExtraTokens` semantics with tests; deploy is currently blocked in this environment due to outbound DNS resolution failures (files: `lib/ai/prompt-runner/runner.ts`, `lib/ai/prompt-runner/attempts.ts`, `lib/__tests__/prompt-runner-attempt-expansion.test.ts`, `scripts/test-orchestrator.ts`).
