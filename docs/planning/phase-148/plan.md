# Phase 148 — LinkedIn URL Semantics (Profile vs Company) + Global Backfill

## Purpose
Eliminate "LinkedIn not running" and follow-up starvation caused by storing LinkedIn company URLs in `Lead.linkedinUrl`, by enforcing profile-only semantics, capturing company URLs separately, and backfilling existing data across all clients.

## Context
Production data includes leads with `Lead.linkedinUrl = https://linkedin.com/company/...` (example: Tim Blais workspace) while outbound LinkedIn sending (Unipile) and follow-up eligibility assume a person profile (`/in/...`). This mismatch can cause:
- LinkedIn follow-up steps to remain due/retry forever or silently never execute.
- Send attempts to hit Unipile with an invalid target (company slug treated as a member identifier).
- Ingestion paths to "prefer" the first seen LinkedIn value (often company) even when a profile URL exists in another custom field.

Recent diagnostic patches also broadened LinkedIn extraction to accept company URLs in email/SMS/signature paths. Without a field split, those changes can increase the rate of storing company URLs into `Lead.linkedinUrl`.

### Starting State
The working tree has ~250 lines of uncommitted LinkedIn utility and webhook changes (from prior diagnostic work). These are absorbed into Phase 148a as the starting baseline and corrected in-place. Key files with uncommitted changes:
- `lib/linkedin-utils.ts` — `normalizeLinkedInUrlAny`, `mergeLinkedInUrl`, `normalizeLinkedInUrlWithKind` already added
- `lib/lead-matching.ts` — switched to `normalizeLinkedInUrlAny` + `mergeLinkedInUrl` (needs correction to profile-only matching)
- `app/api/webhooks/{email,ghl/sms,linkedin,clay}/route.ts` — merge semantics added but no `linkedinCompanyUrl` routing
- `lib/background-jobs/email-inbound-post-process.ts` — same merge semantics, no split routing
- `lib/__tests__/{linkedin-utils,lead-matching,signature-extractor}.test.ts` — new but thin test files

## Resolved Decisions (User, 2026-02-12)

1. **Phase 147 coordination:** Phase 148c **supersedes** Phase 147's LinkedIn work entirely. Phase 147 only ships SMS fixes (`invalid_country_code` handling). Phase 148c owns ALL LinkedIn skip/advance logic in `followup-engine.ts`.
2. **Uncommitted code disposition:** Phase 148a **absorbs** the ~250 lines of uncommitted LinkedIn utility and webhook changes. Fix misalignments (profile-only matching, `linkedinCompanyUrl` routing) in-place rather than committing or reverting.
3. **Company URL CRM display:** **No UI change needed.** Company URLs are not actionable for outbound — losing the LinkedIn badge is correct behavior.

## Concurrent Phases
| Phase | Status | Overlap | Coordination |
|------:|--------|---------|--------------|
| Phase 147 | Active (untracked in git) | Domain overlap: LinkedIn + SMS follow-up reliability | **RESOLVED:** Phase 147 ships SMS-only fixes. Phase 148c supersedes all Phase 147 LinkedIn work. Update Phase 147 plan to mark 147b as superseded. |
| Phase 146 | Active | Tooling overlap in replay validation (`lib/ai-replay/*`, `scripts/live-ai-replay.ts`) | Do not modify replay tooling in this phase. Commit Phase 146 changes before running Phase 148e NTTAN gates to avoid baseline variance. |
| Phase 143 | Recent | Message handling / booking routing context | Ensure changes do not regress message ingestion contracts used by action-signal detection / booking routing. |

## Objectives
* [x] Enforce `Lead.linkedinUrl` as **profile-only** (`/in/...`) across matching, ingestion, and runtime send paths.
* [x] Add `Lead.linkedinCompanyUrl` to preserve `/company/...` without breaking outbound logic.
* [x] Make LinkedIn extraction deterministic (prefer profile when both exist).
* [ ] Backfill existing leads globally to move company URLs out of `linkedinUrl`.
* [ ] Validate with unit tests + NTTAN gates and verify Tim Blais workspace behavior.

