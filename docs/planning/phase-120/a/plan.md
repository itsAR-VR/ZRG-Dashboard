# Phase 120a — Server Action + SQL + Tests

## Focus
Create a new server action that returns booking conversion metrics attributable to AI draft sends, with stable windowing and clear outcome semantics.

## Inputs
- Root plan: `docs/planning/phase-120/plan.md`
- Existing outcomes action (send-time anchored): `actions/ai-draft-response-analytics-actions.ts`
- Booking evidence fields: `prisma/schema.prisma` (`Lead.appointmentBookedAt`, `ghlAppointmentId`, Calendly URIs)
- Existing “meeting booked” semantics helper (reference only): `lib/meeting-booking-provider.ts`

## Work
1. Add new export to `actions/ai-draft-response-analytics-actions.ts`:
   - `getAiDraftBookingConversionStats({ clientId?, from?, to?, attributionWindowDays=30, maturityBufferDays=7 })`
   - Reuse existing `resolveClientScope`, `resolveWindow`, and `Prisma.sql`/`Prisma.join` patterns from `getAiDraftResponseOutcomeStats` (same file, lines 38-134).
   - Return type: `{ success, data?: AiDraftBookingConversionStats, error? }` with `byChannelDisposition` keyed by `"{channel}-{disposition}"` → `{ booked, notBooked, bookedNoTimestamp, pending, eligible, bookingRate }`.
2. Derive draft send-time using the existing CTE pattern (reuse lines 64-74 verbatim):
   - `draft_send_time` CTE: `min(Message.sentAt)` for outbound messages associated with the draft.
   - **Two-layer time windowing (RED TEAM):** The query has TWO independent time dimensions:
     - **Layer 1 — UI date range:** `dst."sentAt" >= ${from} AND dst."sentAt" < ${to}` (which drafts to analyze)
     - **Layer 2 — Attribution window:** `l."appointmentBookedAt" > dst."sentAt" AND l."appointmentBookedAt" <= dst."sentAt" + interval '${attributionWindowDays} days'` (which bookings count as attributed)
     - These are separate WHERE/CASE conditions, not combined into one filter.
3. Define conversion outcomes per (lead, draft bucket) using CASE logic:
   - Exclude pre-booked: `l."appointmentBookedAt" IS NOT NULL AND l."appointmentBookedAt" <= dst."sentAt"` → skip row entirely (or filter out in WHERE)
   - `PENDING`: `dst."sentAt" > ${to}::timestamp - interval '${maturityBufferDays} days'` → draft is too recent to judge
   - `BOOKED`: `l."appointmentBookedAt" > dst."sentAt" AND l."appointmentBookedAt" <= LEAST(${to}::timestamp, dst."sentAt" + interval '${attributionWindowDays} days')`
   - `BOOKED_NO_TIMESTAMP` **(RED TEAM — explicit SQL):** `l."appointmentBookedAt" IS NULL AND (l."ghlAppointmentId" IS NOT NULL OR l."calendlyInviteeUri" IS NOT NULL OR l."calendlyScheduledEventUri" IS NOT NULL)`
   - `NOT_BOOKED`: otherwise (no booking evidence, or booking outside attribution window)
4. Aggregate by:
   - `AIDraft.channel` (email/sms/linkedin)
   - `AIDraft.responseDisposition` (AUTO_SENT/APPROVED/EDITED only; filter `d."responseDisposition" IS NOT NULL`)
   - outcome bucket above
   - **Count `distinct l.id` (RED TEAM — not `distinct d.id`):** A single lead may have multiple AI drafts across campaign waves. Counting drafts would inflate booking rates. The existing outcomes query counts drafts because it measures draft volume; the booking conversion query measures lead outcomes.
5. Apply email-only filter consistent with existing outcomes (line 88):
   - `d.channel != 'email' OR ec."responseMode" = 'AI_AUTO_SEND'`
   - Use same `LEFT JOIN "EmailCampaign" ec ON ec.id = l."emailCampaignId"` pattern.
6. Statement timeout: `SET LOCAL statement_timeout = 10000` (match existing 10s budget).
7. Add a lightweight regression test:
   - New: `lib/__tests__/ai-draft-booking-conversion-windowing.test.ts`
   - Use `node:test` + `node:assert/strict` framework (match existing `analytics-windowing-stable.test.ts` pattern).
   - Assertions:
     - Source contains `draft_send_time` CTE and windows on `dst."sentAt"`
     - Source references `appointmentBookedAt` comparisons relative to derived send-time
     - Source includes pending buffer semantics (7-day or `maturityBufferDays`)
     - **(RED TEAM)** Source does NOT contain `d."updatedAt" >=` (same anti-pattern guard as existing windowing test)
     - Source contains `distinct l.id` or `distinct l."id"` (lead deduplication guard)

## Output
- Added server action + types for booking conversion analytics:
  - `actions/ai-draft-response-analytics-actions.ts` (`getAiDraftBookingConversionStats`, `AiDraftBookingConversionStats`)
- Added regression test + wired into test runner:
  - `lib/__tests__/ai-draft-booking-conversion-windowing.test.ts`
  - `scripts/test-orchestrator.ts`

## Handoff
Phase 120b: render the new `AiDraftBookingConversionStats` data in `components/dashboard/analytics-view.tsx` as a table card.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented `getAiDraftBookingConversionStats` with send-time anchoring (`draft_send_time`) and lead-level bucketing.
  - Added a regression test to prevent window drift and enforce lead-level dedupe.
  - Wired the new test into `npm test` via `scripts/test-orchestrator.ts`.
- Commands run:
  - `node --import tsx --test lib/__tests__/ai-draft-booking-conversion-windowing.test.ts` — pass
- Blockers:
  - None.
- Next concrete steps:
  - Implement Phase 120b UI card (consume the new action in Analytics view).
