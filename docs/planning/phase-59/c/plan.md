# Phase 59c — RED TEAM Hardening: Consistency + Safe Migration

## Focus
Close the gaps identified in the Phase 59 RED TEAM review so Phase 59a/59b can be executed safely:

1) resolve missing “exact copy” requirements (don’t invent messaging),
2) eliminate template drift across duplicate sources (`actions/`, `lib/`, `scripts/`),
3) harden the migration approach so it doesn’t overwrite user edits and has rollback support.

## Inputs
- Phase 59 root plan:
  - Canonical messaging reference section
  - **Open Questions (Need Human Input)** decisions
- Template sources (repo reality):
  - `actions/followup-sequence-actions.ts`
  - `lib/followup-sequence-linkedin.ts`
  - `scripts/backfill-linkedin-sequence-steps.ts`
- Data model:
  - `prisma/schema.prisma` (`FollowUpSequence`, `FollowUpStep`)
- Script patterns / tooling:
  - `package.json` (`tsx` available; `ts-node` not used)
  - `scripts/migrate-appointments.ts` (dotenv + `DIRECT_URL` + `PrismaClient` + resumable/dry-run pattern)

## Work

### 1) Lock missing canonical copy (stop-ship if unanswered)
- Collect the exact wording for:
  - Meeting Requested: Day 2 LinkedIn DM (after connection accepted)
  - No Response: LinkedIn behavior and message(s) on Day 2/5/7 (and whether Day 2 is connect vs DM)
  - Meeting Requested: whether Day 1/2/5/7 email/SMS steps beyond the provided Day 1 SMS + LinkedIn connect should be rewritten or left as-is
  - Whether email subjects + signatures are part of “exact copy”
- Update Phase 59 root plan’s **Reference: User’s Canonical Messaging** section accordingly (append-only; don’t remove provided copy).

### 2) Update templates everywhere they live (drift prevention)
- Update the default templates in `actions/followup-sequence-actions.ts`:
  - Meeting Requested: LinkedIn Day 1 connect message, SMS message (and confirm `dayOffset` mapping)
  - No Response: email/SMS bodies to exact copy; adjust LinkedIn templates and `linkedin_connected` gating per decision
  - Post-Booking: email body to exact copy (remove any extra lines if “exact”)
- Update duplicated LinkedIn templates in `lib/followup-sequence-linkedin.ts` to match `actions/*`.
- Update `scripts/backfill-linkedin-sequence-steps.ts` templates so any future backfill won’t reintroduce outdated copy.
- Add a validation check so drift can’t silently return:
  - lightweight option: a unit test that asserts the LinkedIn template strings match across files
  - simplest option: a grep-based CI check (only if the repo already has similar checks)

### 3) Migration script hardening (safe + reversible)
- Implement `scripts/migrate-default-sequence-messaging.ts` using `tsx`:
  - Load `.env.local` and `.env` via `dotenv` (follow existing scripts)
  - Use `DIRECT_URL` preferred, fallback to `DATABASE_URL`
  - Provide `--dry-run` (default) and `--apply`
  - Optional: `--clientId <uuid>` for scoped runs
- **Do not clobber user edits by default**:
  - Only update a step if its current `messageTemplate` (and `subject`, if applicable) matches a known old default template (allow conservative whitespace normalization if needed).
  - Log and count “customized” sequences/steps that do not match known defaults.
- Rollback support:
  - Write a rollback JSON file containing `{ stepId, oldMessageTemplate, newMessageTemplate, oldSubject?, newSubject?, oldCondition?, newCondition? }` for every change.
  - Provide a `--rollback <file>` mode (optional but recommended for production safety).
- Execution safety:
  - Use bounded transactions (per sequence or per client) and set Prisma transaction timeouts.
  - Prefer updating via `updateMany` where possible; avoid per-row sequential updates with no batching if client count is large.

### 4) Validation / QA
- Repo checks:
  - `rg` for old/outdated copy to ensure it’s fully replaced across `actions/`, `lib/`, and `scripts/`
  - `npm run lint`
  - `npm run build`
- DB checks (dry-run first):
  - Run migration script in dry-run mode and review counts + sampled diffs
  - Run apply mode after confirming rollback artifact is created
  - Execute the Phase 59b verification SQL query to confirm updated templates

## Output
- A fully specified Phase 59 plan with no invented “exact copy”
- Template sources updated consistently across code + scripts
- A safe migration script with dry-run + apply + rollback capability
- Concrete validation steps to prove correctness and prevent drift

## Handoff
Phase 59a/59b can proceed with clarified copy, consistent templates, and a migration plan that won’t overwrite user edits without intention.

