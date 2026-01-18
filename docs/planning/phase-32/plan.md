# Phase 32 — Response Time Analytics (Setter vs Client, Business Hours, Per-Setter Breakdown)

## Purpose

Implement granular response time tracking that separates setter response times from client response times, filters to business hours (9am-5pm EST), and provides per-setter breakdowns for performance visibility.

## Context

The previous `calculateAvgResponseTime` function in `actions/analytics-actions.ts` computed a single aggregate response time for all inbound→outbound message pairs (now replaced by `calculateResponseTimeMetrics`). This had several limitations:

1. **Mixed metrics** - It conflates how fast setters respond to clients with how fast clients respond to us
2. **No business hours filtering** - Includes overnight/weekend delays that skew averages
3. **No per-setter attribution** - Cannot identify which setters are faster/slower

The user has identified these specific requirements:
- **Setter response time**: Time from when a client sends a message to when we (setter) reply
- **Client response time**: Time from when we send a message to when the client replies back
- **9am-5pm EST only**: Exclude messages outside business hours to avoid skewing averages
- **Per-setter breakdown**: Track response times per setter account (ClientMember with SETTER role)

Key data model observations:
- `Message.sentBy` field exists but only tracks 'ai' | 'setter' (not which specific setter)
- `Message.sentByUserId` exists for per-setter attribution (setter Supabase Auth user ID)
- `Message.sentAt` provides accurate timestamps
- `Message.channel` and `Message.source` exist — response-time pairing must avoid cross-channel mismatches
- `WorkspaceSettings.timezone`, `workStartTime`, `workEndTime` exist; this phase intentionally uses fixed business hours in America/New_York
- `ClientMember` model has SETTER role but no direct link to Message

## Objectives

* [x] Add `sentByUserId` field to Message model for setter attribution
* [x] Implement business hours filtering (9am-5pm EST) for response time calculations
* [x] Separate setter response times from client response times
* [x] Create per-setter response time aggregation
* [x] Update analytics UI to display new response time metrics

## Constraints

- Must maintain backward compatibility with existing `avgResponseTime` display
- Business hours are fixed at 9am-5pm EST (America/New_York) per requirements
- Per-setter tracking only applies to setters (ClientMember.role = SETTER)
- Should not impact webhook ingestion performance
- Response time calculations should remain efficient (avoid N+1 queries)

## Success Criteria

- [x] Analytics tab shows two separate response time cards ("Setter Response" and "Client Response").
- [x] Both metrics only include messages within 9am-5pm ET business hours (weekdays).
- [x] A per-setter breakdown table shows individual setter response times.
- [x] Existing functionality continues to work for workspaces without setter accounts.

## Decisions / Clarifications (RED TEAM)

- Business hours: confirm whether weekends are excluded (recommended: exclude Sat/Sun).
- Business-hours semantics: confirm whether to **exclude** pairs with timestamps outside 9am–5pm ET, or to **count only elapsed business-hours time** for pairs that cross boundaries (recommended; example: inbound 4:50pm ET → reply 9:10am ET next day should count as ~20m, not ~16h, and should not be dropped).
- Pairing: confirm response times are computed **within the same `channel`** (recommended) to avoid cross-channel pair artifacts for multi-channel leads.
- Reporting window: confirm whether to compute over all time or a bounded window (recommended: last 30 days, or configurable).
- “Client response time”: confirm whether it includes replies to AI/campaign outbound messages or only human-sent outbound messages.

## Subphase Index

* a — Schema update: Add sentByUserId to Message
* b — Response time calculation with business hours filtering
* c — Per-setter aggregation logic
* d — Analytics UI updates
* e — Hardening: channel pairing, business-hours semantics, attribution completeness, performance + QA

## Repo Reality Check (RED TEAM)