## Constraints
- Do not commit secrets, tokens, or personal data.
- Prisma schema changes require `npm run db:push` against the correct DB before considering the phase done.
- Matching must not use company URLs (company pages are not person identifiers).
- Follow-up engine must not starve on unrecoverable LinkedIn prerequisites; it should skip-and-advance with an audit trail.

## Success Criteria
- `Lead.linkedinUrl` is either `NULL` or a normalized profile URL (`https://linkedin.com/in/<slug>`).
- `Lead.linkedinCompanyUrl` is either `NULL` or a normalized company URL (`https://linkedin.com/company/<slug>`).
- Ingestion paths (EmailBison, Inboxxia email webhook, GHL SMS webhook, Unipile LinkedIn webhook, Clay webhook) never write company URLs into `Lead.linkedinUrl`.
- Follow-up instances no longer remain perpetually due because a company URL exists; unrecoverable LinkedIn steps are skipped-and-advanced with a recorded reason.
- Backfill completes safely across all clients without overwriting existing profile URLs.
- Required validation gates run and pass (NTTAN):
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-148/replay-case-manifest.json --dry-run`
  - `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-148/replay-case-manifest.json --concurrency 3`
  - Fallback (if no manifest): `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --limit 20 --concurrency 3`

## Subphase Index
* a — Schema + Utilities + Contracts (split fields, normalize, merge semantics)
* b — Ingestion Hardening (EmailBison/Inboxxia/GHL/Unipile/Clay write-paths)
* c — Runtime Reliability (follow-up skip/advance + sender validation)
* d — Global Backfill (SQL + batched normalization script)
* e — Validation + Rollout (tests, NTTAN gates, Tim verification checklist)

---

## RED TEAM — Repo Reality Check (2026-02-12)

### Verified Touch Points

| Plan Claim | Verified? | Actual Location / Finding |
|---|---|---|
| `Lead.linkedinUrl` exists on Lead model | **Yes** | `prisma/schema.prisma` — `String?`, indexed |
| `Lead.linkedinCompanyUrl` does not exist yet | **Yes** | Not in schema; only referenced in plan docs |
| `normalizeLinkedInUrl` is profile-only | **Yes (uncommitted)** | `lib/linkedin-utils.ts` — company fallback stripped |
| `normalizeLinkedInUrlAny` exists | **Yes (uncommitted)** | `lib/linkedin-utils.ts:56–167` |
| `mergeLinkedInUrl` exists with precedence rules | **Yes (uncommitted)** | `lib/linkedin-utils.ts:89–113` — profile > company |
| `normalizeLinkedInUrlWithKind` classifier | **Yes (uncommitted, private)** | `lib/linkedin-utils.ts:65–80` — not exported |
| `lead-matching.ts` uses profile-only for matching | **NO — CONTRADICTS PLAN** | `lib/lead-matching.ts:87` uses `normalizeLinkedInUrlAny` (accepts company URLs). **Must fix in 148a.** |
| Follow-up engine in `lib/followup-engine.ts` | **Yes** | Lines 1161–1555 (LinkedIn), skip/advance at 1235–1240 |
| `extractLinkedInPublicIdentifier` fallback bug | **Yes** | `lib/unipile-api.ts:175-179` — company slug returned as person ID |
| `system-sender.ts` has no URL-type validation | **Yes** | Lines 294–308 — checks existence, not kind |
| Batch backstop filter at followup-engine ~2741 | **Yes** | Only checks `!linkedinUrl`, not company URLs |
| All 5 ingestion webhooks already modified (uncommitted) | **Yes** | Using `normalizeLinkedInUrlAny` + `mergeLinkedInUrl`, but no `linkedinCompanyUrl` routing |
| New test files exist (uncommitted) | **Yes** | `linkedin-utils.test.ts` (25L), `lead-matching.test.ts` (101L), `signature-extractor.test.ts` (13L) |

### RED TEAM Findings (Integrated into Subphase Plans)

| ID | Severity | Finding | Subphase |
|---|---|---|---|
| **F1** | **CRITICAL** | `lead-matching.ts` matching uses `normalizeLinkedInUrlAny` — allows company URL false positives | 148a |
| **F2** | **CRITICAL** | Uncommitted webhook work stores company URLs in `linkedinUrl` (no `linkedinCompanyUrl` routing) | 148a, 148b |
| **F3** | **HIGH** | LinkedIn webhook creates new leads with `linkedinUrl = companyUrl` | 148b |
| **F4** | **HIGH** | Phase 147/148 `followup-engine.ts` collision — **RESOLVED: 148c supersedes** | 148c |
| **F5** | **HIGH** | `system-sender.ts` has zero URL-type validation before Unipile calls | 148c |
| **F6** | **MEDIUM** | Missing `@@index([linkedinCompanyUrl])` | 148a |
| **F7** | **MEDIUM** | No backfill rollback plan | 148d |
| **F8** | **MEDIUM** | No replay case manifest for NTTAN | 148e |
| **F9** | **MEDIUM** | Existing `lead-matching.test.ts` validates the bug (company URL matching), not the fix | 148a |
| **F10** | **LOW** | `normalizeLinkedInUrlWithKind` is private — needs export for ingestion routing | 148a |
| **F11** | **LOW** | `getAvailableChannels()` will correctly hide LinkedIn for company-only leads (no UI change needed per decision) | 148e |
| **F12** | **INFO** | Phase 146 uncommitted changes affect replay baselines — commit first or document variance | 148e |

### Assumptions (Agent, >= 90% Confidence)

1. Uncommitted utility/webhook changes should be absorbed into Phase 148a/b, not reverted (95%). **CONFIRMED by user.**
2. Phase 147's `followup-engine.ts` changes have not been written yet — working tree shows no modifications (98%).
3. Tim Blais clientId `779e97c3-e7bd-4c1a-9c46-fe54310ae71f` is correct and workspace has leads with company URLs (99%).
4. `linkedinCompanyUrl` is safe to add as nullable with no default — existing queries won't break (99%).
5. `normalizeLinkedInUrl` (profile-only) is the correct function for matching (95%).

## RED TEAM — Turn Delta (2026-02-13)

- New finding (MEDIUM): `db:push` + DB-backed tests/replay are blocked by environment DB connectivity (`P1001`), so backfill and production verification remain open.
- New finding (LOW): `docs/planning/phase-148/replay-case-manifest.json` is still missing; fallback replay path is in use.
- Coordination check: latest 10 phases scanned (`148, 147, 146, 145, 143, 144, 141, 140, 142, 139`). No direct file-level conflict detected with this turn’s edits beyond previously-documented Phase 147 LinkedIn supersession.

## Phase Summary (running)

- 2026-02-13 08:21 UTC — Implemented Phase 148a/148b/148c code changes for split LinkedIn profile/company semantics and runtime guards; ran lint/build/ai-drafts and fallback replay commands (files: `prisma/schema.prisma`, `lib/linkedin-utils.ts`, `lib/lead-matching.ts`, `app/api/webhooks/ghl/sms/route.ts`, `app/api/webhooks/linkedin/route.ts`, `app/api/webhooks/clay/route.ts`, `lib/background-jobs/email-inbound-post-process.ts`, `lib/system-sender.ts`, `lib/unipile-api.ts`, `lib/followup-engine.ts`, `actions/message-actions.ts`, `actions/enrichment-actions.ts`, `lib/booking-progress.ts`, `lib/reactivation-sequence-prereqs.ts`, `lib/__tests__/linkedin-utils.test.ts`, `lib/__tests__/lead-matching.test.ts`, `lib/__tests__/signature-extractor.test.ts`).
- 2026-02-13 08:21 UTC — Validation blockers recorded: DB connectivity blocked `db:push`, DB-backed tests, and ai-replay preflight.
- 2026-02-13 08:22 UTC — Added SMS `invalid_country_code` skip-and-advance handling in follow-up runtime (`lib/system-sender.ts`, `lib/followup-engine.ts`) and aligned `actions/message-actions.ts` result typing; build re-verified.
