# Phase 108h — Eval Loop (Direct Scoring + Pairwise), Weekly Cron + On-Demand

## Focus
Implement the evaluation loop that scores drafts and produces proposal candidates using the message performance dataset, with weekly cron + on-demand runs.

## Inputs
- Phase 108b/c dataset extraction + synthesis artifacts.
- Existing cron patterns:
  - `app/api/cron/insights/*`
  - `vercel.json`
- Prompt runner + evaluator patterns:
  - `lib/ai/prompt-runner/*`
  - `lib/ai/prompt-registry.ts`

## Work
1. **Eval runner:**
   - Direct scoring + pairwise comparison on sampled messages.
   - Produces structured proposal candidates (prompt/asset changes only).
2. **Scheduling:**
   - Weekly cron (single fixed UTC schedule).
   - Per-workspace opt-in in settings.
3. **Persistence:**
   - Store eval run metadata + proposal candidates for review.
4. **On-demand trigger:**
   - Admin-only action to run eval for a workspace and window.

## Validation (RED TEAM)
- Cron auth via `CRON_SECRET` before work.
- Ensure per-workspace opt-in is enforced.

## Output
- Eval loop implemented (`lib/message-performance-eval.ts`) with direct scoring + pairwise comparison.
- On-demand eval action (`actions/message-performance-eval-actions.ts`) and weekly cron (`app/api/cron/insights/message-performance-eval/route.ts`).
- Eval runs persist to `MessagePerformanceEvalRun` and emit proposal candidates.

## Handoff
Phase 108j handles approval, apply, and rollback for proposals.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented eval runner with scoring + pairwise prompts and proposal generation.
  - Added weekly cron schedule for eval runs and per-workspace opt-in.
  - Persisted eval run metadata + proposals.
- Commands run:
  - `rg -n "message_performance.eval" lib/message-performance-eval.ts` — verified eval runner wiring.
- Blockers:
  - None.
- Next concrete steps:
  - Confirm proposal approval/apply flow in UI (Phase 108j).
