# Phase 70 — AI Auto-Send Dashboard Filter + Visibility

## Purpose

Add dashboard visibility into AI auto-send decisions so users can filter leads by AI-sent messages, view drafts pending review, see confidence scores with reasoning for each decision, and backfill historical data so these filters work retroactively.

## Context

After the Phase 69 backfill completed, the user requested the ability to:
1. See all messages sent by AI auto-send in the dashboard
2. See messages flagged for Jon's approval (low confidence)
3. View the reasoning for why drafts were flagged as lower confidence

**Current gap:** The auto-send evaluator returns confidence scores and reasoning, but this data is **not persisted** to the database. The Slack DM is sent for low-confidence drafts, but there's no record in the DB tracking which drafts needed review or why.

### Dashboard Filter Architecture

From codebase exploration:
- Sidebar filters defined in `components/dashboard/sidebar.tsx` (lines 149-154)
- Current filters: `responses`, `attention`, `needs_repair`, `previous_attention`
- Filters compose into `ConversationsCursorOptions` → `getConversationsCursor()` in `actions/lead-actions.ts`
- Counts fetched via `getInboxCounts()` using raw SQL for performance

### Auto-Send Evaluation Data (Not Persisted)

From `lib/auto-send-evaluator.ts`:
```typescript
{
  confidence: number;      // 0.0-1.0
  safeToSend: boolean;
  requiresHumanReview: boolean;
  reason: string;          // Explanation for the decision
}
```

This data is used immediately in `executeAiAutoSendPath()` but discarded after the decision is made.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 69 | Complete | `lib/auto-send/orchestrator.ts` | Read current state before modifying |
| Phase 67 | Complete | Auto-send infrastructure | No active conflicts |

## Pre-Flight Conflict Check (Multi-Agent)

- [ ] Run `ls -dt docs/planning/phase-* | head -10` and scan for overlap with auto-send + inbox filters.
- [ ] Run `git status --porcelain` and confirm no unexpected edits in:
  - `prisma/schema.prisma`
  - `lib/auto-send/*`
  - `actions/lead-actions.ts`
  - `components/dashboard/*`
- [ ] If overlap exists, re-read current file contents before making changes (don’t rely on cached assumptions).

## Objectives

* [x] Add schema fields to `AIDraft` to persist auto-send evaluation data
* [x] Update auto-send orchestrator (and delayed job runner, if needed) to persist evaluation/action data after decisions
* [x] Add "AI Sent" and "AI Needs Review" sidebar filter options
* [x] Update filter plumbing end-to-end (sidebar → inbox-view → server actions) for the new filter IDs
* [x] Display confidence score + reasoning for drafts that require review (ActionStation + optional conversation list badge)
* [x] Add a backfill script to populate the new auto-send fields for historical drafts/messages (so filters work historically)
* [x] Verify with `npm run lint && npm run build`

## Constraints

- Must run `npm run db:push` after schema changes
- Existing drafts without evaluation data will show as "unprocessed" **until backfill is run**
- Confidence scores only populated for AI_AUTO_SEND campaign drafts (and via backfill for historical rows)
- Filter counts must use efficient SQL (raw queries for performance)
- Auto-send orchestrator uses dependency injection; persistence should not make unit tests require a DB

## Success Criteria

- [x] New fields added to `AIDraft`: `autoSendConfidence`, `autoSendThreshold`, `autoSendReason`, `autoSendAction`, `autoSendEvaluatedAt`, `autoSendSlackNotified`, `slackNotificationChannelId`, `slackNotificationMessageTs`
- [x] "AI Sent" filter shows leads with messages actually sent by AI auto-send (not merely evaluated/scheduled)
- [x] "AI Needs Review" filter shows leads with drafts pending review
- [x] Draft UI surfaces display confidence percentage and reasoning for flagged drafts in ActionStation (and handle null/unprocessed safely)
- [x] Backfill script exists and can populate historical `AIDraft.autoSend*` fields (idempotent + logs)
- [x] `npm run lint` and `npm run build` pass

## Subphase Index

* a — Schema migration (add auto-send tracking fields to AIDraft)
* b — Orchestrator update (persist evaluation data after auto-send decision)
* c — Sidebar filters + query logic (add AI Sent / AI Needs Review filters)
* d — Draft card UI (display confidence + reasoning)
* e — Hardening + plan corrections (counts parity, filter semantics, UI surfaces, tests)
* f — Backfill + Slack review flow hardening (historical population, deep-links, interactive approval safety)

