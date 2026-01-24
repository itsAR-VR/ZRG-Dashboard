# Phase 53e — AI + Background Job Stability (Timeouts, Truncation, Transaction Contention)

## Focus
Make AI-dependent flows and background jobs resilient under load:
- Step-3 verifier should not block pipelines or fail noisily.
- Background jobs should avoid transaction acquisition bottlenecks.
- Failures should be bounded, categorized, and safe.

## Inputs
- `lib/ai-drafts.ts` (step-3 verifier call + telemetry)
- Phase 51 direction: unified prompt runner (avoid parallel abstractions)
- `lib/slot-offer-ledger.ts` (`prisma.$transaction([...upsert])` currently triggers `P2028`)
- Cron runners: `app/api/cron/background-jobs/*`

## Work
1. **Step-3 verifier time budget + fallback**
   - Reduce verifier brittleness:
     - Use a smaller reasoning budget (or disable reasoning) for a deterministic verification task.
     - Increase per-call timeout where appropriate, but keep an overall “pipeline budget”.
     - Add a single retry on network timeout with jitter (but never unbounded).
   - On verifier failure/truncation:
     - Apply deterministic post-processing only (`replaceEmDashesWithCommaSpace`, `enforceCanonicalBookingLink`).
     - Mark telemetry as degraded (AIInteraction status/errorMessage) without breaking draft creation.

2. **Max output tokens handling**
   - If `max_output_tokens` truncation is observed:
     - Prefer reducing reasoning output over raising token ceilings.
     - Tighten prompt instructions to return minimal JSON only.
     - Optionally do a second attempt with lower reasoning effort and slightly higher max tokens.

3. **Slot offer ledger: remove transaction dependency**
   - Replace `prisma.$transaction(slotDates.map(upsert))` with a best-effort approach that does not require interactive transaction acquisition:
     - sequential upserts or limited concurrency with `Promise.allSettled`
     - or a single raw SQL upsert using `UNNEST` + `ON CONFLICT ... DO UPDATE offeredCount = offeredCount + 1`
   - Ensure this remains safe under concurrent increments.

4. **Cron work bounding**
   - For any cron processor that can “fan out” into large work:
     - cap per-run units of work
     - preserve lock semantics
     - schedule continuation via `runAt` rather than trying to finish everything in one invocation

## Output
- **Step‑3 verifier hardening:** `lib/ai-drafts.ts` now treats the verifier as strictly best-effort:
  - Uses lower reasoning effort and clamps oversized drafts *before* verification to reduce truncation risk.
  - Logs verifier warnings/errors only when `LOG_SLOW_PATHS=1` (telemetry still records errors via `AIInteraction`).
  - Always applies deterministic post-pass enforcement (`enforceCanonicalBookingLink`, `replaceEmDashesWithCommaSpace`) regardless of verifier outcome.
- **Slot offer ledger contention fix:** `lib/slot-offer-ledger.ts` removes the batched `$transaction([...upsert])` pattern and uses sequential upserts (deduped per-slot) to avoid `P2028` transaction acquisition failures under DB contention.
- **Cron bounding:** existing background-job cron runner already enforces per-run limits + time budgets; webhook-event draining is also bounded and runs ahead of jobs (Phase 53b).

## Handoff
Proceed to Phase 53f to make GHL/Unipile failures actionable (health states), and to define verification + rollback steps.
