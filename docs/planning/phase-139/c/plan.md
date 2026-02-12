# Phase 139c — Lead-Local Business-Hours Filtering + Lead-Timezone Labels

## Focus

Apply lead-local availability safety and enforce lead-timezone-only user-facing labels.

User decision for this phase: do not present mixed timezone labels in suggestions/confirmations. If lead timezone is known, display times in lead timezone only.

## Inputs

- 139a: `isValidIanaTimezone` export and conversation-aware `ensureLeadTimezone`.
- 139b: prompt/date context updates and timing preference extraction in `lib/ai-drafts.ts`.
- `lib/availability-distribution.ts` — `selectDistributedAvailabilitySlots`.
- `lib/ai-drafts.ts` and `lib/followup-engine.ts` caller paths that generate visible slot labels.

## Work

### 1. Add lead-local business-hours filter to slot distribution

In `lib/availability-distribution.ts`:

- Extend `selectDistributedAvailabilitySlots` opts with:
  - `leadTimeZone?: string | null`
- Import `isValidIanaTimezone` from `@/lib/timezone-inference`.
- Update local time extraction to include minutes so the 21:00 cutoff is precise.
- Apply filter on lead-local time window:
  - start: `07:00` inclusive
  - end: `21:00` exclusive
- Fail-open behavior:
  - if filtered result is empty, keep original pool.
  - emit debug log/telemetry marker for empty-filter fallback.

### 2. Thread `leadTimeZone` into distribution callers

Update all scheduling-selection callsites touched by this phase:

- `lib/ai-drafts.ts` (`generateResponseDraft` slot selection path)
- `lib/followup-engine.ts` (availability suggestion paths that call `selectDistributedAvailabilitySlots`)

Pass `leadTimeZone: tzResult.timezone ?? null` where timezone context is available.

### 3. Enforce lead-timezone-only label policy

Do not add dual-timezone label rendering.

Instead:

- Ensure label formatting callsites pass lead timezone as the effective `timeZone` when known.
- Keep workspace timezone as fallback only when lead timezone is unknown.
- Keep existing `formatAvailabilitySlotLabel` / `formatAvailabilitySlots` API stable unless a compatibility-safe extension is required.

### 4. Keep cross-phase edits scoped

`lib/ai-drafts.ts` is shared with active phases.

- Restrict edits to scheduling/timezone sections only.
- Do not touch pricing/knowledge-context sections modified by Phase 140.

### 5. Verify

- Dubai lead case: slots outside 7:00 to <21:00 local are filtered when alternatives exist.
- Boundary checks:
  - 07:00 included.
  - 20:59 included.
  - 21:00+ excluded.
- If all candidates are out-of-window: system falls back to unfiltered candidates.
- Suggested labels are shown in lead timezone only (no mixed EST/GST presentation).

## Output

- `lib/availability-distribution.ts` updated with lead-local business-hours filtering and fail-open fallback.
- `lib/ai-drafts.ts` and `lib/followup-engine.ts` distribution callsites thread `leadTimeZone`.
- User-visible slot labels in touched paths use lead timezone when known.

## Handoff

Phase 139d will complete booking confirmation enforcement and meeting-overseer timezone extraction (`v2`) so auto-booking and confirmations follow the same lead-timezone policy.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Extended `selectDistributedAvailabilitySlots(...)` in `lib/availability-distribution.ts` with optional `leadTimeZone`.
  - Implemented lead-local business-hours filter at minute precision (07:00 inclusive, 21:00 exclusive) and fail-open fallback when filtering empties the candidate pool.
  - Threaded `leadTimeZone` into scheduling callsites in `lib/ai-drafts.ts` and `lib/followup-engine.ts`.
  - Kept user-visible slot label rendering lead-timezone-first by using resolved lead timezone in touched scheduling paths.
- Commands run:
  - `DATABASE_URL='postgresql://test:test@localhost:5432/test?schema=public' DIRECT_URL='postgresql://test:test@localhost:5432/test?schema=public' OPENAI_API_KEY='test' node --conditions=react-server --import tsx --test lib/__tests__/availability-distribution.test.ts` — pass.
- Blockers:
  - None.
- Next concrete steps:
  - Completed in this turn; confirmation-path timezone enforcement is finalized in 139d.
