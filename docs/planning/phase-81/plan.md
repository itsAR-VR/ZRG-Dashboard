# Phase 81 — Configurable Slack Approval Recipients

## Purpose

Replace hardcoded `jonandmika@gmail.com` with workspace-configurable Slack member selection for AI auto-send approval notifications, enabling white-label multi-tenant support.

## Context

### Current State

1. **Hardcoded recipient**: `lib/auto-send/types.ts:85` → `REVIEW_NOTIFICATION_EMAIL: "jonandmika@gmail.com"`
2. **Special case**: `lib/slack-dm.ts:97-100` → `SLACK_JON_USER_ID` env var bypass for this email
3. **No `users.list`**: Only channel listing exists (`slackListConversations` in `lib/slack-bot.ts`)
4. **Per-workspace token**: Already stored in `Client.slackBotToken`
5. **DM by email**: `sendSlackDmByEmail()` looks up user ID by email, then opens DM channel

### User Requirements

- Select multiple people as approval notification recipients
- Pull in Slack workspace members via API
- Configure per-workspace (white-label ready)
- Self-service through Settings UI (no backend code changes needed)

### Technical Approach

1. Add `users.list` Slack API implementation to enumerate workspace members
2. Store selected recipients in `WorkspaceSettings` (JSON field)
3. Add Settings UI for member selection (chip-based multi-select with avatars)
4. Modify auto-send orchestrator to send DMs to configured recipients
5. Keep backwards-compatible fallback to hardcoded email

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 80 | Uncommitted | `lib/auto-send/orchestrator.ts`, `prisma/schema.prisma` | Add schema fields after Phase 80 fields; orchestrator changes are additive |
| Phase 79 | Uncommitted | `lib/ai-drafts.ts` | No overlap — different domain |

## Objectives

* [x] Add Slack `users.list` API implementation
* [x] Add schema fields for approval recipient storage and member caching
* [x] Create server actions for member listing and recipient management
* [x] Add `sendSlackDmByUserId()` for efficient DM sending without email lookup
* [x] Modify auto-send orchestrator to use configured recipients
* [x] Add Settings UI for member selection
* [x] Verify with lint/build

## Constraints

- If no recipients configured (or no workspace token), skip Slack review DMs (no fallback)
- Per-workspace isolation: Each workspace configures their own recipients
- OAuth scope: Bot needs `users:read` (already required for `users.lookupByEmail`)
- Rate limiting: Add delay between sends for >5 recipients

## Success Criteria

- [x] Workspace can select Slack members as approval recipients
- [x] AI auto-send DMs go to all configured recipients
- [x] Review DMs are skipped when no recipients configured (no fallback)
- [x] Member list refreshes on demand from Slack API
- [x] `npm run lint` passes
- [x] `npm run build` passes

## Key Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `slackAutoSendApprovalRecipients`, `slackMembersCacheJson`, `slackMembersCachedAt` |
| `lib/slack-bot.ts` | Add `slackListUsers()` function |
| `lib/slack-dm.ts` | Add `sendSlackDmByUserId()` function |
| `lib/auto-send/get-approval-recipients.ts` | NEW — helper to fetch configured recipients |
| `lib/auto-send/orchestrator.ts` | Modify `sendReviewNeededSlackDm()` for multi-recipient |
| `actions/slack-integration-actions.ts` | Add member listing and recipient management actions |
| `components/dashboard/settings-view.tsx` | Add recipient picker UI in Slack section |
| `app/api/webhooks/slack/interactions/route.ts` | Update Slack message updates to use workspace token |
| `app/api/webhooks/email/route.ts` | Send review DMs to configured recipients |
| `lib/auto-send/README.md` | Document configurable recipients + skip behavior |
| `lib/auto-send/types.ts` | Remove hardcoded review email constant |

## Subphase Index

* a — Schema: Add fields to WorkspaceSettings
* b — API: Add Slack `users.list` and `sendSlackDmByUserId`
* c — Actions: Server actions for member listing and recipient management
* d — Orchestrator: Multi-recipient DM sending
* e — UI: Settings member picker component
* f — Webhook/Slack interaction alignment + logging/docs cleanup

## Phase Summary

- Added workspace-level storage for Slack approval recipients + cached members; DB synced via `db:push`.
- Implemented Slack member listing, approval recipient CRUD, and settings UI selection with refresh.
- Orchestrator now sends review DMs to configured recipients using workspace tokens; skips when none configured.
- Slack interaction updates and legacy email webhook now align with per-workspace tokens/recipients.
- Logs/docs updated to remove “notify Jon” assumptions.
- Validation: `npm run lint` passed (18 warnings, 0 errors); `npm run build` passed after fixing type errors in Phase 80 code.
