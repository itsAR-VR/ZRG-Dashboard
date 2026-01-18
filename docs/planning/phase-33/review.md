# Phase 33 — Review

## Summary

- Shipped dual-axis lead scoring (Fit + Intent) with a 1–4 overall score (`null` for unscored; disqualified leads are forced to `overallScore=1` deterministically).
- Implemented scoring via `gpt-5-nano` with strict JSON-schema output; score reasoning is stored internally only.
- Added `LEAD_SCORING_POST_PROCESS` background job and enqueue on inbound Email post-process (other channels planned in Phase 35).
- Added Inbox overall score badge + server-side score filtering.
- Added a backfill script to enqueue/rescore existing leads in batches (run-until-done + resumable checkpointing).
- Verification reran on 2026-01-18: lint/build passed.

## What Shipped

- `prisma/schema.prisma`
  - `Lead.fitScore`, `Lead.intentScore`, `Lead.overallScore`, `Lead.scoreReasoning`, `Lead.scoredAt`
  - `WorkspaceSettings.idealCustomerProfile`
  - `BackgroundJobType.LEAD_SCORING_POST_PROCESS`
- `lib/lead-scoring.ts`
  - `gpt-5-nano` scoring with strict `json_schema` output (1–4)
  - Deterministic disqualification (`overallScore=1`) without an AI call
  - `enqueueLeadScoringJob()` helper (dedupe-safe)
- `lib/background-jobs/lead-scoring-post-process.ts`, `lib/background-jobs/runner.ts`
  - Dedicated background job handler wiring
- `lib/background-jobs/email-inbound-post-process.ts`
  - Enqueues `LEAD_SCORING_POST_PROCESS` on inbound email post-process
- `components/dashboard/lead-score-badge.tsx`
  - Overall score badge (renders `-` for `null`; normalizes legacy `0` → `1`)
- `actions/lead-actions.ts`, `components/dashboard/conversation-feed.tsx`, `components/dashboard/inbox-view.tsx`
  - Server-side score filter + UI wiring
- `actions/settings-actions.ts`, `components/dashboard/settings-view.tsx`
  - ICP field read/write + UI
- `scripts/backfill-lead-scoring.ts`
  - Batch enqueue/rescore CLI (run-until-done + resumable checkpointing via `.backfill-lead-scoring.state.json`)

## Verification

### Commands

- `npm run lint` — pass (warnings only) (2026-01-18)
- `npm run build` — pass (2026-01-18)
- `npm run db:push` — pass (already in sync) (2026-01-18)

### Notes

- Lint produced warnings (no errors).
- `next build` emitted warnings about multiple lockfiles and the deprecated `middleware` convention; build still succeeded.
- Working tree is not clean (many modified/untracked files); evidence captured via git below.

### Git (evidence)

- `git rev-parse --short HEAD`: `442cacf`
- `git log -1 --oneline`: `442cacf Fix inbox attention counts for campaign outbounds`
- `git status --porcelain`: dirty (many modified + untracked files)
- `git diff --name-only`: includes (non-exhaustive) `prisma/schema.prisma`, `lib/lead-scoring.ts`, `lib/background-jobs/lead-scoring-post-process.ts`, `components/dashboard/lead-score-badge.tsx`, `scripts/backfill-lead-scoring.ts`

## Success Criteria → Evidence

1. Lead model has `fitScore`, `intentScore`, `overallScore`, `scoreReasoning`, and `scoredAt` fields (nullable)
   - Evidence:
     - `prisma/schema.prisma` (Lead scoring fields + indexes)
     - `npm run db:push` output: “The database is already in sync with the Prisma schema.”
   - Status: met

2. Workspace settings includes a dedicated ICP field (AI Personality settings) used in scoring prompts
   - Evidence:
     - `prisma/schema.prisma` (`WorkspaceSettings.idealCustomerProfile`)
     - `actions/settings-actions.ts` + `components/dashboard/settings-view.tsx` (edit/save)
     - `lib/lead-scoring.ts` (injects ICP into prompt when set)
   - Status: met

3. AI scoring uses `gpt-5-nano` + strict structured output (JSON schema) and never writes out-of-range scores
   - Evidence:
     - `lib/lead-scoring.ts` (`model = "gpt-5-nano"`, `text.format.type = "json_schema"`, schema min/max 1–4)
     - `lib/ai/prompt-registry.ts` (prompt key `lead_scoring.score.v1` uses `gpt-5-nano`)
   - Status: met

4. Scores automatically update on every new inbound message without jeopardizing webhook latency (run via a dedicated background job type; aligned with Phase 35 architecture)
   - Evidence:
     - `prisma/schema.prisma` (`BackgroundJobType.LEAD_SCORING_POST_PROCESS`)
     - `lib/background-jobs/runner.ts` (runs the scoring job type)
     - `lib/background-jobs/email-inbound-post-process.ts` (enqueues scoring job)
   - Evidence (gap):
     - `rg enqueueLeadScoringJob` shows only Email enqueue call site today.
   - Status: partial (Email only; SMS/LinkedIn/Instantly/SmartLead planned in Phase 35)

5. Blacklist/opt-out leads are never AI-scored; set `overallScore=1`
   - Evidence:
     - `lib/lead-scoring.ts` (`DISQUALIFIED_SENTIMENT_TAGS`, `isLeadDisqualified()`, deterministic score=1 path)
   - Status: met

6. UI displays unscored (`null`) as `-` (never render literal "null")
   - Evidence:
     - `components/dashboard/lead-score-badge.tsx` (renders `-` for `null`/`undefined`)
   - Status: met
   - Note: disqualified leads are stored/displayed as score `1` (and legacy `0` values are normalized to `1` in the badge).

7. Inbox UI shows lead scores with ability to filter by score
   - Evidence:
     - `components/dashboard/conversation-card.tsx` + `components/dashboard/lead-score-badge.tsx` (badge display)
     - `components/dashboard/conversation-feed.tsx` (filter UI options)
     - `actions/lead-actions.ts` (server-side filter `scoreFilter`)
   - Status: met

8. Backfill script exists to enqueue scoring for existing leads (re-score everyone; safe batching)
   - Evidence:
     - `scripts/backfill-lead-scoring.ts` (batching + `--rescore-all` + dedupe-safe upsert)
     - Supports `--run-until-done` and resumable runs via `.backfill-lead-scoring.state.json`
   - Status: met

## Plan Adherence

- Planned vs implemented deltas (impact):
  - Cross-channel scoring enqueue deferred to Phase 35 → scoring is not yet triggered for SMS/LinkedIn/Instantly/SmartLead inbound messages.
  - CRM migrated to `overallScore` (legacy `leadScore` no longer used in the CRM list).

## Risks / Rollback

- Risk: “re-score on every inbound message” can increase spend/queue length.
  - Mitigation: `gpt-5-nano`, transcript truncation, token budgets, background job isolation.
- Risk: incomplete channel coverage yields inconsistent scoring across channels.
  - Mitigation: Phase 35 inbound post-process jobs should enqueue `LEAD_SCORING_POST_PROCESS` per inbound message.
- Rollback:
  - Stop enqueuing `LEAD_SCORING_POST_PROCESS` from post-process handlers; leave schema/data intact.

## Follow-ups

- Wire `enqueueLeadScoringJob()` into SMS inbound post-process, then LinkedIn (Phase 35). Instantly/SmartLead should also enqueue via the Email inbound post-process path (provider-specific, but same “email channel” behavior).
- (Optional) Consider exposing a dedicated “Disqualified” filter via sentiment tags across all views (Inbox already supports it via score filter + server-side sentiment matching).
