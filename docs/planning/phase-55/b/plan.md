# Phase 55b — Implementation (EmailBison API + Cron + Slot Persistence)

## Focus
Implement the JIT injection job that discovers due first-touch sends, selects two slots, persists them, and patches EmailBison lead custom variables.

## Inputs
- Phase 55a spec (triggers, idempotency, formatting).
- Existing availability selection + offered-slot ledger primitives.
- EmailBison API access per workspace (`emailBisonApiKey`, base host when configured).

## Work
- Add/verify EmailBison API wrappers:
  - Fetch campaign leads (paged) and detect `emails_sent == 0`.
  - Fetch lead scheduled emails and select the earliest scheduled send.
  - Patch lead custom variables to upsert `availability_slot`.
- Implement core job:
  - Iterate all EmailBison workspaces.
  - Bound work via time budget + per-client/per-campaign caps.
  - Rotate pagination across runs so large campaigns receive coverage without scanning everything each minute.
  - Select 1–2 UTC slots after scheduled send using slot distribution + offer counts; render sentence in client timezone.
  - Persist `Lead.offeredSlots` and increment ledger counts.
  - Patch EmailBison lead custom variables, preserving existing variables.
- Add cron entrypoint:
  - `GET/POST` route protected by `CRON_SECRET`.
  - Supports `dryRun=true` for validation without provider writes.
  - Add Vercel cron schedule (every minute).

## Output
- A deployed code path that sets `availability_slot` just-in-time for due leads.

## Handoff
Proceed to Phase 55c with a runbook and sanity checks for safe rollout.

---

## RED TEAM Status: COMPLETE ✅

### Implementation Verification

**EmailBison API wrappers (all exist in `lib/emailbison-api.ts`):**
- ✅ `fetchEmailBisonCampaignLeadsPage()` — lines 536-621, paged campaign lead fetch
- ✅ `fetchEmailBisonScheduledEmails()` — lines 857-929, scheduled email fetch
- ✅ `fetchEmailBisonLead()` — lines 1317-1388, full lead details with custom vars
- ✅ `patchEmailBisonLead()` — lines 936-990, PATCH with custom_variables array

**Core job implementation (`lib/emailbison-first-touch-availability.ts`):**
- ✅ `processEmailBisonFirstTouchAvailabilitySlots()` — main function, lines 170-474
- ✅ Time budget: configurable, default 45s, max 10m (lines 188-189)
- ✅ Per-client caps: `maxLeadsPerClient` (4,000), `maxCampaignsPerClient` (50) (lines 191-193)
- ✅ Page rotation: `startPageSeed = campaignIdHash + minuteBucket` (lines 279-280)
- ✅ Slot selection via `selectDistributedAvailabilitySlots()` (lines 383-391)
- ✅ `Lead.offeredSlots` persistence (lines 406-418)
- ✅ Ledger increment via `incrementWorkspaceSlotOffersBatch()` (lines 420-424)
- ✅ Custom variable upsert preserving existing vars (lines 426-429)
- ✅ dryRun support (line 404 check)

**Cron entrypoint (`app/api/cron/emailbison/availability-slot/route.ts`):**
- ✅ GET/POST handlers (lines 22-58)
- ✅ `CRON_SECRET` Bearer auth + legacy header fallback (lines 8-19)
- ✅ `dryRun=true` query param support (line 29)
- ✅ `timeBudgetMs` query param support (lines 30-31)
- ✅ `maxDuration = 800` (line 6)

**Vercel cron schedule (`vercel.json`):**
- ✅ `"/api/cron/emailbison/availability-slot"` with `"schedule": "* * * * *"` (every minute)

### Implementation Details

| Component | File | Status |
|-----------|------|--------|
| Main processor | `lib/emailbison-first-touch-availability.ts` | ✅ 474 lines |
| Cron route | `app/api/cron/emailbison/availability-slot/route.ts` | ✅ 59 lines |
| Slot selection | `lib/availability-distribution.ts` | ✅ Pre-existing |
| Offer ledger | `lib/slot-offer-ledger.ts` | ✅ Pre-existing |
| Availability cache | `lib/availability-cache.ts` | ✅ Pre-existing |
| EmailBison API | `lib/emailbison-api.ts` | ✅ All methods exist |
| Vercel cron | `vercel.json` | ✅ Scheduled |

### Metrics returned by processor

```typescript
{
  clientsScanned: number;
  campaignsScanned: number;
  leadsScanned: number;
  leadsFirstTouch: number;
  leadsScheduledWithin24h: number;
  leadsDueWithin15m: number;
  leadsUpdated: number;
  leadsSkippedAlreadySet: number;
  errors: number;
  finishedWithinBudget: boolean;
}
```