- What exists today:
  - `actions/analytics-actions.ts` defines `calculateResponseTimeMetrics()` and returns `AnalyticsData.overview` response time fields (`avgResponseTime`, `setterResponseTime`, `clientResponseTime`).
  - `components/dashboard/analytics-view.tsx` renders the KPI cards from `AnalyticsData.overview.*`.
  - `prisma/schema.prisma` `Message` includes: `direction`, `sentAt`, `sentBy`, `sentByUserId`, `channel`, `source`.
  - Outbound message creates are spread across multiple touch points:
    - SMS: `lib/system-sender.ts` (`sendSmsSystem`) creates outbound SMS `Message` rows.
    - Email: `actions/email-actions.ts` (`sendEmailReply`, `sendEmailReplyForLead`) creates outbound Email `Message` rows.
    - LinkedIn: `actions/message-actions.ts` (`sendLinkedInMessage`) creates outbound LinkedIn `Message` rows.
  - Supabase user lookup helper exists: `lib/supabase/admin.ts` (`getSupabaseUserEmailById`).
  - Business-hours helper exists: `lib/business-hours.ts` (fixed America/New_York, weekdays, 9am–5pm).
  - Existing business-hours + timezone utilities exist in `lib/followup-engine.ts` (Intl-based, DST-safe).
- Verified touch points:
  - KPI consumer: `components/dashboard/analytics-view.tsx` → `data.overview.setterResponseTime` / `data.overview.clientResponseTime`
  - Analytics producer: `actions/analytics-actions.ts` → `calculateResponseTimeMetrics()`
  - UI-sent messages: `actions/message-actions.ts` (`sendMessage`, `sendEmailMessage`, `sendLinkedInMessage`, `approveAndSendDraft*`)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Cross-channel message ordering causes incorrect “response pairs” (e.g., SMS inbound paired to Email outbound) → bogus averages.
- “Both timestamps must be within business hours” filtering can drop most real-world replies (overnights/weekends) → tiny sample sizes and misleadingly low averages.
- `sentByUserId` is only planned for `actions/message-actions.ts`, but many outbound `Message` rows are created elsewhere → per-setter table becomes incomplete/empty.

### Missing or ambiguous requirements
- Weekend handling is unspecified (business hours normally implies weekdays).
- Business-hours arithmetic is underspecified for boundary-crossing pairs (drop vs clip vs roll-forward).
- Whether response times should be cross-channel aggregate vs per-channel (at minimum: pair within channel).
- Time window is unspecified (all-time averages can be very slow and very stale).
- Whether “client response time” includes responses to AI/campaign messages.

### Repo mismatches (fix the plan)
- Update file references:
  - `analytics-actions.ts` → `actions/analytics-actions.ts`
  - `analytics-view.tsx` → `components/dashboard/analytics-view.tsx`
- Prefer reusing/extracting existing timezone/business-hour helpers from `lib/followup-engine.ts` instead of inventing a new approach.

### Performance / timeouts
- Current approach loads all leads + all messages and loops in JS; this can become expensive. Add a bounded window (e.g., last 30 days) and consider indexes like `@@index([sentByUserId, sentAt])`.
- Supabase admin lookups should be batched and limited to the small set of unique userIds shown in the per-setter table.

### Security / permissions
- Ensure `sentByUserId` is only set in authenticated, user-initiated sends; keep it null for system/AI sends to avoid attributing automation to humans.
- Keep per-setter analytics scoped to the caller’s accessible workspace(s) (use existing `resolveClientScope()` pattern).

### Testing / validation
- Add explicit validation steps to the plan:
  - `npm run lint` + `npm run build`
  - If schema changes: `npm run db:push`
  - Manual QA: send SMS/email/LinkedIn as a setter and verify the created `Message` row has `sentByUserId` populated; verify analytics UI renders without errors.

## Phase Summary

- Shipped:
  - `Message.sentByUserId` (nullable) + index for per-setter attribution (`prisma/schema.prisma`)
  - Business-hours utilities for ET weekdays 9am–5pm + duration formatter (`lib/business-hours.ts`)
  - Separate setter/client response time analytics + per-setter breakdown (`actions/analytics-actions.ts`)
  - UI KPI split + per-setter table (`components/dashboard/analytics-view.tsx`)
  - `sentByUserId` propagation for UI-initiated sends across SMS/email/LinkedIn (`lib/system-sender.ts`, `actions/email-actions.ts`, `actions/message-actions.ts`)
- Verified:
  - `npm run lint`: pass (0 errors, 17 warnings) — `2026-01-17`
  - `npm run build`: pass — `2026-01-17`
  - `npm run db:push`: pass (“already in sync”) — `2026-01-17`
- Notes:
  - Business-hours filtering is strict (both timestamps must be within business hours) and excludes weekends; sample sizes may be small for some workspaces.
