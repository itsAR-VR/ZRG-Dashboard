# Phase 18e — Cron Booked Summaries + Validation Checklist

## Focus
Add background computation of booked-meeting lead summaries and verify the end-to-end system.

## Inputs
- Phase 18b lead-level Conversation Insight model
- Phase 18c per-thread extractor

## Work
- Add cron endpoint (protected by `CRON_SECRET`) that:
  - scans for newly booked leads without a cached Conversation Insight
  - runs per-thread extraction and stores the lead-level summary
  - runs every ~10 minutes
- Update `vercel.json` schedules accordingly

## Output
- Added cron endpoint:
  - `app/api/cron/insights/booked-summaries/route.ts`
  - Scans for `Lead.appointmentBookedAt != null` with no `LeadConversationInsight` and computes only when provider-aware `isMeetingBooked()` is true
  - Uses workspace insights model/effort settings (defaults to `gpt-5-mini` + `medium`)
- Scheduled the cron in `vercel.json` to run every 10 minutes:
  - `/api/cron/insights/booked-summaries`

## Handoff
Ready for deployment + iterative UX tuning; v2 can enable action tools behind toggles.

