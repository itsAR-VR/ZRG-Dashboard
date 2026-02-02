# Phase 89e — Follow-ups (Alerts + Assignment Audit Log + Runbook)

## Focus
Execute the Phase 89 review follow-ups by adding admin-facing alerts when the round-robin sequence filters to empty, persisting an assignment audit trail per lead, and documenting the Founders Club production configuration/monitoring steps.

## Inputs
- Phase 89 review follow-ups (`docs/planning/phase-89/review.md`)
- Round-robin assignment logic: `lib/lead-assignment.ts`
- Slack notification utilities: `lib/slack-bot.ts`, `lib/slack-notifications.ts`
- Notification dedupe table: `NotificationSendLog` in `prisma/schema.prisma`

## Work
1. **Schema: add assignment audit log model**
   - Add `LeadAssignmentEvent` model in `prisma/schema.prisma` with:
     - `clientId`, `leadId`, `assignedToUserId`, `source`, `channel`, `createdAt`
     - Relations to `Client` and `Lead`
     - Indexes on `clientId + createdAt`, `leadId + createdAt`, and `assignedToUserId`
   - Add relation fields:
     - `Lead.assignmentEvents` (array)
     - `Client.leadAssignmentEvents` (array)
2. **Record assignment events**
   - In `lib/lead-assignment.ts`, record an event when assignment succeeds:
     - `source`: `"round_robin"` (or `"backfill"` when called from `backfillLeadAssignments`)
     - `channel`: `"email" | "sms" | "linkedin"` (pass through)
   - Ensure failures to write the audit event do **not** prevent assignment; log and continue.
3. **Admin notification when sequence filters to empty**
   - When `effectiveSequence.length === 0`, send a Slack alert to the workspace’s configured notification channels (if Slack is configured).
   - Dedupe using `NotificationSendLog` with `kind = "round_robin_sequence_empty"` and daily key (`YYYY-MM-DD`) so alerts fire at most once per day per workspace per destination.
   - Message should include workspace name, configured sequence length, active setter count, and lead id/name if available.
4. **Runbook for production config + monitoring**
   - Add `docs/notes/founders-club-round-robin.md` with:
     - Founders Club configuration steps (setters + sequence + toggles)
     - Monitoring steps (what log lines to watch; Slack alert behavior)
     - Rollback steps (clear sequence, disable email-only)
5. **Validation**
   - If schema changed: `npm run db:push`
   - `npm run test`, `npm run lint`, `npm run build`

## Output
- Added `LeadAssignmentEvent` model + relations:
  - `Client.leadAssignmentEvents`
  - `Lead.assignmentEvents`
- `lib/lead-assignment.ts` now:
  - Records assignment events on successful assignment (source = `round_robin` or `backfill`)
  - Sends deduped Slack alert when configured sequence filters to empty
- Runbook created: `docs/notes/founders-club-round-robin.md`

## Validation
- `npm run db:push` ✅
- `npm run test` ✅
- `npm run lint` ✅ (warnings only, pre-existing)
- `npm run build` ✅

## Handoff
Phase 89e complete; root plan updated with follow-up summary.
