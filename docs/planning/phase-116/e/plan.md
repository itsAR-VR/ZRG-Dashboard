# Phase 116e — Production Rollout + Smoke + Rollback

## Focus
Ship Phase 116 safely: apply schema, deploy with conservative defaults, run smoke checks, monitor canary, and document rollback steps.

## Inputs
- Phase 116a checklist (acceptance + smoke + rollback levers)
- Phase 116b schema verification output
- Phase 116d admin visibility (kill-switch + metrics)

## Work
1. Deployment prerequisites (Vercel)
   - Confirm environment variables exist and are correct:
     - `DATABASE_URL`, `DIRECT_URL`
     - `OPENAI_API_KEY`
     - `CRON_SECRET`
     - `WORKSPACE_PROVISIONING_SECRET`
     - `AUTO_SEND_DISABLED` (should usually be unset/0)
     - `AUTO_SEND_REVISION_DISABLED` (start as `"1"` for initial deploy)

2. Rollout sequence (recommended)
   - Deploy with schema applied and revision disabled globally (`AUTO_SEND_REVISION_DISABLED=1`) so behavior is unchanged.
   - Smoke test core flows:
     - Admin Dashboard loads and shows revision disabled pill.
     - Auto-send evaluator still functions (drafts get `autoSendAction` + `autoSendConfidence` recorded).
   - Canary enablement (production-safe):
     - Turn off the global kill-switch (`AUTO_SEND_REVISION_DISABLED` unset/0) once you are ready to test revision.
     - Enable revision for **one workspace** via the super-admin toggle (`WorkspaceSettings.autoSendRevisionEnabled=true`).

3. Canary monitoring (first 30–60 minutes)
   - Confirm revision attempts are bounded (no repeated attempts per `AIDraft.id`).
   - Confirm applied count is reasonable and doesn’t spike `needs_review` unexpectedly.
   - Watch for timeouts/errors in revision path (`deadline_exceeded`, DB update failures).

4. Rollback
   - Fast rollback: set `AUTO_SEND_REVISION_DISABLED=1` (revision off).
   - Workspace-only rollback: disable the workspace toggle (`autoSendRevisionEnabled=false`) if you want to keep revision on for other workspaces.
   - Full auto-send rollback (if needed): set `AUTO_SEND_DISABLED=1`.

5. Post-launch (24h)
   - Review revision metrics in Admin Dashboard for stability.
   - Sample a small set of revised drafts (applied=true) to confirm quality meets policy.

## Output
- A validated rollout/rollback runbook and a post-launch monitoring checklist.

## Handoff
- If post-launch data suggests additional tuning (thresholds, prompts, context packs), open a new phase scoped to improvements rather than launch readiness.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented the rollout levers required for a safe canary: global kill-switch + per-workspace enable toggle + admin visibility for attempted/applied counts. (see Phase 116d)
  - Validated local quality gates and synced the DB schema. (see Phase 116a/116b)
- Commands run:
  - `npm run build` — pass
  - `npm test` — pass
  - `npm run db:push` — pass
- Blockers:
  - Canary enablement + monitoring must be executed in production by an operator (not automatable in-repo).
- Next concrete steps:
  - Set `AUTO_SEND_REVISION_DISABLED=1` for initial deploy if you want “no-behavior-change” safety.
  - When ready: turn kill-switch OFF, then enable `WorkspaceSettings.autoSendRevisionEnabled=true` for one canary workspace via Confidence Control Plane.
  - Monitor attempted/applied counts and error logs for 30-60 minutes before expanding rollout.
