# Phase 96a — Candidate Slot List Builder (≤50, TZ-safe, exclude repeats)

## Focus
Generate a bounded list of candidate availability slot labels to provide to the AI refresh prompt, ensuring:
- only future slots,
- exclude "today/past" (lead timezone basis),
- exclude repeats in `Lead.offeredSlots`,
- provide a stable label→datetime mapping for DB/ledger updates,
- cap to **50** for latency/cost.

## Inputs
- Existing availability APIs:
  - `getWorkspaceAvailabilitySlotsUtc(clientId, { refreshIfStale: true, availabilitySource })` — `lib/availability-cache.ts`
  - `getLeadQualificationAnswerState({ leadId, clientId })` for DEFAULT vs DIRECT_BOOK — `lib/qualification-answer-extraction.ts`
- Lead state:
  - `Lead.offeredSlots` (JSON string of `{ datetime, label, offeredAt, availabilitySource }`)
  - `Lead.snoozedUntil`
- Timezone:
  - `ensureLeadTimezone(leadId)` (fallback workspace timezone → UTC) — `lib/timezone-inference.ts`
- Slot fairness signals:
  - `getWorkspaceSlotOfferCountsForRange(clientId, anchor, rangeEnd, { availabilitySource })` — `lib/slot-offer-ledger.ts`
- Formatting:
  - `formatAvailabilitySlots({ slotsUtcIso, timeZone, mode, limit })` — `lib/availability-format.ts`

## Work

### Step 1: Create helper module
Create `lib/availability-refresh-candidates.ts` with:

```ts
export type RefreshCandidate = {
  datetimeUtcIso: string;
  label: string;
};

export type BuildRefreshCandidatesResult = {
  candidates: RefreshCandidate[];
  labelToDatetimeUtcIso: Record<string, string>;
};

export async function buildRefreshCandidates(opts: {
  clientId: string;
  leadId: string;
  leadOfferedSlotsJson: string | null;
  snoozedUntil: Date | null;
  availabilitySource: AvailabilitySource;
  candidateCap?: number; // default 50
}): Promise<BuildRefreshCandidatesResult>;
```

### Step 2: Filtering rules
1. Fetch availability via `getWorkspaceAvailabilitySlotsUtc`.
2. Compute anchor = `max(now, snoozedUntil)` in UTC.
3. Get lead timezone via `ensureLeadTimezone(leadId)`.
4. Filter slots:
   - Remove slots earlier than anchor.
   - Remove slots where the **date** in lead timezone is "today" or earlier (not just the UTC datetime).
   - Remove slots already in `Lead.offeredSlots` (parse JSON, normalize datetime to ISO).

### Step 3: Ranking rules
1. Fetch offer counts via `getWorkspaceSlotOfferCountsForRange(clientId, anchor, anchor + 30 days, { availabilitySource })`.
2. Sort by: offer count ascending, then datetime ascending.
3. Take first `candidateCap` (default 50).

### Step 4: Formatting rules
1. Use `formatAvailabilitySlots({ slotsUtcIso, timeZone, mode: "explicit_tz", limit: candidateCap })`.
2. Return both `candidates` array and `labelToDatetimeUtcIso` lookup for validation in Phase 96b.

## Validation (RED TEAM)

- [ ] Verify `ensureLeadTimezone` returns valid IANA timezone or "UTC" fallback.
- [ ] Verify "today" filtering uses lead timezone date boundary (midnight in lead TZ), not UTC midnight.
- [ ] Verify `offeredSlots` exclusion normalizes datetime strings correctly (handle ISO variants).
- [ ] Verify cap enforcement returns exactly `min(available, candidateCap)` candidates.
- [ ] Verify empty candidates case returns `{ candidates: [], labelToDatetimeUtcIso: {} }`.

## Output
- Created `lib/availability-refresh-candidates.ts` with:
  - `buildRefreshCandidates(...)` (candidate list capped, snooze-aware, excludes today/past via lead TZ, excludes `Lead.offeredSlots`, ranks by offer counts + time).
  - `detectPreferredTimezoneToken(...)`, `mapTimezoneTokenToIana(...)`, `applyPreferredTimezoneToken(...)` to preserve draft TZ token style.
  - Returns `availabilitySource` (actual) + `timeZone` used, plus `labelToDatetimeUtcIso` lookup.
- Added optional inputs `preferredTimeZoneToken` + `timeZoneOverride` for callers that already resolved TZ or draft token.
- Tests deferred to Phase 96d (per overall test/QA subphase).

## Handoff
Phase 96b should import `buildRefreshCandidates` and (optionally) `detectPreferredTimezoneToken` to format candidate labels in the same TZ token style as the draft before invoking the AI refresh engine.
