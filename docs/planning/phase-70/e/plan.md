# Phase 70e — Hardening + Plan Corrections (Counts Parity, Filter Semantics, UI Surfaces, Tests)

## Focus

Close RED TEAM gaps discovered during plan review:

- lock down what “AI Sent” means (scheduled vs actually sent)
- ensure counts and filter queries are consistent across all code paths
- update the actual UI surfaces users interact with (ActionStation) for confidence/reason visibility
- keep the auto-send orchestrator testable (DI-friendly persistence)

## Inputs

- 70a–70d plans (schema/orchestrator/filters/UI)
- `actions/lead-actions.ts` (`getInboxCounts`, `getConversationsCursor`, `getConversationsFromEnd`)
- `components/dashboard/sidebar.tsx` + `components/dashboard/inbox-view.tsx`
- `components/dashboard/action-station.tsx` (draft review UX)
- `lib/auto-send/orchestrator.ts` + `lib/auto-send/types.ts` + `lib/auto-send/__tests__/orchestrator.test.ts`

## Work

### 1) Pin down “AI Sent” semantics (must decide before implementing)

Choose one and document it in Phase 70 root plan:

- Option A (recommended): **AI Sent = outbound message was actually sent by AI**
  - Implementation approach:
    - filter/count by existence of an outbound `Message` with `sentBy='ai'` whose `aiDraft.autoSendAction` is `send_immediate|send_delayed`
- Option B: **AI Sent = evaluation outcome was “send” (including scheduled delayed sends)**
  - Implementation approach:
    - filter/count by `AIDraft.autoSendAction in ('send_immediate','send_delayed')` regardless of whether a `Message` exists yet

### 2) Orchestrator persistence design correction (keep DI + tests clean)

- Do not directly import Prisma into `lib/auto-send/orchestrator.ts` unless the team accepts coupling.
- Preferred: extend `AutoSendDependencies` with a single persistence function, e.g.
  - `recordAutoSendDecision({ draftId, evaluatedAt, confidence, threshold, reason, action, slackDm? })`
- Ensure all exit paths record:
  - `skip` paths where evaluation never runs (reason should still be recorded in a consistent field if required)
  - `needs_review` paths include Slack DM outcome (if we decide to persist it)
  - `send_delayed` records the fact it was scheduled (and optionally the `runAt`, if we decide to persist it)

### 3) Inbox counts parity (rollups query + legacy fallback)

- Add two new counts: `aiSent`, `aiReview`.
- Update both `runCountsUsingLeadRollups()` and `runLegacyCounts()` so behavior matches regardless of staged rollouts.
- Ensure all existing scope filters apply:
  - `clientId in scope.clientIds`
  - snooze filter (`snoozedUntil`)
  - SETTER restriction (`assignedToUserId`) when applicable
- Query definitions:
  - `aiReview`: leads with at least one pending draft with `autoSendAction='needs_review'`
  - `aiSent`: follow the chosen semantic from step (1)

### 4) Filter union + query plumbing (cursor + from-end)

- Update the typed filter union in `actions/lead-actions.ts`:
  - `ConversationsCursorOptions.filter` must include `ai_sent` and `ai_review`.
- Add filter logic in BOTH:
  - `getConversationsCursor()`
  - `getConversationsFromEnd()`
- Update client-side filter casts/usages:
  - `components/dashboard/inbox-view.tsx` (the `activeFilter as ...` union cast)

### 5) UI surfaces (sidebar + ActionStation + optional list badge)

- Sidebar:
  - extend `FilterCounts` to include `aiSent` + `aiReview`
  - add filter items with distinct icons and badge counts
- ActionStation (recommended primary UX):
  - extend the local `AIDraft` type to include the new persisted fields
  - display a compact banner when `autoSendAction === 'needs_review'` showing:
    - confidence % vs threshold
    - `autoSendReason` (truncate; show full text via a safe UI pattern)
  - If we want tooltips, first confirm a tooltip component exists; otherwise use `title` / expandable text
- Conversation list badge (optional):
  - if desired, add a small “Needs Review” indicator on `components/dashboard/conversation-card.tsx`
  - this requires extending the `Conversation` type and list query selects (explicitly call this out if chosen)

### 6) Tests + validation

- Update `lib/auto-send/__tests__/orchestrator.test.ts` to provide the new DI dependency and assert it was called for:
  - `send_immediate`, `send_delayed`, `needs_review`, `skip`, `error`
- Run:
  - `npm run lint`
  - `npm run build`
- Manual smoke:
  - sidebar shows new filters + counts
  - “AI Needs Review” filter returns leads; opening a lead shows confidence/reason in ActionStation
  - “AI Sent” filter matches the chosen definition

## Output

- Phase 70 plan is fully specified (semantics locked, repo-mismatches corrected)
- Implementation-ready checklist that won’t break type unions, counts parity, or orchestrator unit tests

## Handoff

- After implementing Phase 70e, re-run the Phase 70 Success Criteria and update Phase 70 root plan with:
  - final semantic definitions (“AI Sent”/“AI Needs Review”)
  - any schema fields added beyond the initial draft
