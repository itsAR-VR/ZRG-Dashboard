# Phase 57a — Log Triage + Threat Model

## Focus
Turn `logs_result.json` into a concrete error taxonomy and root-cause hypothesis set, then identify where failures amplify (cron cadence, retry loops, provider traffic, PII risk) so fixes are targeted and safe.

## Inputs
- `logs_result.json`
- `app/api/cron/appointment-reconcile/route.ts`
- `lib/appointment-reconcile-runner.ts`
- `lib/ghl-appointment-reconcile.ts`
- `lib/ghl-api.ts`
- `app/api/cron/insights/booked-summaries/route.ts`
- `lib/insights-chat/thread-extractor.ts`

## Work
1. ✅ Validate log coverage:
   - Confirmed time range: 2026-01-25 09:05:25–09:20:46 UTC (≈15 minutes)
   - Export is capped at 1000 records (Vercel default)
   - All 1000 records are from cron paths
2. ✅ Build taxonomy:
   - Grouped by `requestPath` + normalized log prefix
   - Results captured in `docs/planning/phase-57/taxonomy.md`
   - Dominant signature: 919× `[Appointment Upsert] Missing ghlAppointmentId`
   - Secondary: 1× `[Insights Cron] ... schema violation ... agent_response too_big`
3. ✅ Red Team: failure amplification + worst cases
   - Cron `* * * * *` + no watermark advancement on error ⇒ ~919 retries in 15 min
   - Provider response-shape mismatch confirmed: `getGHLAppointment()` returns raw `ghlRequest<GHLAppointment>` with no normalization
   - Logs verified: no PII leaked (only UUIDs and appointment IDs)
4. ✅ Blue Team: containment decision
   - **Primary fix:** Add response normalization in `getGHLAppointment()` + advance watermark even on error
   - **Secondary containment:** Add circuit breaker in Phase 57d

## Output
- ✅ `docs/planning/phase-57/taxonomy.md` — Error taxonomy with counts and signatures
- ✅ Root cause confirmed: `lib/ghl-api.ts:getGHLAppointment()` returns raw response without normalizing ID field variants
- ✅ Amplification root cause: `lib/ghl-appointment-reconcile.ts:reconcileGHLAppointmentById()` throws before updating `appointmentLastCheckedAt`
- ✅ Containment decision: Fix normalization (Phase 57b) + add circuit breaker (Phase 57d)

## Handoff
**Proceed to Phase 57b** to implement:
1. GHL response normalization helper in `lib/ghl-api.ts`
2. Watermark advancement even on error in `lib/ghl-appointment-reconcile.ts`
3. Unit tests for response variants in `lib/__tests__/ghl-appointment-response.test.ts`
