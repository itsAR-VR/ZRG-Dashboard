# Phase 174 — Review

## Summary
- Phase 174 implementation is complete for repo scope: AI timing extraction, scheduled follow-up task upsert with stored drafts, and due-task auto-send processing were shipped.
- Quality gates passed on the current combined worktree: `npm run lint`, `npm run build`, `npm test`, and `npm run db:push`.
- Agentic impact classification is `nttan_required` (AI/message/follow-up/cron paths touched), but replay gates were explicitly waived by user directive for this phase.
- Multi-agent overlap with active Phase 173 files was handled by preflight checks and just-in-time file re-reads before edits.

## What Shipped
- New modules:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-timing-extractor.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-timing.ts`
- Inbound integration updates:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/inbound-post-process/pipeline.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/email-inbound-post-process.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/sms-inbound-post-process.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/background-jobs/linkedin-inbound-post-process.ts`
- Follow-ups cron integration:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/cron/followups.ts`
- Legacy deterministic parser extension (quarter support):
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/snooze-detection.ts`
- Tests and docs:
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/__tests__/snooze-detection.test.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/__tests__/followup-timing.test.ts`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/.env.example`
  - `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/README.md`

## Verification

### Commands
- `npm run lint` — pass with existing warnings only (`2026-02-19T21:43:04Z`)
- `npm run build` — pass (`2026-02-19T21:43:04Z`)
- `agentic impact classification` — `nttan_required` (AI extractor, inbound message routing, follow-up cron send logic touched)
- `npm run test:ai-drafts` — skipped (user waiver: "no nttan needed")
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-174/replay-case-manifest.json --dry-run` — skipped (user waiver)
- `npm run test:ai-replay -- --thread-ids-file docs/planning/phase-174/replay-case-manifest.json --concurrency 3` — skipped (user waiver)
- `npm test` — pass (`417/417`)
- `npm run db:push` — pass (`The database is already in sync with the Prisma schema.`)

### Notes
- NTTAN replay diagnostics (`judgePromptKey`, `judgeSystemPrompt`, `failureType`) are not available for this phase because replay was intentionally not run by user directive.
- Lint warnings are pre-existing and unrelated to Phase 174 behavior.

## Success Criteria → Evidence

1. AI timing extraction identifies concrete defer dates and resolves UTC via timezone fallback chain.
   - Evidence: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-timing-extractor.ts`, `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-timing.ts`
   - Status: partial (implementation + deterministic helper coverage are present; live replay evidence was waived)

2. Follow-up sentiment with detected defer date creates/updates one pending scheduled task with stored draft content.
   - Evidence: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-timing.ts` (single pending upsert, `suggestedMessage`, `subject`)
   - Status: met

3. `Lead.snoozedUntil` and sequence pause state are updated consistently.
   - Evidence: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-timing.ts` (`lead.update`, `pauseFollowUpsUntil`)
   - Status: met

4. No-date extraction path does not create tasks and sends ops visibility alerts.
   - Evidence: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-timing.ts` (`notifyTimingExtractionMissForOps`, early return no task)
   - Status: met

5. Due-task processor auto-sends eligible email/SMS tasks, reschedules outside window, and falls back to manual when blocked.
   - Evidence: `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/followup-timing.ts` (`processScheduledTimingFollowUpTasksDue`), `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/cron/followups.ts`
   - Status: met

6. Validation gates pass and phase records user NTTAN waiver.
   - Evidence: command results in this review + waiver in `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-174/plan.md`
   - Status: met

## Plan Adherence
- Planned vs implemented deltas:
  - NTTAN replay steps (`174d`/`174f`) were planned but intentionally skipped due explicit user directive; fallback gates (`lint/build/test`) were run and documented.
  - Deterministic quarter parsing was additionally expanded in `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/lib/snooze-detection.ts` for legacy non-follow-up sentiment paths to preserve and extend prior behavior.

## Multi-Agent Coordination
- Preflight checks run:
  - `git status --short`
  - `ls -dt docs/planning/phase-* | head -10`
- Overlap area: Phase 173 touched nearby inbound and settings domains.
- Resolution: Phase 174 edits stayed scoped to follow-up timing and cron paths; no Phase 173 docs/files were modified by this phase closeout.

## Risks / Rollback
- Risk: replay-based AI quality evidence is absent because NTTAN was waived.
  - Mitigation: run deferred replay suite later using `/Users/AR180/Desktop/Codespace/ZRG-Dashboard/docs/planning/phase-174/replay-case-manifest.json` after curating thread IDs.
- Rollback: disable auto-send by setting `FOLLOWUP_TASK_AUTO_SEND_ENABLED` off; scheduled task creation still remains available for manual follow-up handling.

## Follow-ups
- Optional hardening: add isolated unit tests that mock extractor response edge cases (schema-invalid/ambiguous/no-date) to increase deterministic coverage without requiring replay.