## Key Files

| Component | File |
|-----------|------|
| Prisma schema | `prisma/schema.prisma` |
| Auto-send orchestrator | `lib/auto-send/orchestrator.ts` |
| Persist auto-send decision | `lib/auto-send/record-auto-send-decision.ts` |
| Auto-send outcome/types | `lib/auto-send/types.ts` |
| Delayed auto-send runner | `lib/background-jobs/ai-auto-send-delayed.ts` |
| Sidebar filters | `components/dashboard/sidebar.tsx` |
| Inbox view filter plumbing | `components/dashboard/inbox-view.tsx` |
| Filter counts | `actions/lead-actions.ts` → `getInboxCounts()` |
| Filter queries | `actions/lead-actions.ts` → `getConversationsCursor()` / `getConversationsFromEnd()` |
| Draft display (compose) | `components/dashboard/action-station.tsx` |
| Conversation list item | `components/dashboard/conversation-card.tsx` |
| Pending draft fetch | `actions/message-actions.ts` → `getPendingDrafts()` |
| Orchestrator unit tests | `lib/auto-send/__tests__/orchestrator.test.ts` |
| Backfill script (Phase 70) | `scripts/backfill-ai-auto-send-evaluation-fields.ts` |

## Repo Reality Check (RED TEAM)

- What exists today:
  - `lib/auto-send/orchestrator.ts` is written with dependency injection; DB persistence is performed via `lib/auto-send/record-auto-send-decision.ts` (Prisma-backed) wired into the default executor.
  - `AutoSendOutcome.action` is a union of: `send_immediate | send_delayed | needs_review | skip | error` (`lib/auto-send/types.ts`).
  - `components/dashboard/action-station.tsx` fetches pending drafts via `getPendingDrafts()` and is the primary place users see/approve an AI draft.
  - Inbox filters are wired: sidebar `activeFilter` → `components/dashboard/inbox-view.tsx` → `getConversationsCursor()` (typed union + cast).
  - Inbox counts (`getInboxCounts`) have two paths: lead-rollups raw SQL and a legacy fallback.
- What the plan assumes:
  - Auto-send evaluation metadata will live on `AIDraft` and be queryable from the dashboard without expensive scans.
  - New filter IDs will be accepted everywhere the filter union is referenced (server actions + client casts).
- Verified touch points:
  - `actions/lead-actions.ts`: `getInboxCounts`, `getConversationsCursor`, `getConversationsFromEnd`
  - `components/dashboard/sidebar.tsx`: filter items + count mapping
  - `components/dashboard/inbox-view.tsx`: filter union cast + query key plumbing
  - `components/dashboard/action-station.tsx`: draft fetch/type + compose UI
  - `lib/auto-send/__tests__/orchestrator.test.ts`: DI dependencies (will break if a new dep is added without updating tests)
  - `lib/auto-send/record-auto-send-decision.ts`: persistence helper (must stay idempotent and “no-downgrade”)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- **“AI Sent” semantics drift**: `send_delayed` can mean “scheduled” (message not yet sent) and can be manually overridden; filter/counts can easily become misleading unless the definition is pinned down.
- **Counts/query parity bugs**: `getInboxCounts()` has a rollups path + fallback path; adding counts to only one will cause inconsistent UI and hard-to-debug issues during staged rollouts.
- **Orchestrator persistence mismatch**: the 70b snippet assumes direct `prisma` access inside the orchestrator, but the file is DI-first and unit-tested; a naive change will break tests or couple to DB.
- **Typed filter plumbing breaks build**: new filter IDs must be added in multiple places (`ConversationsCursorOptions.filter` union, `components/dashboard/inbox-view.tsx` casts, and any downstream callers).
- **UI surface mismatch**: the “draft card” users interact with is primarily `components/dashboard/action-station.tsx`; updating only `conversation-card.tsx` will not satisfy “view reasoning for pending review drafts”.

### Missing or ambiguous requirements
- **Needs review lifecycle** — should “AI Needs Review” include drafts that were later approved/rejected, or only `status=pending`?
- **What to persist** — is saving `autoSendSlackNotified` sufficient, or do we need to persist Slack DM status (sent/skipped/error) and/or the final outcome reason for skip/error paths?
- **Slack review UX** — if Slack messages include draft previews / buttons, the dashboard link must resolve to the exact draft to avoid “Slack draft != Dashboard draft” confusion.

