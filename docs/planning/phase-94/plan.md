# Phase 94 — AI Timeout + Token Budget Mitigations (Draft Verifier, Signature Context, Follow-Up Parsing)

## Purpose
Reduce OpenAI **request timeouts** and `max_output_tokens` truncations in the AI pipeline (email draft verification, signature context extraction, proposed-times parsing, lead scoring) while hardening Vercel cron execution to avoid burst-induced failures. Update repo docs so Vercel cron/log workflows are documented correctly.

## Status (Current)
- Code changes complete (Phases 94a–94d) + local lint/build passed (Phase 94e step 1).
- Production deployment + “before/after” telemetry verification: pending (requires deploy + monitoring window).

## Context
User-reported errors (2026-02-02):
- **Email Draft Verification (Step 3)** (`gpt-5-mini`) — repeated **Request timed out**.
- **Signature Context (Drafts)** (`gpt-5-nano`) — repeated **Request timed out**.
- **Lead Scoring** (`gpt-5-nano`) — intermittent **500** errors with OpenAI request IDs.
- **followup.parse_proposed_times** (`gpt-5-mini`) — `max_output_tokens` incomplete output (reasoning tokens consumed the budget).

Repo investigation (source-of-truth: `AIInteraction` telemetry + current code):
- `draft.verify.email.step3` errors cluster at ~20s and are dominated by:
  - `source=background-job/email-inbound-post-process`
  - `source=action:message.regenerate_draft`
  This aligns with the hard Step 3 timeout cap in `lib/ai-drafts.ts` (`Math.min(20_000, ...)`).
- `signature.context` errors cluster at ~4.5s, aligning with the signature context timeout cap in `lib/ai-drafts.ts` and the default in `lib/email-signature-context.ts` (4.5s).
- `followup.parse_proposed_times` has `budget.retryMax`, but default prompt-runner attempts may never reach it, especially when `OPENAI_PROMPT_MAX_ATTEMPTS=2`.
- `lead_scoring.score` errors are OpenAI 500s (transient provider failures), not local timeout caps.

Key implementation details in this repo:
- OpenAI requests run through `lib/ai/openai-telemetry.ts`:
  - Default per-request `timeout` is from `OPENAI_TIMEOUT_MS` (fallback 90s).
  - Default SDK `maxRetries` is from `OPENAI_MAX_RETRIES` (fallback 5).
  - Errors are recorded to `AIInteraction` with `latencyMs`, `featureId`, and `source`.
- Prompt runner behavior (`lib/ai/prompt-runner/runner.ts`):
  - `runStructuredJsonPrompt(...)` retries by iterating attempts; a timeout throws `APIConnectionTimeoutError` and will be re-attempted until attempts are exhausted.
  - If the call site caps `timeoutMs` too aggressively, most attempts will fail near the cap.
- Vercel cron:
  - `/api/cron/background-jobs` is scheduled in `vercel.json` (every minute) and currently lacks an advisory lock; overlapping invocations can increase concurrent OpenAI calls.
- Docs drift:
  - `AGENTS.md` says follow-ups run “every 10 minutes”, but `vercel.json` schedules `/api/cron/followups` as `* * * * *` (every minute).

OpenAI SDK verification (Context7: `openai-node` v6):
- Default client timeout is 10 minutes; per-request timeout can be set via RequestOptions (`{ timeout, maxRetries }`).
- Timeouts throw `APIConnectionTimeoutError` and are retried by default unless disabled.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 93 | ✅ Committed | `lib/followup-engine.ts`, follow-up routing/templates | No conflicts — Phase 93 changes are in template/routing; Phase 94b touches only `parseProposedTimesFromMessage` budget. |
| Phase 87 | Complete | `lib/ai-drafts.ts` (availability / draft behavior) | Ensure Step 3 timeout changes don't regress availability refresh logic. |
| Phase 86 | Complete | Cron auth + advisory lock patterns | Reuse the advisory-lock pattern from `app/api/cron/availability/route.ts`. |
| Phase 92 | Complete | UI-only | No coordination needed. |
| Phase 90 | Complete | Analytics/CRM | No coordination needed. |

## Objectives
* [x] Diagnose the current failure modes using `AIInteraction` and Vercel logs (baseline metrics + confirm call sites).
* [x] Remove the “timeout cliff” by increasing and making configurable the timeouts for:
  - Email Draft Verification (Step 3)
  - Signature Context (Drafts)
* [x] Fix `followup.parse_proposed_times` truncation by ensuring the retry path can actually reach higher token budgets.
* [x] Reduce Lead Scoring noise by handling OpenAI 500s via an appropriate retry strategy (without inflating error rows).
* [x] Add advisory locking to `/api/cron/background-jobs` to avoid overlapping cron invocations and bursty concurrency.
* [x] Update docs (`AGENTS.md`, optionally `README.md`) with correct cron schedule + Vercel CLI workflows for logs/envs.

## Constraints
- Never commit secrets/tokens/PII; env changes must be done via Vercel Environment Variables.
- Keep webhook latency bounded: timeout increases must be **proportional** (share of total) and capped.
- Preserve safety behavior:
  - If verifier fails, draft must still be usable and still passes deterministic post-pass enforcement (canonical booking link enforcement, sanitization).
  - If signature context extraction fails, drafting still proceeds without it.
- Avoid widening output budgets without caps; control cost/latency via explicit caps and bounded attempts.
- Cron endpoints must validate `CRON_SECRET` **before** doing work.

