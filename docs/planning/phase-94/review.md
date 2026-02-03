# Phase 94 Review — AI Timeout + Token Budget Mitigations

**Review Date:** 2026-02-02
**Reviewer:** Claude (phase-review skill)

## Summary

Phase 94 successfully implemented timeout/budget mitigations for the AI pipeline and added cron hardening. All code changes match the plan, quality gates pass, and documentation is updated.

## Quality Gates

| Gate | Result |
|------|--------|
| `npm run lint` | ✅ Pass (22 warnings, 0 errors — all pre-existing) |
| `npm run build` | ✅ Pass (production build succeeded) |
| Prisma schema | N/A (no schema changes in Phase 94) |

## Evidence: Files Changed

```
 M AGENTS.md                               # 94d: Cron schedule + Vercel CLI docs
 M README.md                               # 94d: New timeout env vars documented
 M app/api/cron/background-jobs/route.ts   # 94c: Advisory lock added
 M lib/ai-drafts.ts                        # 94b: Configurable timeout slices
 M lib/email-signature-context.ts          # 94b: Default timeout raised
 M lib/followup-engine.ts                  # 94b: Budget + maxAttempts increased
 M lib/lead-scoring.ts                     # 94b: SDK request retries enabled
?? docs/planning/phase-94/                 # Phase planning docs
```

## Success Criteria Mapping

### 1. AIInteraction timeout errors drop (Step 3 verifier, signature context)
**Status:** ✅ Code complete (requires production deployment + monitoring to verify metrics)

**Evidence:**
- `lib/ai-drafts.ts:122-147` — New `computeTimeoutSliceMs()` helper with clamps
- `lib/ai-drafts.ts:1457-1475` — Signature context uses `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_*` (10s/3s/0.2)
- `lib/ai-drafts.ts:1467-1475` — Step 3 verifier uses `OPENAI_EMAIL_VERIFIER_TIMEOUT_*` (45s/8s/0.35)
- `lib/email-signature-context.ts:283-287` — Default timeout raised to 10s

### 2. followup.parse_proposed_times truncation fixed
**Status:** ✅ Met

**Evidence:**
- `lib/followup-engine.ts:2383-2384` — `reasoningEffort: "minimal"`, `maxAttempts: 4`
- `lib/followup-engine.ts:2403-2410` — Budget increased: `{min: 512, max: 1200, retryMax: 2400}`

### 3. Lead Scoring 500s reduced via SDK retries
**Status:** ✅ Met

**Evidence:**
- `lib/lead-scoring.ts:227-233` — `OPENAI_LEAD_SCORING_MAX_RETRIES` env var (default 2)
- `lib/lead-scoring.ts:256` — `maxRetries: requestMaxRetries` passed to prompt runner

### 4. npm run lint and npm run build pass
**Status:** ✅ Met

**Evidence:**
- Lint: 0 errors, 22 warnings (pre-existing)
- Build: Production build succeeded

### 5. Advisory lock prevents overlapping cron runs
**Status:** ✅ Met

**Evidence:**
- `app/api/cron/background-jobs/route.ts:23` — `LOCK_KEY = BigInt("63063063063")`
- `app/api/cron/background-jobs/route.ts:25-31` — `tryAcquireLock()` / `releaseLock()` functions
- `app/api/cron/background-jobs/route.ts:40-47` — Returns `{ skipped: true, reason: "locked" }` when already running
- `app/api/cron/background-jobs/route.ts:66-67` — Lock released in `finally` block

### 6. AGENTS.md cron schedule and Vercel CLI usage correct
**Status:** ✅ Met

**Evidence:**
- `AGENTS.md:136-137` — Correctly states both followups and background-jobs run every minute
- `AGENTS.md:73-88` — New "Vercel CLI Debugging" section with practical commands

## Implementation Correctness Verification

### 94a: Baseline Diagnostics
- **Planned:** Create `docs/planning/phase-94/baseline.md` with AIInteraction metrics
- **Actual:** ✅ `baseline.md` exists with error clusters and code locations

### 94b: Core Fixes
| Planned Change | Actual Implementation | Verified |
|----------------|----------------------|----------|
| Step 3 verifier timeout configurable (45s/8s/0.35) | `lib/ai-drafts.ts:1467-1475` | ✓ |
| Signature context timeout configurable (10s/3s/0.2) | `lib/ai-drafts.ts:1457-1465` | ✓ |
| `email-signature-context.ts` default raised to 10s | `lib/email-signature-context.ts:285` | ✓ |
| `parseProposedTimesFromMessage` budget `{512, 1200, 2400}` | `lib/followup-engine.ts:2403-2410` | ✓ |
| `reasoningEffort: "minimal"`, `maxAttempts: 4` | `lib/followup-engine.ts:2384-2385` | ✓ |
| Lead scoring SDK retries via `OPENAI_LEAD_SCORING_MAX_RETRIES` | `lib/lead-scoring.ts:227-256` | ✓ |

### 94c: Cron Hardening
| Planned Change | Actual Implementation | Verified |
|----------------|----------------------|----------|
| Advisory lock with `BigInt("63063063063")` | `route.ts:23` | ✓ |
| Lock acquired after auth, before work | `route.ts:36-47` | ✓ |
| Lock released in `finally` | `route.ts:66-67` | ✓ |
| Returns `{ skipped: true, reason: "locked" }` | `route.ts:42-47` | ✓ |

### 94d: Docs Updates
| Planned Change | Actual Implementation | Verified |
|----------------|----------------------|----------|
| AGENTS.md cron schedule corrected (every minute) | `AGENTS.md:136-137` | ✓ |
| Vercel CLI debugging section added | `AGENTS.md:73-88` | ✓ |
| README.md env vars documented | `README.md:275-281` | ✓ |

### 94e: Verification
- **Local lint/build:** ✅ Pass
- **Production deploy + monitoring:** Pending

## Multi-Agent Coordination

- **Phase 93 overlap:** `lib/followup-engine.ts` was modified by both phases. Phase 93 was committed before Phase 94 execution, so no merge conflicts occurred. Phase 94 only touched `parseProposedTimesFromMessage` (budget/attempts), while Phase 93 touched template routing — changes are orthogonal.
- **Build verification:** Ran against combined state of all uncommitted changes. Build passes.

## Follow-ups

1. **Deploy to production** and monitor `AIInteraction` for:
   - `draft.verify.email.step3` timeout errors (should drop from ~20s cluster)
   - `signature.context` timeout errors (should drop from ~4.5s cluster)
   - `followup.parse_proposed_times` truncation errors (should be eliminated)
   - `lead_scoring.score` 500s (should show fewer failures with SDK retries)

2. **Set Vercel env vars** (documented in 94d Output):
   - `OPENAI_EMAIL_VERIFIER_TIMEOUT_MS_CAP=45000`
   - `OPENAI_EMAIL_VERIFIER_TIMEOUT_MS_MIN=8000`
   - `OPENAI_EMAIL_VERIFIER_TIMEOUT_SHARE=0.35`
   - `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_MS_CAP=10000`
   - `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_MS_MIN=3000`
   - `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_SHARE=0.2`
   - `OPENAI_LEAD_SCORING_MAX_RETRIES=2`

## Conclusion

Phase 94 is **code-complete** and ready for production deployment. All success criteria that can be verified locally are met. Production metrics verification requires deployment and a monitoring window (24h recommended).
