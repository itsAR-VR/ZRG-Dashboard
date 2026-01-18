# Phase 32e — Hardening: Channel Pairing, Business-Hours Semantics, Attribution Completeness, Performance + QA

## Focus

Close the gaps identified in the Phase 32 RED TEAM: define business-hours semantics precisely, ensure response-time pairing is channel-safe, ensure `sentByUserId` is populated consistently for user-initiated sends, bound the analytics work for performance, and add concrete validation steps.

## Inputs

- `actions/analytics-actions.ts` (current `calculateAvgResponseTime`, `getAnalytics`, and any new metrics from 32b/32c)
- `components/dashboard/analytics-view.tsx` (KPI cards + per-setter table)
- `prisma/schema.prisma` (Message model fields: `direction`, `sentAt`, `sentBy`, `channel`, `source`, and new `sentByUserId`)
- Existing timezone/business-hours utilities in `lib/followup-engine.ts` (Intl-based and DST-safe)
- Outbound message creation touch points that must set `sentByUserId` for user-initiated sends:
  - SMS: `lib/system-sender.ts` (`sendSmsSystem`)
  - Email: `actions/email-actions.ts` (`sendEmailReply`, `sendEmailReplyForLead`)
  - LinkedIn: `actions/message-actions.ts` (`sendLinkedInMessage`)
- Supabase user lookup helper: `lib/supabase/admin.ts` (`getSupabaseUserEmailById`)

## Work

1. **Lock pairing rules (prevent cross-channel artifacts)**:
   - Pair messages only within the same `Message.channel` (sms/email/linkedin).
   - Document whether `Message.source` should be considered a boundary; default to ignoring `source` unless a concrete mispair case is found.

2. **Lock business-hours rules (America/New_York)**:
   - Confirm whether weekends are excluded (recommended: exclude Sat/Sun).
   - Confirm business-hours arithmetic for boundary-crossing pairs:
     - Option A: exclude any pair where either timestamp is outside business hours
     - Option B (recommended): compute **elapsed business-hours time** between timestamps (clip/roll-forward across days)
   - Implement chosen behavior in a reusable helper (prefer extracting/reusing the Intl + timezone helpers from `lib/followup-engine.ts`).
   - Add at least 2–3 explicit examples in comments (e.g., 4:50pm → 9:10am next day).

3. **Ensure `sentByUserId` attribution completeness**:
   - Record `sentByUserId` for authenticated, user-initiated outbound sends across SMS/email/LinkedIn.
   - Keep `sentByUserId` null for system/AI sends (auto-replies, cron/followups, webhook-driven sends).
   - Make the propagation explicit in function signatures (e.g., extend `SystemSendMeta` and email send opts to accept `sentByUserId?: string | null`).
   - Decide and document what to do for historical rows (recommended: treat as “Unattributed” and exclude from per-setter rollups unless explicitly bucketed).

4. **Bound analytics work for performance**:
   - Choose a default reporting window (recommended: last 30 days) and apply consistently to:
     - overall setter response time
     - overall client response time
     - per-setter breakdown
   - Ensure Prisma selects are minimal (only fields required for pairing).
   - Consider adding/adjusting indexes to match query patterns (e.g., `@@index([sentByUserId, sentAt(sort: Desc)])` and/or channel-aware indexes if needed).

5. **Validation (must run before calling Phase 32 “done”)**:
   - `npm run lint`
   - `npm run build`
   - If `prisma/schema.prisma` changed: `npm run db:push`
   - Manual smoke test:
     - Send SMS/email/LinkedIn from the UI as a setter; verify the created outbound `Message` row has `sentByUserId` populated.
     - Confirm analytics renders the new KPIs and per-setter table without errors.
     - Spot-check at least one lead with multi-channel messages to confirm no cross-channel pairing artifacts.

## Output

**Business-hours utilities (`lib/business-hours.ts`):**
- `isWithinEstBusinessHours(date: Date): boolean` - Checks if date is 9am-5pm EST, weekdays only
- `areBothWithinEstBusinessHours(timestamp1: Date, timestamp2: Date): boolean` - Checks both timestamps
- `formatDurationMs(ms: number): string` - Formats milliseconds to "15m", "2.4h", "1.5d"
- Uses `Intl.DateTimeFormat` for proper DST handling in America/New_York timezone
- Weekends (Saturday/Sunday) are excluded

**Pairing rules (implemented in `calculateResponseTimeMetrics`):**
- Messages paired only within the same `channel` (sms/email/linkedin)
- Only pairs where BOTH timestamps are within business hours are counted
- Response times capped at 7 days to avoid outliers
- 30-day rolling window for performance

**Attribution completeness:**
- `sentByUserId` populated for all user-initiated sends:
  - SMS: `lib/system-sender.ts` → `sendSmsSystem`
  - Email: `actions/email-actions.ts` → `sendEmailReply`, `sendEmailReplyForLead`
  - LinkedIn: `actions/message-actions.ts` → `sendLinkedInMessage`
  - All approve/send draft actions in `actions/message-actions.ts`
- `sentByUserId` remains null for system/AI sends (auto-replies, cron/followups)
- Historical rows without `sentByUserId` excluded from per-setter rollups

**Performance bounds:**
- 30-day rolling window applied to all response time queries
- Index added: `@@index([sentByUserId])` on Message model
- Prisma queries select only required fields for pairing

**Validation completed:**
- `npm run lint` ✅ (0 errors, 17 pre-existing warnings)
- `npm run build` ✅ (succeeds)
- `npm run db:push` ✅ (schema applied in 32a)

## Handoff

Phase 32 complete. All objectives achieved:
1. ✅ `sentByUserId` field added to Message model
2. ✅ Business hours filtering (9am-5pm EST, weekdays) implemented
3. ✅ Setter response times separated from client response times
4. ✅ Per-setter response time aggregation created
5. ✅ Analytics UI updated with new KPI cards and per-setter table

If stakeholders want deeper analysis next, consider a follow-on phase for per-channel response-time breakdown (SMS vs Email vs LinkedIn) and/or workspace-timezone business-hours support.
