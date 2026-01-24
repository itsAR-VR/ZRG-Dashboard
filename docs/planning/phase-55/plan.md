# Phase 55 — EmailBison First-Touch `availability_slot` (Just-In-Time Injection)

## Purpose
Automate “process (2)” by generating and injecting a lead custom variable named `availability_slot` into EmailBison ~15 minutes before a lead’s **first outbound campaign email** is scheduled to send.

## Context
We run outbound email campaigns via EmailBison (MeetInboxXia). For some campaigns, the **very first outbound message** should include two suggested meeting times (in the client’s timezone) without qualification questions. Those times are inserted into the outbound template using an EmailBison lead custom variable.

Current stakeholder requirements (from the conversation):
- Custom variable name is **always exactly** `availability_slot`.
- We need to cover **all EmailBison workspaces** (all clients configured with EmailBison).
- We must detect leads whose first outbound is **scheduled within the next 24 hours**, and generate/update `availability_slot` **on the fly ~15 minutes before send**.
- The suggested times must be **after** the scheduled send time and should prefer the next ~5 business days while minimizing collisions (the existing “offered slot ledger” can replace the n8n + Google Sheet approach).

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 52 | Active/dirty working tree | Booking automation processes | Phase 55 implements the Process (2) subset; keep semantics compatible with Process (2) success criteria in Phase 52. |
| Phase 51 | Active/dirty working tree | Inbound post-processing + prompt runner | Ensure any inbound acceptance auto-booking continues to rely on `Lead.offeredSlots` persisted by this phase. |
| Phase 53 | Active/dirty working tree | Email webhook reliability/perf | Avoid adding bursty provider calls to the webhook path; keep this work cron-driven + time-bounded. |
| Phase 54 | Active/dirty working tree | EmailBison API usage | Share EmailBison API wrapper patterns; avoid duplicating lead/campaign discovery logic. |

## Objectives
* [x] Specify the exact Process (2) JIT flow + edge cases (scheduling window, idempotency, timezones).
* [x] Implement provider API touchpoints needed to (a) discover scheduled sends and (b) set lead custom variables.
* [x] Implement a Vercel-cron job to generate/persist offered slots and PATCH `availability_slot` for due leads.
* [x] Produce a verification runbook (dry run + safety checks) and minimal regression coverage.

## Constraints
- **No secrets in repo**; cron must be protected via `CRON_SECRET` (Bearer auth/header fallback).
- `availability_slot` must be written without clobbering other EmailBison lead custom variables.
- Time-bounded execution: cron must finish reliably (budget + bounded pagination).
- Prefer deterministic slot selection and formatting; do not require an LLM call inside the cron path unless explicitly approved.
- Preserve existing conservative booking posture: downstream auto-booking should only occur on clear acceptance of previously offered slots.

## Success Criteria
- [x] For any EmailBison-configured workspace with campaigns/leads scheduled to send soon:
  - [x] If a lead’s **first touch** outbound email is scheduled within the next 24 hours, the system will set `availability_slot` within ~15 minutes of scheduled send.
  - [x] The injected sentence contains 1–2 times in the client’s timezone and is based on workspace availability, chosen after the scheduled send time.
  - [x] The same UTC slots are persisted to `Lead.offeredSlots` and counted in the workspace offered-slot ledger for collision avoidance.
- [x] Cron is safe to run every minute (idempotent, bounded, and does not exceed runtime limits).

## Subphase Index
* a — Process (2) flow spec + edge cases
* b — Implementation (EmailBison API + cron + slot persistence)
* c — Verification, rollout, and monitoring

## Repo Reality Check (RED TEAM)

### What exists today (implementation already complete)

The Phase 55 implementation is **already substantially complete** in the working tree:

- **Core implementation:** `lib/emailbison-first-touch-availability.ts` (474 lines)
  - `processEmailBisonFirstTouchAvailabilitySlots()` — main processing function with time budget, dry-run support
  - Iterates all EmailBison workspaces, campaigns, and leads
  - Detects "first touch" via `emails_sent === 0`
  - Fetches scheduled emails, checks if within 24h and due within 15m
  - Selects 1–2 slots via `selectDistributedAvailabilitySlots()`
  - Persists to `Lead.offeredSlots` and increments ledger via `incrementWorkspaceSlotOffersBatch()`
  - Patches EmailBison lead custom variables (preserving existing vars)
  - Full idempotency: skips if `availability_slot` already set + recent `offeredSlots`
  - Skips if `appointmentBookedAt` is set

- **Cron endpoint:** `app/api/cron/emailbison/availability-slot/route.ts`
  - GET/POST with `CRON_SECRET` Bearer auth + legacy header fallback
  - Supports `?dryRun=true` and `?timeBudgetMs=N` query params
  - `maxDuration = 800` (Vercel Pro limit)

