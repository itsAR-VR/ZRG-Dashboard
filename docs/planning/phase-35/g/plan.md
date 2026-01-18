# Phase 35g — Orchestration Pattern + Cross-Phase Verification (RED TEAM)

## Focus

Harden the “webhook → enqueue → cron runner executes job handlers” pattern so we avoid Vercel runtime errors, and ensure Phase 33 lead scoring integrates cleanly as a cross-cutting background job across all channels.

## Inputs

- Phase 35 root plan (Vercel runtime notes + repo mismatches)
- Background job runner: `lib/background-jobs/runner.ts`
- Cron route: `app/api/cron/background-jobs/route.ts`
- Schema: `prisma/schema.prisma`
- Phase 33 lead scoring plans: `docs/planning/phase-33/plan.md` + subphases

## Work

1. **Add the cross-cutting job type**
   - Ensure `BackgroundJobType` includes `LEAD_SCORING_POST_PROCESS`.

2. **Add the lead scoring job handler (Phase 33 dependency)**
   - Create `lib/background-jobs/lead-scoring-post-process.ts` that:
     - Loads `Lead` + `WorkspaceSettings` + recent `Message` rows (all channels)
     - Skips AI scoring for Blacklist/opt-out and sets `overallScore=1` deterministically
     - Re-scores on every inbound message (do not skip just because scores already exist)
     - Uses Phase 33 scoring engine (`gpt-5-nano`, strict JSON schema) to populate scores and `scoredAt`

3. **Wire dispatch into the runner**
   - Update `lib/background-jobs/runner.ts` switch/case to run `LEAD_SCORING_POST_PROCESS`.

4. **Enqueue scoring from each channel post-process**
   - Email: enqueue from `lib/background-jobs/email-inbound-post-process.ts` after transcript backfill/enrichment so scoring sees best context.
   - SMS/LinkedIn/SmartLead/Instantly: enqueue from their inbound post-process handlers (Phases 35b–35e).
   - Use dedupe keys to avoid duplicate scoring per inbound message.
   - Ensure scoring runs as its **own** job invocation (not embedded inside a long “do everything” handler) so Vercel timeouts/costs are isolated.

5. **Cross-agent verification checklist**
   - Phase 33 schema fields exist and match naming in code (`fitScore`, `intentScore`, `overallScore`, `scoreReasoning`, `scoredAt`, `WorkspaceSettings.idealCustomerProfile`).
   - Phase 35 refactors never run AI work synchronously in the webhook routes (webhooks respond < 2s).
   - All AI calls (sentiment, drafts, lead scoring) maintain `AIInteraction` telemetry attribution.

6. **Runtime safety checklist (Vercel)**
   - Keep webhook handlers minimal: validate, write Message/Lead, enqueue jobs, return.
   - Enforce strict timeouts per external call inside job handlers (OpenAI, Clay, provider APIs).
   - Keep cron runner time-budgeted (existing `deadlineMs` buffer) so it always returns cleanly.

## Validation (RED TEAM)

- End-to-end for each channel:
  - Send inbound message → webhook returns fast → post-process job runs → scoring job runs → Lead scores populated
- Stress:
  - Enqueue 50+ scoring jobs and confirm cron continues processing over multiple invocations without timeouts.

## Output

- Lead scoring is a first-class background job stage, integrated across channels without increasing webhook latency.

## Handoff

Phase 33 UI filtering can rely on stable, populated `overallScore` values after backfill and ongoing scoring.
