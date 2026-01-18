# Phase 33g — Backfill Existing Leads

## Focus

Create a safe backfill mechanism to score existing leads (without blocking webhooks) by enqueueing lead-scoring background jobs in batches.

## Inputs

- Lead scoring schema + engine (Phases 33a–33c)
- Background jobs infrastructure:
  - `prisma/schema.prisma` (`BackgroundJob`)
  - `lib/background-jobs/runner.ts`
  - `app/api/cron/background-jobs/route.ts`

## Work

1. **Create a backfill script**
   - Add a Node script (e.g., `scripts/backfill-lead-scoring.ts`) that:
     - Selects **all** leads (re-score everyone), but only enqueues jobs for leads with at least one inbound message (outbound-only / no-message leads remain unscored/null)
     - For Blacklist/opt-out leads, set `overallScore=1` deterministically (no AI call) or enqueue scoring jobs that apply this rule
     - Enqueues lead scoring jobs using **upsert** on a stable `dedupeKey` so the script can be re-run safely (requeues succeeded jobs)
     - Supports batching + rate limiting (e.g., `--limit`, `--cursor`, `--clientId`, `--dryRun`)
     - Uses the most recent inbound `Message.id` as the anchor `messageId` for the job (required by the `BackgroundJob` schema)

2. **Prefer enqueue-only (no AI in the script)**
   - The script should enqueue jobs; AI work runs in background job handlers to avoid local timeouts and keep execution consistent with production.

3. **Run strategy**
   - Recommend running in multiple passes (small batches) to control cost.
   - Optionally spread `runAt` timestamps to avoid cron bursts.

## Validation (RED TEAM)

- Run in `--dryRun` mode and confirm counts match expectations.
- Run a small batch for one workspace and confirm:
  - BackgroundJob rows created (dedupe-safe)
  - Cron processes jobs successfully
  - Leads get scores populated

## Output

**Completed 2026-01-17:**

Created `scripts/backfill-lead-scoring.ts` with the following features:

1. **CLI options:**
   - `--dry-run` (default): Show what would be enqueued without changes
   - `--apply`: Actually enqueue jobs and update disqualified leads
   - `--clientId <id>`: Process only leads from a specific workspace
   - `--limit <n>`: Page size (default: 500)
   - `--cursor <id>`: Start from a specific lead ID (for pagination)
   - `--rescore-all`: Re-score already scored leads (default: only unscored)
   - `--delay-ms <n>`: Spread runAt timestamps to avoid cron bursts
   - `--run-until-done`: Continue paging until there are no more leads
   - `--single-batch`: Process exactly one page (even in `--apply` mode)
   - `--page-delay-ms <n>`: Sleep between pages (default: 0)
   - `--state-file <path>`: Path to checkpoint file (default: `.backfill-lead-scoring.state.json`)
   - `--resume`: Resume from checkpoint file cursor (ignored if `--cursor` is provided)

2. **Processing logic:**
   - Finds leads with at least one inbound message
   - For Blacklist/opt-out leads: Sets score=1 directly (no AI call)
   - For other leads: Enqueues LEAD_SCORING_POST_PROCESS background jobs
   - Uses stable dedupe key (`lead_scoring_backfill:{leadId}`) for safe re-runs
   - Upserts jobs (resets status if previously failed)

3. **Output:**
   - Summary with counts (enqueued, disqualified, skipped, errors)
   - Last lead ID for cursor-based pagination
   - Clear messaging for dry-run mode

- Backfill script exists and can be safely re-run to score historical leads.

## Handoff

After backfill, Phase 33d can reliably filter/sort by score across the inbox.
