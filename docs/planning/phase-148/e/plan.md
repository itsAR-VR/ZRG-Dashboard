# Phase 148e — Validation + Rollout (NTTAN + Tim Verification)

## Focus
Prove the fix is correct and durable through unit tests, AI/message validation gates, and production verification focused on Tim Blais plus a global sanity sweep.

## Inputs
- Implemented changes from Phases 148a–148d
- Tim Blais workspace identifiers:
  - `clientId = 779e97c3-e7bd-4c1a-9c46-fe54310ae71f`
  - `emailBisonWorkspaceId = 42`
  - `ghlLocationId = LzhHJDGBhIyHwHRLyJtZ`

## Prerequisites
- **Commit Phase 146 changes before running NTTAN gates (F12).** Phase 146 has uncommitted changes to AI replay tooling. Running replay with uncommitted baselines may produce non-deterministic results. Either: commit Phase 146 first, or document expected baseline variance in replay artifacts.

## Work

### 1. Replay Case Manifest (F8)
Create `docs/planning/phase-148/replay-case-manifest.json` with at least 5 Tim Blais workspace thread IDs:
- 1–2 leads that HAD company URLs in `linkedinUrl` (pre-backfill — now migrated to `linkedinCompanyUrl`)
- 1–2 leads with valid profile URLs (should be unaffected)
- 1 lead with both profile and company associations
- Selection should cover email and SMS channels to ensure LinkedIn URL changes don't regress AI drafting.

### 2. Local Validation
```bash
npm run lint
npm run build
```
Unit tests covering:
- `classifyLinkedInUrl` split for profile, company, invalid, mixed inputs
- `mergeLinkedInUrl` profile-beats-company precedence
- `findOrCreateLead` does not match by company URL; stores company in `linkedinCompanyUrl`
- Follow-up engine skip-and-advance for company-only LinkedIn leads
- Sender validation rejects non-profile URLs with typed error

### 3. Mandatory AI/Message Validation (NTTAN)
```bash
npm run test:ai-drafts
npm run test:ai-replay -- --thread-ids-file docs/planning/phase-148/replay-case-manifest.json --dry-run
npm run test:ai-replay -- --thread-ids-file docs/planning/phase-148/replay-case-manifest.json --concurrency 3
```
Fallback (if manifest not ready):
```bash
npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --dry-run --limit 20
npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --limit 20 --concurrency 3
```

Replay artifact diagnostics — verify:
- `judgePromptKey` and `judgeSystemPrompt` captured
- Per-case `failureType` classification reviewed
- No `slot_mismatch`, `date_mismatch`, or `fabricated_link` failures attributable to Phase 148 changes

### 4. Production Verification Checklist
- [ ] New inbound events never write company URLs into `Lead.linkedinUrl`
- [ ] LinkedIn follow-up steps do not stall when only company URL is present; tasks skip-and-advance with a reason
- [ ] At least one valid profile lead can send LinkedIn successfully post-change
- [ ] SMS flow unchanged except for deterministic LinkedIn parsing of customData
- [ ] Post-backfill assertion query returns 0 company URLs in `linkedinUrl`
- [ ] Tim Blais workspace confirmed healthy for LinkedIn + SMS follow-up progression

### 5. Monitoring Log Signatures
Verify these log signatures are present and firing correctly:
- `[LINKEDIN] Company URL skipped — leadId={id}, url={url}` (follow-up engine)
- `[LINKEDIN] Invalid profile URL rejected — leadId={id}, url={url}` (system-sender)
- `[BACKFILL] Migrated company URL — leadId={id}, from=linkedinUrl, to=linkedinCompanyUrl` (backfill script)

## Output
- Validation logs/artifacts recorded (commands + key results).
- Tim Blais workspace confirmed healthy for LinkedIn + SMS follow-up progression.
- Replay artifacts saved to `.artifacts/ai-replay/` (gitignored).

## Handoff
If this phase ships:
1. Update Phase 147 plan to mark 147b (LinkedIn unstick) as **superseded by Phase 148c**.
2. Drop `_phase148_backfill_backup` table after 7-day observation window.
3. Consider whether `normalizeLinkedInUrlAny` can be deprecated now that all callers use `classifyLinkedInUrl`.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Ran mandatory local validation (`lint`, `build`, `test:ai-drafts`).
  - Executed fallback NTTAN replay commands with Tim client ID due missing manifest file.
  - Captured replay artifacts for failed preflight in `.artifacts/ai-replay/`.
- Commands run:
  - `npm run lint` — pass (warnings only).
  - `npm run build` — pass.
  - `npm run test:ai-drafts` — pass.
  - `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --dry-run --limit 20` — fail (preflight DB connectivity).
  - `npm run test:ai-replay -- --client-id 779e97c3-e7bd-4c1a-9c46-fe54310ae71f --limit 20 --concurrency 3` — fail (preflight DB connectivity).
- Replay artifacts:
  - `.artifacts/ai-replay/run-2026-02-13T08-20-36-808Z.json` (`failureTypeCounts.infra_error=1`).
  - `.artifacts/ai-replay/run-2026-02-13T08-20-40-728Z.json` (`failureTypeCounts.infra_error=2`).
  - `judgePromptKey` / `judgeSystemPrompt` not present because replay aborted during DB preflight before case evaluation.
- Blockers:
  - Replay preflight cannot connect to DB (`Can't reach database server at db.pzaptpgrcezknnsfytob.supabase.co`).
  - `docs/planning/phase-148/replay-case-manifest.json` still missing (fallback path used).
- Next concrete steps:
  - Create replay manifest once DB/thread IDs are accessible.
  - Re-run replay dry/live commands and document `judgePromptKey`, `judgeSystemPrompt`, and per-case `failureType`.
  - Complete Tim workspace production verification checklist.