## Success Criteria
- In production, `AIInteraction` shows:
  - `draft.verify.email.step3` timeout errors drop sharply (no longer clustered at ~20s).
  - `signature.context` timeout errors drop sharply (no longer clustered at ~4.5s).
  - `followup.parse_proposed_times` no longer emits `hit max_output_tokens` incomplete errors.
  - `lead_scoring.score` 500s are reduced (or retried successfully without repeated error rows).
- `npm run lint` and `npm run build` pass.
- Vercel cron `/api/cron/background-jobs` returns `{ skipped: true, reason: "locked" }` when overlapping, otherwise runs normally.
- `AGENTS.md` cron schedule and Vercel CLI usage are correct and actionable.

## Subphase Index
* a — Baseline Diagnostics (AIInteraction + Vercel logs + code call-site audit)
* b — Core Fixes (timeouts + budgets in AI pipeline code)
* c — Cron Hardening (advisory lock + overlap prevention for background jobs)
* d — Vercel + Docs Updates (env vars, AGENTS.md, optional README env table)
* e — Verification + Rollout (lint/build, deploy, monitor, rollback plan)

## Repo Reality Check (RED TEAM)

### Verified Touch Points

| Plan Reference | Actual Location | Verified |
|----------------|-----------------|----------|
| Step 3 verifier timeout: `Math.min(20_000, ...)` | `lib/ai-drafts.ts:2381` | ✓ |
| Signature context timeout: `Math.min(4500, ...)` | `lib/ai-drafts.ts:1498` | ✓ |
| `parseProposedTimesFromMessage` | `lib/followup-engine.ts:2317` | ✓ |
| Budget: `{min:256, max:800, retryMax:1400}` | `lib/followup-engine.ts:2401-2408` | ✓ |
| `scoreLeadFromConversation` | `lib/lead-scoring.ts:158` | ✓ |
| `maxRetries: 0` (disables SDK retries) | `lib/lead-scoring.ts:247` | ✓ |
| Background-jobs cron (no advisory lock) | `app/api/cron/background-jobs/route.ts` | ✓ |
| `OPENAI_DRAFT_TIMEOUT_MS` env var | `lib/ai-drafts.ts:1406` | ✓ |
| `OPENAI_PROMPT_MAX_ATTEMPTS` env var | `lib/ai/prompt-runner/runner.ts:20` | ✓ |

### Advisory Lock Keys (Collision Prevention)

Existing keys in use:
- `availability`: `BigInt("61061061061")`
- `calendar-health`: `BigInt("62062062062")`

**Phase 94c must use:** `BigInt("63063063063")` for background-jobs lock.

### Docs Mismatch (To Fix in 94d)

- `AGENTS.md` says follow-ups run "every 10 minutes"
- `vercel.json` actual: `"/api/cron/followups": "* * * * *"` (every minute)

### Env Var Clarification

Draft generation uses both:
- `OPENAI_DRAFT_TIMEOUT_MS` (default 120s) — general draft generation (e.g., UI actions, background jobs).
- `OPENAI_DRAFT_WEBHOOK_TIMEOUT_MS` (default 30s) — tighter budgets in webhook contexts (e.g., inbound post-process pipeline).
Docs should reflect both and their defaults.

## Phase Summary

### Status
**Code complete** — all subphases (a–e) implemented. Production deployment + metrics verification pending.

### What Shipped
1. **Configurable timeout slices** (`lib/ai-drafts.ts`):
   - Step 3 email verifier: `OPENAI_EMAIL_VERIFIER_TIMEOUT_*` (cap 45s, min 8s, share 0.35)
   - Signature context: `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_*` (cap 10s, min 3s, share 0.2)
   - Slices clamp to overall draft timeout, preventing deterministic timeouts under load

2. **Raised signature context default** (`lib/email-signature-context.ts`):
   - Default timeout 10s (was 4.5s) when callers omit explicit timeout

3. **Fixed proposed-times truncation** (`lib/followup-engine.ts`):
   - `reasoningEffort: "minimal"`, `maxAttempts: 4`
   - Budget: `{min: 512, max: 1200, retryMax: 2400}` (was `{256, 800, 1400}`)

4. **Lead scoring SDK retries** (`lib/lead-scoring.ts`):
   - `OPENAI_LEAD_SCORING_MAX_RETRIES` env var (default 2)
   - Handles transient 5xx errors without inflating `AIInteraction` error rows

5. **Cron advisory lock** (`app/api/cron/background-jobs/route.ts`):
   - `LOCK_KEY = BigInt("63063063063")`
   - Overlapping invocations return `{ skipped: true, reason: "locked" }`

6. **Documentation updates**:
   - `AGENTS.md`: Corrected cron schedule (every minute), added Vercel CLI debugging section
   - `README.md`: Documented new timeout env vars

### Key Files
- `lib/ai-drafts.ts` — Timeout slice computation + usage
- `lib/email-signature-context.ts` — Default timeout fallback
- `lib/followup-engine.ts` — Budget/attempts for proposed-times parser
- `lib/lead-scoring.ts` — SDK retry strategy
- `app/api/cron/background-jobs/route.ts` — Advisory lock
- `AGENTS.md`, `README.md` — Documentation

### Verification
- `npm run lint`: ✅ Pass (22 warnings, 0 errors)
- `npm run build`: ✅ Pass
- No Prisma schema changes

### Follow-ups
1. Deploy to production
2. Set Vercel env vars (documented in 94d/Output)
3. Monitor `AIInteraction` for 24h to verify timeout/truncation error reduction

### Review
See `docs/planning/phase-94/review.md` for detailed evidence mapping.
