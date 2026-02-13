# Phase 147 - Follow-Up Channel Reliability (LinkedIn + SMS)

## Purpose
Restore deterministic LinkedIn and SMS follow-up execution for Tim Blais and apply the same reliability behavior for all clients without introducing new guardrail systems.

## Context
On February 12, 2026 incident review for `Tim Blais - Gateway` (`clientId: 779e97c3-e7bd-4c1a-9c46-fe54310ae71f`) showed:
- SMS is not globally down (recent outbound sends exist), but many SMS follow-up tasks are left pending due to missing/invalid phone conditions.
- LinkedIn is not globally down (recent LinkedIn sends exist), but currently due active instances are stuck on LinkedIn steps.
- The stuck LinkedIn leads use `linkedin.com/company/...` URLs with no `linkedinId`. These cannot resolve a person/member target and repeatedly fail without advancing step state.
- User decisions for this phase:
- Apply reliability behavior to all clients, not only Tim Blais.
- Do not add new alerting/guardrail framework in this phase.
- LinkedIn company/invalid URLs should skip and advance.
- SMS missing/invalid phone should skip and advance.
- If phone is added later, continue on the next eligible SMS step (do not replay old skipped SMS steps).
- Runtime fix only in this phase (no one-time backfill script).

Current repo state also has uncommitted work in AI draft/replay files from other agents, so this phase must avoid mutating those in-flight files unless explicitly required.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 146 | Active | Domain overlap in replay validation tooling (`lib/ai-replay/*`, `scripts/live-ai-replay.ts`) | Do not modify replay/judge files in this phase; consume current behavior for validation only. |
| Phase 145 | Recent/Active artifacts | Shared AI replay methodology and artifacts | Reuse existing replay invocation pattern; avoid changing phase-145-owned contracts. |
| Uncommitted concurrent work (git status) | Active | `lib/ai-drafts.ts`, `lib/meeting-overseer.ts`, `lib/ai/prompt-registry.ts`, `scripts/live-ai-replay.ts` | Keep this phase scoped to follow-up runtime and related tests; no edits to these files unless blocked and explicitly coordinated. |

## Objectives
* [ ] Identify and remove deterministic causes of follow-up step starvation for LinkedIn/SMS.
* [ ] Preserve existing successful send paths while changing only unrecoverable-block paths to skip-and-advance.
* [ ] Add regression coverage and execute required validation gates.

## Constraints
- Scope applies to all clients.
- No schema migration and no data backfill in this phase.
- No new alerting/guardrail subsystem in this phase.
- LinkedIn company or non-person profile URLs must not block sequence progression.
- SMS steps with missing/invalid phone data must not block sequence progression.
- Missed SMS steps are not replayed later; sequence resumes on next eligible SMS step.
- Preserve current cron endpoint shape and follow-up scheduling model.

## Success Criteria
- Active instances on LinkedIn steps with company/non-person URLs no longer remain perpetually due.
- SMS steps blocked by missing/invalid phone or invalid country code resolve as skip-and-advance, not infinite retries.
- Existing valid LinkedIn person-profile sends and valid SMS sends remain functional.
- Skip reasons are recorded in `FollowUpTask.suggestedMessage` using the existing plain-text convention (e.g., `"LinkedIn skipped — ..."`, `"SMS skipped — ..."`).
- Required validation gates run and pass:
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20` (incident run uses `<clientId>=779e97c3-e7bd-4c1a-9c46-fe54310ae71f`)
  - `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3` (incident run uses `<clientId>=779e97c3-e7bd-4c1a-9c46-fe54310ae71f`)

---

## RED TEAM — Repo Reality Check (Phase 147 RED TEAM, 2026-02-12)

### Verified Touch Points

| Plan Claim | Verified? | Actual Location |
|---|---|---|
| LinkedIn execution in followup-engine.ts | Yes | `lib/followup-engine.ts:1161–1555` |
| SMS execution in followup-engine.ts | Yes | `lib/followup-engine.ts:1878–2068` |
| `advance: true` skip pattern established | Yes | 11+ existing sites use this pattern |
| `FollowUpTask` model for audit trail | Yes | `prisma/schema.prisma:1195–1218` |
| `ensureFollowUpTaskRecorded` utility | Yes | `lib/followup-engine.ts:858–877` |
| `extractLinkedInPublicIdentifier` | Yes | `lib/unipile-api.ts:153–189` |
| No schema changes needed | Yes | All fields exist |

### Critical Discoveries

1. **`extractLinkedInPublicIdentifier` fallback bug** (`lib/unipile-api.ts:175-179`): For non-`/in/` URLs, returns the LAST path segment. Company URL `linkedin.com/company/acme-corp` returns `"acme-corp"` as a person identifier — causes incorrect API calls, not just a failure.
2. **`invalid_country_code` is a distinct GHL error** (`lib/ghl-api.ts:98-99`): Detected at API layer but NOT handled in follow-up engine error dispatch (lines 1954-2012). Falls through to permanent `blocked_sms_error` pause.
3. **SMS skip-and-advance for missing phone already exists** (`lib/followup-engine.ts:1954-1977`): Lines 1954-1977 already skip+advance on "missing phone" errors.
4. **Backstop filter at line 2741** only filters `!linkedinUrl` (missing URLs), not company URLs.

### RED TEAM Findings Summary

- **F1 CRITICAL**: Company URLs cause incorrect Unipile API calls via fallback extraction — pre-check must go in `followup-engine.ts:~1241` before any API delegation.
- **F2 HIGH**: `invalid_country_code` GHL error causes permanent SMS starvation — must be added to error dispatch.
- **F3 MEDIUM**: Phase 147c must extend existing SMS skip logic (lines 1954-1977), not reimplement it.
- **F4 MEDIUM**: `[LINKEDIN Disabled]` bracket-prefix convention doesn't match existing codebase plain-text convention — adopt existing convention.
- **F5 MEDIUM**: Backstop filter at line 2741 must also detect company URLs.
- **F6 LOW**: FollowUpTask `status` for skips uses `"pending"` by convention — match it.
- **F7 INFO**: AI replay tests draft generation, not follow-up execution — regression guard only.
- **F8 INFO**: Uncommitted phase 146 changes affect test baselines.

### Assumptions (Agent, >=90% Confidence)

1. LinkedIn pre-check belongs in `followup-engine.ts` (not `unipile-api.ts`) — avoids unnecessary API calls (95%).
2. No schema migration needed — all fields exist (99%).
3. Existing SMS skip logic at lines 1954-1977 works correctly — extend for `invalid_country_code` (95%).
4. Phase 146 uncommitted changes don't conflict with phase 147 (98%).

---

## Subphase Index
* a - Incident Baseline and Deterministic Runtime Contract
* b - LinkedIn Unstick Fix (Company URL and Unresolvable Member Handling)
* c - SMS Unstick Fix (Missing/Invalid Phone Skip-and-Advance)
* d - Regression Tests and Mandatory Validation Gates (NTTAN)
* e - Rollout Verification for Tim Blais and Global Behavior Confirmation
