# Phase 162a — Preflight: Repro Packet + Working Tree Reconciliation

## Focus
Create a concrete repro/evidence packet for the FC call-request signature failure and slot-confirmation bug, and reconcile the current working tree against concurrent phases so Phase 162 work can be landed safely.

## Inputs
- Root context: `docs/planning/phase-162/plan.md`
- FC workspace/client id: `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`
- Example lead + thread:
  - lead email: `emad@tradefinancecompany.com`
  - inbound message id: `7539428d-1129-4de2-9795-f1e4c6fc18ab`
  - outbound message id: `c2baf839-763b-4159-b387-d19ee4d9fe10`
  - ai draft id: `b93ae895-b969-4acf-ab3e-ee592b23318b`
- DB evidence already observed:
  - lead phone exists
  - action-signal route was `processId=3 (uncertain)` and no NotificationSendLog rows
- Current repo state: many modified files in `lib/*` and tests (must not assume clean tree).

## Work
- Pre-flight conflict check:
  - Run `ls -dt docs/planning/phase-* | head -10` and scan overlap.
  - Run `git status --porcelain` and list files Phase 162 expects to touch.
  - If `components/dashboard/settings-view.tsx`, `next.config.mjs`, Knowledge Assets upload files are modified: treat as out-of-scope for Phase 162 and avoid editing.
- Build a minimal repro packet (write into this subphase file as “Evidence” section):
  - Supabase SQL snippets to confirm:
    - lead phone on file
    - action-signal route outcome
    - NotificationSendLog absence
    - draft auto-send evaluation fields (confidence/threshold/action)
  - Identify whether the message was processed by:
    - `lib/background-jobs/email-inbound-post-process.ts` (EmailBison)
    - `lib/inbound-post-process/pipeline.ts` (webhook adapter)
  - Note where signature stripping occurs (`lib/email-cleaning.ts`).
- Decide landing strategy:
  - If Phase 162 changes are already present locally, list them as “in working tree, needs verification”.
  - Ensure Phase 162 will result in a small number of cohesive commits (one per subphase group, or 2 commits: correctness + tests).

## Output
- Updated `docs/planning/phase-162/a/plan.md` with an Evidence section containing:
  - the key IDs
  - the exact DB queries
  - the observed outputs
  - the responsible codepaths
- A coordination note enumerating which modified files are out-of-scope and must be avoided.

## Handoff
- Proceed to 162b with a confirmed list of target files for slot-confirmation fixes and the tests that should be updated.
