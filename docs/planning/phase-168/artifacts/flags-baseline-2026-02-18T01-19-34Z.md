# Phase 168 Flags Baseline — 2026-02-18T01-19-34Z

## Scope
Vercel project: `zrg-dashboard` (org `zrg`)

## Decisions Applied
- `INBOXXIA_EMAIL_SENT_ASYNC` locked to `true` for Phase 168 production windows.
- Window policy for comparisons: nearest contiguous 30-minute fallback allowed with explicit deviation notes.
- Break-glass cron throttling: only with explicit incident note.

## Applied / Verified Variables

### Production
- `BACKGROUND_JOBS_USE_INNGEST`
- `BACKGROUND_JOBS_INLINE_EMERGENCY_FALLBACK`
- `BACKGROUND_JOBS_FORCE_INLINE`
- `INBOXXIA_EMAIL_SENT_ASYNC`
- `CRON_RESPONSE_TIMING_USE_INNGEST`
- `CRON_APPOINTMENT_RECONCILE_USE_INNGEST`
- `CRON_FOLLOWUPS_USE_INNGEST`
- `CRON_AVAILABILITY_USE_INNGEST`
- `CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST`
- `INNGEST_SIGNING_KEY` (added from Preview value at `2026-02-18 01:22Z` during this phase)
- `INNGEST_EVENT_KEY` (pre-existing)
- `CRON_SECRET` (pre-existing)
- `NEXT_PUBLIC_APP_URL` (pre-existing)

### Preview
- `BACKGROUND_JOBS_USE_INNGEST`
- `BACKGROUND_JOBS_INLINE_EMERGENCY_FALLBACK`
- `BACKGROUND_JOBS_FORCE_INLINE`
- `CRON_RESPONSE_TIMING_USE_INNGEST`
- `CRON_APPOINTMENT_RECONCILE_USE_INNGEST`
- `CRON_FOLLOWUPS_USE_INNGEST`
- `CRON_AVAILABILITY_USE_INNGEST`
- `CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST`
- `INNGEST_EVENT_KEY` (pre-existing)
- `INNGEST_SIGNING_KEY` (pre-existing)
- `CRON_SECRET` (pre-existing)
- `NEXT_PUBLIC_APP_URL` (pre-existing)

### Development
- `BACKGROUND_JOBS_USE_INNGEST`
- `BACKGROUND_JOBS_INLINE_EMERGENCY_FALLBACK`
- `BACKGROUND_JOBS_FORCE_INLINE`
- `CRON_RESPONSE_TIMING_USE_INNGEST`
- `CRON_APPOINTMENT_RECONCILE_USE_INNGEST`
- `CRON_FOLLOWUPS_USE_INNGEST`
- `CRON_AVAILABILITY_USE_INNGEST`
- `CRON_EMAILBISON_AVAILABILITY_SLOT_USE_INNGEST`
- `CRON_SECRET` (pre-existing)
- `NEXT_PUBLIC_APP_URL` (pre-existing)

## Commands Used
```bash
vercel env update <name> <environment> -y
vercel env add <name> <environment>
vercel env pull /tmp/... --environment preview
vercel env ls production --no-color | rg "..."
vercel env ls preview --no-color | rg "..."
vercel env ls development --no-color | rg "..."
```
