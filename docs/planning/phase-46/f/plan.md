# Phase 46f — Backfill/Cleanup + Validation Harness (FC)

## Focus
Provide a safe way to (1) detect whether duplicate outbound email `Message` rows already exist for Founders Club, (2) optionally clean them up, and (3) validate “no new duplicates” without introducing a new test framework.

## Inputs
- FC workspace id: `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`
- Data model: `prisma/schema.prisma` (`Message.emailBisonReplyId`, `Message.source`, `Message.sentBy`, `Message.aiDraftId`, `Message.sentAt`)
- Suspect duplication pattern:
  - two outbound `email` messages for the same lead within a short window where one has `emailBisonReplyId` and the other does not (or both exist with different normalization)
- No repo-wide unit test runner (`package.json` has no Jest/Vitest scripts)

## Work
1) Add a deterministic “duplicate detector” script (preferred) or admin-only action:
   - Preferred: a `tsx` script under `scripts/` that:
     - filters to FC clientId
     - scans `Message` rows for each lead where `direction="outbound"` and `channel="email"`
     - flags suspicious pairs in a small time window (e.g., ≤ 2 minutes) with:
       - same `subject` (or both null)
       - one row has `emailBisonReplyId` and another has `emailBisonReplyId=null`
     - outputs counts + ids only (no message bodies/emails)
     - supports `--dry-run` (default) vs `--apply` (explicit) to prevent accidental destructive cleanup
2) Decide cleanup policy (must be conservative):
   - If a pair is detected and we have a “canonical” row (has `emailBisonReplyId`), then:
     - either delete the non-canonical row, or
     - mark it in a reversible way (if deletion is risky) and filter it out in the UI.
   - If neither row has `emailBisonReplyId`, do not delete; just flag (needs manual review).
3) Add a “post-fix validation” mode:
   - Re-run the detector after implementing 46b to confirm:
     - the number of new suspicious pairs after a test send is zero
     - sync run heals instead of inserting

## Output
- A reproducible, low-risk validation path for FC that can be run before/after deploy to prove the fix works and to reduce legacy “double set” noise.

## Handoff
If we choose to do cleanup, coordinate rollout carefully (run in a safe environment first). If cleanup is deferred, ensure 46e’s runbook distinguishes “legacy duplicates” from “new duplicates”.

## Output (Filled)
### Added: FC duplicate detector/merger script (IDs only, dry-run by default)

- New script: `scripts/dedupe-fc-emailbison-outbound.ts`
  - Detects the specific “send row (no reply id) + sync-import row (has reply id)” pattern for outbound EmailBison replies in a given workspace.
  - Prints only `leadId`, `messageId`, `replyId`, and time deltas (no subjects/bodies/emails).
  - Default mode is dry-run; destructive operations require `--apply`.
  - Cleanup strategy (when `--apply`):
    - Prefer keeping the send-created row when it has attribution (`aiDraftId`, `sentByUserId`, or `sentBy="setter"`).
    - Moves `emailBisonReplyId` + provider `rawHtml/rawText` onto the kept row, then deletes the duplicate row.

Example usage:
- Dry-run (default): `npx tsx scripts/dedupe-fc-emailbison-outbound.ts`
- Apply: `npx tsx scripts/dedupe-fc-emailbison-outbound.ts --apply`
- Tuning: `--since-days 60 --window-seconds 120 --limit 2000 --verbose`

## Handoff (Filled)
Run the script in a safe environment first (dry-run), then (if results look correct) apply cleanup for FC. After deploy, re-run dry-run to confirm “no new pairs” are detected.