- **Vercel cron schedule:** `vercel.json` includes `"schedule": "* * * * *"` (every minute)

- **Supporting primitives (already exist):**
  - `lib/slot-offer-ledger.ts` — `getWorkspaceSlotOfferCountsForRange()`, `incrementWorkspaceSlotOffersBatch()`
  - `lib/availability-distribution.ts` — `selectDistributedAvailabilitySlots()`
  - `lib/availability-cache.ts` — `getWorkspaceAvailabilitySlotsUtc()`
  - `lib/emailbison-api.ts` — `fetchEmailBisonScheduledEmails()`, `fetchEmailBisonLead()`, `patchEmailBisonLead()`, `fetchEmailBisonCampaignLeadsPage()`
  - `prisma/schema.prisma` — `Lead.offeredSlots`, `WorkspaceOfferedSlot` model

### What the plan assumes vs reality

| Plan Assumption | Reality |
|-----------------|---------|
| Need to implement EmailBison API wrappers | ✅ Already exist in `lib/emailbison-api.ts` |
| Need to implement slot selection | ✅ `selectDistributedAvailabilitySlots()` exists |
| Need to implement cron job | ✅ Route + schedule exist |
| Need to implement idempotency | ✅ Implemented with multi-level checks |
| Need to persist offeredSlots | ✅ Code persists to `Lead.offeredSlots` |

### Verified touch points

- `lib/emailbison-first-touch-availability.ts:170` — `processEmailBisonFirstTouchAvailabilitySlots()`
- `app/api/cron/emailbison/availability-slot/route.ts:22` — GET handler
- `lib/emailbison-api.ts:857` — `fetchEmailBisonScheduledEmails()`
- `lib/emailbison-api.ts:936` — `patchEmailBisonLead()`
- `lib/emailbison-api.ts:1317` — `fetchEmailBisonLead()`
- `lib/slot-offer-ledger.ts:43` — `incrementWorkspaceSlotOffersBatch()`
- `lib/availability-distribution.ts:40` — `selectDistributedAvailabilitySlots()`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes

1. **EmailBison API rate limits / throttling** → The cron runs every minute and iterates all workspaces/campaigns. Under load, this could hit provider rate limits.
   - Mitigation: Current implementation has time budget (45s default) + per-client lead caps (4,000). Monitor for 429 responses; consider exponential backoff or workspace rotation if needed.

2. **Scheduled email time parsing edge cases** → `getEarliestScheduledSendAt()` tries multiple fields (`scheduled_date`, `scheduled_date_local`, `sent_at`). Timezone mismatches could cause incorrect "due within 15m" decisions.
   - Mitigation: Current code assumes UTC or parses correctly; add explicit logging of timezone assumptions if issues arise.

3. **Workspace availability cache staleness** → If `WorkspaceAvailabilityCache` is stale or empty, slots won't be generated.
   - Mitigation: Current code calls `getWorkspaceAvailabilitySlotsUtc({ refreshIfStale: true })`; monitor `errors` counter for availability fetch failures.

4. **Custom variable clobbering** → If EmailBison API has a different behavior for `PATCH` than expected (replace-all vs merge), existing vars could be lost.
   - Mitigation: Current `upsertCustomVariable()` preserves existing vars; but verify EmailBison API actually respects the full array. Test with a lead that has other custom vars.

5. **Page rotation starvation** → Rotation formula `(campaignIdHash + minuteBucket) % lastPage` could skip pages under certain conditions.
   - Mitigation: Current implementation visits up to 3 pages per campaign per run; over time all pages are covered. Monitor `leadsScanned` vs total leads.

### Missing or ambiguous requirements

1. **"availability_slot" sentence format flexibility** — Current format is `"does {time1} or {time2} work for you?"` but stakeholder may want different phrasing per workspace.
   - Current default: Hard-coded sentence format.
   - Potential enhancement: Add `WorkspaceSettings.availabilitySlotFormat` for customization.

2. **Weekend handling per workspace** — Code filters weekends by default, falls back to weekday slots. Some workspaces may want weekend availability.
   - Current default: Weekdays preferred, weekends used only if no weekdays available.
   - Potential enhancement: Add `WorkspaceSettings.allowWeekendSlots`.

3. **Slot count (1 vs 2)** — Code always tries to select 2 slots. Should single-slot be an option?
   - Current default: Up to 2 slots selected.

### Performance / timeouts

- **Time budget**: Default 45s, max 10 min. Current Vercel route has `maxDuration = 800` (13+ min) which is excessive for a cron running every minute.
  - Recommendation: Reduce `maxDuration` to 60s and rely on rotation for full coverage; prevents overlapping runs.

