# Phase 181e — Cron/Auto-Send Integration + Slack/Telemetry + Safety Gates

## Focus
Ensure deferred tasks execute reliably in production and are observable for operators.

## Inputs
- Output from Phase 181d.
- Existing cron and auto-send integrations:
  - `lib/cron/followups.ts`
  - `lib/followup-timing.ts`
  - `lib/auto-send/*`
  - Slack notification pathways for timing misses and routing skips.

## Work
1. Wire deferred task processing into existing due-task cron path with current campaign gating (`AI_AUTO_SEND` requirement).
2. Ensure meaningful-activity guards continue to prevent stale auto-sends (new inbound / setter outbound).
3. Emit structured Slack/notification events for:
   - deferred-task scheduled,
   - deferred-task sent,
   - deferred-task canceled,
   - availability fetch failure + retry queued.
4. Add dashboard-visible metadata hooks (where existing models support it) so setters can inspect deferred-window state.
5. Verify no regressions in existing timing clarify #1/#2 and re-engagement pathways.

## Output
- Production execution path for deferred-window automation with clear telemetry and operator visibility.

## Handoff
Phase 181f validates end-to-end behavior with replay + tests and writes review evidence.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Expanded due-task auto-send campaign filter to include future-window notice/recontact auto campaigns.
  - Added runtime refresh behavior for future-window recontact sends:
    - fetch fresh availability before send,
    - refresh suggested message/draft content before approval/send,
    - queue availability refresh retry on refresh errors.
  - Expanded follow-up draft eligibility for routing suppression/backfill:
    - `Follow-up future-window deferral notice (auto)`
    - `Follow-up future-window recontact (auto)`
  - Added unit assertions for new campaign eligibility.
- Commands run:
  - Code implementation pass in:
    - `lib/followup-timing.ts`
    - `lib/followup-task-drafts.ts`
    - `lib/__tests__/followup-task-drafts.test.ts`
- Blockers:
  - Telemetry event fanout (scheduled/sent/canceled) not yet split into dedicated new event kinds.
- Next concrete steps:
  - Decide whether to introduce explicit event kinds now or keep existing `followup_timing_miss` channel with reason-based partitioning.
