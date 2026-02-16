# Phase 151 — Prod DB Alignment for Tim Reliability (LinkedIn Profile/Company Split + SMS AI Phone Normalizer)

## Purpose
Restore deterministic LinkedIn + SMS execution for Tim Blais by fixing LinkedIn URL source/precedence (profile vs company) and making SMS sendability resilient via AI-only phone normalization plus auditable skip/advance behavior.

## Context
Tim Blais reports "LinkedIn not running" and "SMS isn't running either". The underlying failure mode is data correctness + precedence, not the channel integrations themselves:
- LinkedIn profile URLs (`/in/...`) and company URLs (`/company/...`) are being conflated, and permissive custom-field selection can pick the wrong value (or miss the profile even when present).
- Production DB is currently missing the `Lead.linkedinCompanyUrl` column, so profile/company split behavior cannot safely ship until a migration lands.
- Tim has a large proportion of leads with missing phones, and a non-trivial number of leads with company URLs incorrectly stored in `Lead.linkedinUrl`.

Key production facts (via Supabase MCP, 2026-02-13):
- Tim workspace `clientId=779e97c3-e7bd-4c1a-9c46-fe54310ae71f` exists and has `emailBisonWorkspaceId=42`, `ghlLocationId=LzhHJDGBhIyHwHRLyJtZ`, `unipileAccountId` configured.
- Tim leads: `192` rows have `Lead.linkedinUrl` containing `/company/…`; only `45` contain `/in/…`.
- Global leads: ~`1.28M` total; `2510` rows have `/company/…` stored in `Lead.linkedinUrl`.
- Tim phone coverage: ~`477` leads have a phone; ~`11.6k` do not.

Locked decisions from the user for this phase:
- Migrate prod DB first (add `linkedinCompanyUrl` + SMS audit fields), then deploy.
- If `linkedinUrl` is a company URL and we later see a valid profile URL, replace `linkedinUrl` with the profile and store the company in `linkedinCompanyUrl`.
- LinkedIn follow-up steps with company-only URLs must skip-and-advance (no stalling); auto-trigger Clay enrichment for LinkedIn.
- SMS phone normalization is AI-only, runs before every SMS send (manual + automation), model `gpt-5-nano`, 2 retries, and is called every time.
- If no phone exists for automation, skip-and-advance immediately (no enrichment attempt).
- If AI phone normalization fails, do not auto-trigger phone enrichment; mark as blocked with audit.
- Persist SMS failure audit on the Lead; attempt count represents consecutive blocked sends since last success.
- SMS UI banner triggers on any SMS send-blocker and remains visible until the next successful SMS send.
- Tim is the canary; after 24 hours of canary, run global backfill; keep backfill backup for 7 days.
- No feature flag; default-on after validation.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 150 | Tracked | Same domain (Tim reliability, LinkedIn/SMS) | Phase 151 supersedes Phase 150 with verified prod DB constraints and locked decisions; implement from 151. |
| Phase 149 | Tracked | `components/dashboard/action-station.tsx` / dashboard client surfaces | SMS banner work must preserve Phase 149 render-loop protections; merge by symbol and avoid effect feedback loops. |
| Phase 140 | Active (uncommitted) | `lib/ai-drafts.ts`, `lib/ai/prompt-registry.ts` | Phase 151 adds a new SMS phone-normalization prompt; coordinate prompt-registry edits carefully to avoid Step 3 pricing regressions. |
| Phase 146 | Active (uncommitted) | `lib/ai-replay/*` | Phase 151 must run replay gates but should not mutate replay/judge behavior. |

## Objectives
* [x] Land prod DB migration(s) for `linkedinCompanyUrl` and Lead-level SMS send-block audit fields.
* [x] Fix LinkedIn extraction precedence across EmailBison + GHL so profile URLs are always selected when present, while company URLs are preserved.
* [x] Backfill existing company URLs out of `Lead.linkedinUrl` (Tim first, then global) with a rollback-safe backup table.
* [x] Implement AI-only SMS phone normalization before every send and wire audit + UI banner behavior.
* [ ] Validate with tests + NTTAN gates and execute Tim canary + global rollout.

## 2026-02-16 Execution Updates
- `npm run lint` passed (pre-existing warnings only, no blocking errors).
- `npm run build` passed (pre-existing non-blocking warnings only).
- `npm test` passed (`tests 387`, `suites 77`, `pass 387`, `fail 0`).
- `npm run test:ai-drafts` passed (`tests 68`, `suites 3`, `pass 68`, `fail 0`).
- `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --dry-run --limit 20` passed (`evaluated=0`, `failed=0`).
- `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --limit 20 --concurrency 3` passed (`evaluated=16`, `passed=14`, `failedJudge=2`, `failed=0`).
- Global Tim-canary rollout + 24-hour observation still pending in 151e.

## Constraints
- Do not commit secrets, tokens, or personal data.
- Migration first: do not deploy code paths that write/read new columns before prod has them.
- `Lead.linkedinUrl` is profile-only (`/in/...`) after backfill and ongoing ingestion.
- `Lead.linkedinCompanyUrl` is company-only (`/company/...`) after backfill and ongoing ingestion.
- Follow-up automation must not stall on unrecoverable prerequisites (company-only LinkedIn; missing phone; AI phone normalization failure).
- SMS AI normalization uses `gpt-5-nano` with 2 retries, invoked on every SMS send attempt.
- No automatic phone enrichment on AI normalization failure.

## Success Criteria
- Prod DB contains `Lead.linkedinCompanyUrl` and the new Lead-level SMS audit fields (and Prisma schema matches).
- Tim canary:
  - No leads remain with `/company/…` in `Lead.linkedinUrl` after Tim backfill.
  - LinkedIn follow-up steps never stall solely due to company URLs; they skip-and-advance with an audit trail.
  - Manual LinkedIn sends fail fast with clear error when no `/in/…` URL exists.
  - SMS sends either succeed (after AI normalization) or fail with audit + banner; automation steps skip-and-advance on permanent blocks.
- Global:
  - `SELECT count(*) FROM "Lead" WHERE "linkedinUrl" ILIKE '%/company/%'` returns `0` after global backfill.
- Required validation gates run and pass (NTTAN):
  - `npm run lint`
  - `npm run build`
  - `npm test`
  - `npm run test:ai-drafts`
  - `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --dry-run --limit 20`
  - `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --limit 20 --concurrency 3`

## Subphase Index
* a — Prod DB Migration + Compatibility Preflight
* b — LinkedIn Extraction Precedence Hardening (EmailBison + GHL) + Repair Semantics
* c — Tim Canary Backfill + Global Backfill (Rollback-Safe) + LinkedIn Runtime Verification
* d — SMS AI Phone Normalization + Lead Audit Fields + SMS Banner UI
* e — Validation (NTTAN) + Canary Checklist + Rollout/Monitoring Runbook