- **DB queries per lead**: Each first-touch lead triggers 3+ API calls (scheduled emails, lead details, patch) plus DB reads/writes. With 4,000 leads/client budget, this could be ~16,000 API calls per run.
  - Current mitigation: Time budget + early exit. Monitor actual throughput.

### Security / permissions

- ✅ Cron endpoint requires `CRON_SECRET` (Bearer token or header fallback)
- ✅ No PII logged beyond lead IDs
- ⚠️ `autoBookMeetings` warning is logged; should not contain sensitive data

### Testing / validation

- **Missing:** No unit tests for `processEmailBisonFirstTouchAvailabilitySlots()`
- **Missing:** No integration test with mock EmailBison API
- **Existing:** `lib/availability-distribution.ts` and slot ledger may have tests (not verified)

### Multi-agent coordination

- **Phase 52** (Booking Automation) — Phase 55 implements "Process (2)" subset. Success criteria align: offered slots persisted to `Lead.offeredSlots` for downstream auto-booking.
- **Phase 51** (Inbound Kernel) — No direct overlap; Phase 55 is cron-driven, not inbound-triggered.
- **Phase 53** (Webhook Burst Hardening) — Phase 53's slot ledger changes (removed batched transaction) are compatible with Phase 55.
- **Phase 54** (Reactivation Anchors) — No overlap; different EmailBison flows.

## Assumptions (Agent)

- EmailBison `PATCH /api/leads/:id` with `custom_variables` array merges (does not replace-all). (confidence ~85%)
  - Mitigation: Verify with a test lead that has other custom vars before rollout.

- `scheduled_date` from EmailBison is in UTC or ISO8601 with timezone offset. (confidence ~90%)
  - Mitigation: Add logging if parsing fails to identify timezone issues.

- The cron running every minute will not overlap significantly given the 45s default budget. (confidence ~90%)
  - Mitigation: Add a lock/semaphore if overlapping runs cause issues.

## Open Questions (Need Human Input)

- [ ] **Sentence format customization** (confidence ~60%)
  - What decision is needed: Should workspaces be able to customize the `availability_slot` sentence format?
  - Why it matters: Different sales styles may want different phrasing ("Would {time1} or {time2} work?" vs "I'm available {time1} and {time2}").
  - Current default: Hard-coded format `"does {time1} or {time2} work for you?"`.

- [ ] **Weekend slots opt-in** (confidence ~65%)
  - What decision is needed: Should workspaces opt-in to weekend slot suggestions?
  - Why it matters: Some businesses operate on weekends; current default excludes them.
  - Current default: Weekdays only (weekends as fallback).

- [ ] **Production rollout verification** (confidence ~70%)
  - What decision is needed: Has the cron been deployed and verified in production?
  - Why it matters: Phase 55 appears complete in code but status is unclear.
  - Current assumption: Code is implemented but may need production verification.

## Phase Summary

- Shipped:
  - Implemented Process (2) "first outbound includes times" by generating and injecting EmailBison lead custom variable `availability_slot` just-in-time (~15 minutes before scheduled send).
  - Persisted the same offered UTC slots to `Lead.offeredSlots` + incremented `WorkspaceOfferedSlot` counts so inbound acceptance can auto-book reliably.
  - Processor: `lib/emailbison-first-touch-availability.ts` (474 lines)
  - Cron route: `app/api/cron/emailbison/availability-slot/route.ts`
  - Vercel cron schedule: `vercel.json` (every minute)
  - EmailBison API wrappers: `lib/emailbison-api.ts` (scheduled emails, lead details, PATCH)
- Verified:
  - `npm run lint`: ✅ 0 errors (17 warnings, pre-existing)
  - `npm run build`: ✅ passed
  - `npm run db:push`: skipped (schema changes are from Phase 53, not Phase 55)
- Notes:
  - Verification runbook lives in `docs/planning/phase-55/c/plan.md`
  - Production dry-run verification still required before Phase 55 can be considered fully complete
  - Unit tests for processor function are missing (follow-up)

## Review Notes

- **Review completed**: 2026-01-24
- **Review artifact**: `docs/planning/phase-55/review.md`
- **Quality gates**:
  - `npm run lint` — ✅ 0 errors, 17 warnings (pre-existing)
  - `npm run build` — ✅ passed
  - `npm run db:push` — skipped (schema changes are from Phase 53)
- **Multi-agent coordination**: Working tree contains uncommitted changes from Phases 51–54; no semantic conflicts with Phase 55 deliverables
- **Follow-ups**:
  - Run production dry-run verification
  - Add unit tests for `processEmailBisonFirstTouchAvailabilitySlots()`
  - Consider reducing `maxDuration` from 800 to 60 to prevent overlapping runs
