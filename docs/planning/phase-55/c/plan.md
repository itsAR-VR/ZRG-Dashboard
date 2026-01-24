# Phase 55c — Verification, Rollout, and Monitoring

## Focus
Provide a clear way to validate correctness and safely roll out the cron-based JIT injection.

## Inputs
- Phase 55b implementation.
- Existing logging/telemetry patterns for cron endpoints.

## Work
- Verification runbook:
  - How to run the cron endpoint in `dryRun=true` mode and interpret counters.
  - How to validate one lead end-to-end (provider variable updated + DB offeredSlots persisted).
  - How to confirm downstream auto-book behavior on acceptance of offered slots.
- Monitoring/alerts:
  - Log fields to include for failures (workspace id, campaign id, lead id, HTTP status).
  - Suggested guardrails (time budget hit rate, errors per run).
- Rollout notes:
  - Ensure `CRON_SECRET` and EmailBison credentials are configured per workspace.
  - Ensure campaigns exist/synced in DB or specify a fallback approach.

## Output
- A short verification checklist for ops and engineering.

## Handoff
If Phase 52 work proceeds, link this runbook back into the broader "5 booking processes" verification matrix.

---

## RED TEAM Status: PENDING VERIFICATION ⚠️

### Verification Runbook

#### 1. Dry Run Test

```bash
# Local (requires CRON_SECRET in .env.local)
curl -X GET "http://localhost:3000/api/cron/emailbison/availability-slot?dryRun=true" \
  -H "Authorization: Bearer $CRON_SECRET"

# Production (replace with actual secret)
curl -X GET "https://your-domain.vercel.app/api/cron/emailbison/availability-slot?dryRun=true" \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Expected response:**
```json
{
  "success": true,
  "clientsScanned": N,
  "campaignsScanned": N,
  "leadsScanned": N,
  "leadsFirstTouch": N,
  "leadsScheduledWithin24h": N,
  "leadsDueWithin15m": N,
  "leadsUpdated": N,        // Should be 0 in dryRun
  "leadsSkippedAlreadySet": N,
  "errors": N,
  "finishedWithinBudget": true,
  "timestamp": "..."
}
```

**Interpret counters:**
- `clientsScanned > 0` → EmailBison workspaces exist
- `leadsFirstTouch > 0` → First-touch leads detected
- `leadsScheduledWithin24h > 0` → Leads with upcoming sends
- `leadsDueWithin15m > 0` → Leads ready for injection
- `errors = 0` → No API failures
- `finishedWithinBudget = true` → Completed within time budget

#### 2. Single Lead End-to-End Validation

**Prerequisites:**
1. Workspace with `emailProvider: "EMAILBISON"` and valid API key
2. Campaign with a lead that has `emails_sent = 0` and scheduled send within 15 minutes

**Steps:**
1. Run cron with `dryRun=false` (or wait for scheduled run)
2. Check EmailBison lead:
   ```bash
   # Via EmailBison API
   curl -X GET "https://send.meetinboxxia.com/api/leads/{leadId}" \
     -H "Authorization: Bearer {apiKey}"
   ```
   - Verify `custom_variables` contains `availability_slot`
   - Verify sentence format: `"does {time1} or {time2} work for you?"`

3. Check DB `Lead.offeredSlots`:
   ```sql
   SELECT id, "offeredSlots" FROM "Lead"
   WHERE "emailBisonLeadId" = '{leadId}' AND "clientId" = '{clientId}';
   ```
   - Verify JSON contains `datetime`, `label`, `offeredAt` for each slot

4. Check `WorkspaceOfferedSlot` ledger:
   ```sql
   SELECT * FROM "WorkspaceOfferedSlot"
   WHERE "clientId" = '{clientId}'
   ORDER BY "slotUtc" ASC;
   ```
   - Verify `offeredCount` incremented for the selected slots

#### 3. Downstream Auto-Book Verification

**Test scenario:** Lead replies accepting one of the offered times.

1. Simulate inbound message: "Yes, 2pm on Monday works"
2. Verify `lib/followup-engine.ts:processMessageForAutoBooking()` detects acceptance
3. Verify booking created via `bookMeetingForLead()`
4. Check `Lead.appointmentBookedAt` is set

### Monitoring Checklist

**Log fields to monitor:**
- `[EmailBison FirstTouch]` prefix in logs
- `clientId`, `leadId` on errors
- `error` field on patch failures

**Guardrails:**
- [ ] `errors / leadsScanned < 10%` — Acceptable error rate
- [ ] `finishedWithinBudget = true` consistently — No timeout issues
- [ ] `leadsUpdated` growing day-over-day — System is working

**Alerts to configure:**
- Alert if `errors > 50` in a single run
- Alert if `finishedWithinBudget = false` for 3+ consecutive runs
- Alert if `leadsUpdated = 0` for 1+ hours during business hours

### Rollout Checklist

- [ ] **CRON_SECRET** configured in Vercel environment variables
- [ ] **EmailBison API keys** configured per workspace (`Client.emailBisonApiKey`)
- [ ] **EmailBison base host** configured if not default (`Client.emailBisonBaseHost`)
- [ ] **Campaigns synced** to `EmailCampaign` table with `bisonCampaignId`
- [ ] **Workspace availability** configured via `CalendarLink` + `WorkspaceAvailabilityCache`
- [ ] **autoBookMeetings** enabled in `WorkspaceSettings` (for downstream booking)
- [ ] **Dry run successful** with expected counters
- [ ] **Single lead verified** end-to-end
- [ ] **Production cron enabled** in Vercel (verify schedule is active)

### Known Limitations

1. **Timezone inference:** Relies on `WorkspaceSettings.timezone`; leads in different timezones may see suboptimal times.
2. **Sentence format:** Hard-coded; no per-workspace customization yet.
3. **Weekend exclusion:** Default behavior; no opt-in for weekend slots.
4. **Rate limits:** If EmailBison throttles, errors will spike; consider adding backoff.

### Validation (RED TEAM)

- [ ] Run `dryRun=true` and verify counters make sense
- [ ] Run `dryRun=false` on a test lead and verify EmailBison custom var
- [ ] Verify `Lead.offeredSlots` persisted correctly
- [ ] Verify `WorkspaceOfferedSlot` ledger incremented
- [ ] Test acceptance flow → auto-book works
- [ ] Monitor production logs for first 24h after deploy

