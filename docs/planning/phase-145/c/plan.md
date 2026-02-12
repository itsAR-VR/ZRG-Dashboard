# Phase 145c — Process 4/5 Slack-Only Handoff + Notification Controls

## Focus

Finalize process-specific handoff behavior, especially Process 4 and Process 5, with Slack-only execution and no outbound reply.

## Inputs

- `docs/planning/phase-145/b/plan.md`
- Notification/router surfaces:
  - `lib/action-signal-detector.ts`
  - `lib/inbound-post-process/pipeline.ts`
  - `actions/settings-actions.ts`
  - `components/dashboard/settings-view.tsx`

## Coordination Pre-Flight (Mandatory)

- Run `git status --short` and overlap scan for phases 141–144 before edits.
- Re-read latest versions of:
  - `lib/action-signal-detector.ts`
  - `lib/inbound-post-process/pipeline.ts`
  - `actions/settings-actions.ts`
  - `components/dashboard/settings-view.tsx`
- Record any merge conflicts and chosen symbol-level resolution in progress notes.

## Existing Infrastructure (RED TEAM — build on, don't rebuild)

- `notifyActionSignals()` at `lib/action-signal-detector.ts:555` — already sends Slack notifications for action signals using `slackBotToken`, `slackAlerts`, `notificationSlackChannelIds`.
- `lib/notification-center.ts` — sentiment-based notification routing with dedup via `NotificationEvent.dedupeKey`.
- `lib/slack-dm.ts` / `lib/slack-notifications.ts` / `lib/slack-format.ts` / `lib/slack-bot.ts` — full Slack toolkit.
- `recordAiRouteSkip()` at `lib/ai/route-skip-observability.ts` — telemetry for when AI routes are skipped by workspace settings.
- Phase 141 toggle fields in `WorkspaceSettings`: `draftGenerationEnabled`, `meetingOverseerEnabled`, `aiRouteBookingProcessEnabled` — new kill switches must be additive alongside these.

## Work

1. Enforce Process 4 and Process 5 execution contract:
   - Add P4/P5 conditional check in `lib/inbound-post-process/pipeline.ts` **before** the `draft_generation` stage. When P4/P5 is detected (from decision contract routing), skip draft generation and suppress outbound lead auto-send/reply.
   - Always notify Slack (extend `notifyActionSignals()` with P4/P5 reason tags).
   - Do not emit any lead-facing outbound content from these paths.
   - Log suppression via `recordAiRouteSkip()` with new key `"process_handoff_p4_p5"`.
2. Implement phone-preference Slack task payload:
   - Include explicit reason to call immediately.
   - Include quick actions for GHL contact and dashboard contact.
   - Build on existing `notifyActionSignals()` message format.
3. Implement multi-channel + assignee fan-out:
   - Extend existing `notificationSlackChannelIds` pattern in WorkspaceSettings.
   - Add new fields for assignee fan-out (DM/mention targets).
4. Add notification type selectors for P4/P5 events (parallel to existing `notificationSentimentRules` pattern).
5. Keep 5-minute dedup window by lead + reason:
   - Implement as per-notification-type window override (don't change existing 1-hour sentiment dedup default).
   - Use `NotificationEvent.dedupeKey` with P4/P5-specific key format.
   - During migration, support legacy dedupe keys in read-path checks to avoid double-send regressions while new keys roll out.
6. Add workspace/global kill switches for routing/notifications:
   - New `WorkspaceSettings` booleans (additive alongside phase 141 toggles).
   - Env-var kill switch for global disable (match `AUTO_SEND_DISABLED` pattern).
7. Preserve route visibility for route-only P4/P5 outcomes.
8. **Schema migration:** Add new fields to `prisma/schema.prisma` → `WorkspaceSettings`:
   - P4/P5 notification toggle booleans
   - Notification assignee config (Json?)
   - Route/notification kill switch booleans
   - Run `npm run db:push` and verify in Studio.

## Edge Cases

- Duplicate inbound messages in short windows.
- Route-only result with zero signals.
- Missing GHL contact link context.
- Multiple configured channels with partial API/token failures.

## Validation

- Unit tests for dedup behavior and fan-out selection.
- Unit tests asserting no outbound reply for P4/P5.
- Unit tests asserting `recordAiRouteSkip()` is called for P4/P5 suppression.
- Settings persistence tests for toggles/recipient config.
- `npm run lint`, `npm run build`, `npm run test`
- `npm run test:ai-drafts`
- `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
- `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
- `npm run db:push` (after schema changes)

## Output

- Process 4/5 behavior is deterministic at execution layer and fully configurable operationally.

## Handoff

145d integrates dual-track replay and infra preflights for robust pass/fail attribution.