### Repo mismatches (fix the plan)
- 70b’s example update uses `prisma.aIDraft.update(...)` directly, but `lib/auto-send/orchestrator.ts` currently has no Prisma dependency — persistence should be injected as a dependency or performed by the caller.
- 70c references an `InboxCounts` interface; the UI uses `FilterCounts` in `components/dashboard/sidebar.tsx` and `getInboxCounts()` has an inline return type.
- 70d references a “Shadcn Tooltip component”, but there is no `components/ui/tooltip.tsx` currently; plan must specify whether to add it or use a simpler fallback (`title`, truncation, etc.).

### Performance / timeouts
- New counts/filters must remain efficient on large datasets (50k+ leads). Prefer indexed lookups and avoid per-lead correlated scans.
- Schema indexes should be chosen to match query shapes (likely need at least `(leadId, autoSendAction)` and possibly `(leadId, status, autoSendAction)` depending on final filters).

### Security / permissions
- All new counts/filters must respect `resolveClientScope` and SETTER restrictions (matching existing behavior).
- If Slack interactive approvals are added, the interactions endpoint must verify Slack signatures and be idempotent (no double-send on retries).

### Testing / validation
- Add/update unit tests for orchestrator persistence behavior (update DI deps + assert “record called” for each action path).
- Smoke test UI: filters appear, counts update, clicking a lead shows review metadata where expected.

## Assumptions (Agent)

- Persisting auto-send evaluation metadata on `AIDraft` is an additive, low-risk schema change (confidence ~95%).
  - Mitigation check: ensure any new columns are nullable so existing rows remain valid.
- Primary “review” UX should live in `components/dashboard/action-station.tsx` where the draft is reviewed/sent (confidence ~90%).
  - Mitigation check: if the intent is to show reasoning directly in the conversation list, we will need to extend `Conversation` types and list query selects.

## Open Questions (Need Human Input)

- [x] “AI Sent” means outbound messages actually sent by AI auto-send (not merely evaluated/scheduled).
- [x] Backfill evaluation metadata + actions for historical drafts/messages (so filters include historical data).
- [x] Confidence/reasoning should be visible in ActionStation (lead view), not on the conversation list cards.
- [x] Slack “Edit in dashboard” should deep-link to the deployed dashboard in the correct workspace (client) and open the exact lead. (answered Jan 30, 2026)
  - Implementation note: include `clientId` + `leadId` (+ `draftId` when applicable) in the Slack URL so the UI selects the correct workspace before loading.
- [x] For the Slack→Dashboard mismatch, deep-link includes `draftId` and ActionStation should prefer that draft when present (vs "first pending"). (answered Jan 30, 2026)

## Phase Summary

### Shipped
- **Schema fields**: Added `slackNotificationChannelId`, `slackNotificationMessageTs` to AIDraft (other auto-send fields from earlier subphases)
- **CLI-safe email sending**: Created `lib/email-send.ts` with system functions that work without Next.js request context
- **Draft mismatch fix**: Backfill script now rejects old pending drafts before generating new ones; always passes `triggerMessageId`
- **Deterministic draft ordering**: Added `orderBy: { createdAt: "desc" }` to aiDrafts queries in lead-actions.ts
- **Slack interactive buttons**: Added "View in Dashboard" and "Approve & Send" buttons to review notifications
- **Slack webhook endpoint**: Created `/api/webhooks/slack/interactions` with signature verification and idempotent approval handling
- **Slack message updates**: Added `updateSlackMessage()` function to update notifications after actions

### Verified
- `npm run lint`: pass (warnings only, pre-existing)
- `npm run build`: pass
- `npm run db:push`: pass (schema in sync)

### Key Files
| Purpose | File |
|---------|------|
| System email functions | `lib/email-send.ts` |
| Slack message updates | `lib/slack-dm.ts` |
| Interactive buttons | `lib/auto-send/orchestrator.ts` |
| Webhook handler | `app/api/webhooks/slack/interactions/route.ts` |
| Slack metadata types | `lib/auto-send/types.ts` |
| Metadata persistence | `lib/auto-send/record-auto-send-decision.ts` |

### Follow-ups
1. Configure Slack App with `SLACK_SIGNING_SECRET` env var and interactivity URL
2. Commit all Phase 70 changes
3. Deploy to production
4. Run backfill script on production data
