# Phase 143 — Review (Extension f-g-h)

## Summary
- Phase 143 baseline (`a-e`) and extension (`f-g-h`) are implemented for in-scope channels (email, SMS, LinkedIn).
- Action signal detection now includes booking-process routing (`1..5`) with fail-open behavior and workspace-level router toggle support.
- Route metadata is surfaced in Slack payload content (signal-driven sends only) and draft/overseer prompt context (including route-only cases).
- Local validation gates passed; DB-dependent gates are blocked by environment connectivity (`P1001`).

## What Shipped
- `lib/action-signal-detector.ts`
  - Added `BookingProcessRoute` and `route` on `ActionSignalDetectionResult`.
  - Added AI router path (`action_signal.route_booking_process.v1`) with normalization/fail-open handling.
  - Added optional route telemetry writer (`recordBookingProcessRouteOutcome`) with env guard.
  - Added `aiRouteBookingProcessEnabled` and optional injected routing hook for deterministic tests.
  - Extended `notifyActionSignals(...)` to include route metadata in Slack body.
- `lib/ai/prompt-registry.ts`
  - Added `action_signal.route_booking_process.v1` template (model `gpt-5-mini`) with explicit Process 1–5 taxonomy.
- `lib/inbound-post-process/pipeline.ts`
  - Passes channel/provider/toggle context into detector.
  - Preserves route-only payloads (`signals.length > 0 || route`) for draft generation context.
- `lib/background-jobs/email-inbound-post-process.ts`
  - Same detector routing/toggle wiring and route-aware draft passthrough.
- `lib/background-jobs/sms-inbound-post-process.ts`
  - Same detector routing/toggle wiring and route-aware draft passthrough.
- `lib/background-jobs/linkedin-inbound-post-process.ts`
  - Same detector routing/toggle wiring and route-aware draft passthrough.
- `lib/ai-drafts.ts`
  - Added route-aware helpers and Process-specific context injection for prompt appendix + gate summary.
- `prisma/schema.prisma`
  - Added `WorkspaceSettings.aiRouteBookingProcessEnabled Boolean @default(true)`.
- `actions/settings-actions.ts`
  - Added read/write support for `aiRouteBookingProcessEnabled`.
- `components/dashboard/settings-view.tsx`
  - Added Booking Process Router toggle and status card.
- `lib/__tests__/action-signal-detector.test.ts`
  - Expanded suite to 25 tests covering route-only, process-route combinations, fail-open behavior, toggle-off behavior, and route-aware appendix assertions.

## Verification

### Commands
- `npm run db:push`
  - **Fail**: `P1001` (cannot reach `db.pzaptpgrcezknnsfytob.supabase.co:5432`).
- `npm run lint`
  - **Pass**: warnings only, no errors.
- `npm run build`
  - **Pass**: compile/type/static generation succeeded.
  - Note: first attempt hit stale `.next/lock`; rerun after lock removal succeeded.
- `npm run test:ai-drafts`
  - **Pass**: `58` tests passing, `0` failing.
- `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --dry-run --limit 20`
  - **Fail**: `P1001` at replay case selection query.
- `npm run test:ai-replay -- --client-id ef824aca-a3c9-4cde-b51f-2e421ebb6b6e --limit 20 --concurrency 3`
  - **Fail**: `P1001` at replay case selection query.
- `npm test`
  - **Pass**: `368` tests passing, `0` failing.

## Success Criteria → Evidence

1. Router returns process classification for representative inbound messages.
   - Evidence: deterministic route fixtures in `lib/__tests__/action-signal-detector.test.ts` (Process 1/4/5 + fail-open + toggle-off).
   - Status: met (unit-level).

2. Route metadata survives route-only cases (`signals.length === 0`).
   - Evidence: route-only process tests + pipeline passthrough updates (`signals.length > 0 || route`).
   - Status: met.

3. Slack surfacing includes route metadata without new side effects.
   - Evidence: `notifyActionSignals(...)` route metadata appended to Slack message body; send gate remains signal-driven.
   - Status: met.

4. Draft/gate context reflects route semantics without regressing Process 5 override behavior.
   - Evidence: `buildActionSignalsPromptAppendix(...)` and `buildActionSignalsGateSummary(...)` updates + prompt appendix assertions.
   - Status: met (unit-level).

5. Existing action-signal behavior remains non-blocking/fail-open.
   - Evidence: router fail-open tests + guarded detection flow.
   - Status: met.

6. Expanded validation gates complete.
   - Evidence: `npm test`, `npm run lint`, `npm run build`, `npm run test:ai-drafts` all pass.
   - Status: met for local gates; blocked for DB-dependent gates.

7. DB-dependent quality gates (`db:push`, replay dry/live) complete.
   - Evidence: command logs show `P1001` reachability failures.
   - Status: blocked by environment.

## Multi-Agent Coordination
- Reviewed dirty worktree and recent phase overlap before validation.
- Confirmed high-overlap hot files and merged by symbol-level intent:
  - `lib/ai-drafts.ts`
  - `lib/ai/prompt-registry.ts`
  - `lib/inbound-post-process/pipeline.ts`
  - `lib/background-jobs/*-inbound-post-process.ts`
- Additional plan-level conflict scan performed against last 10 phases with explicit risk findings documented in `docs/planning/phase-143/plan.md`.

## Residual Risks / Follow-ups
- Router timeout acceptance is resolved for this phase: keep current 4s budget.
- Smartlead/Instantly routing remains deferred in this phase; add follow-on phase if cross-channel parity is required.
- Final closure requires rerunning:
  - `npm run db:push`
  - `npm run test:ai-replay -- --client-id <clientId> --dry-run --limit 20`
  - `npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3`
  from an environment that can reach `db.pzaptpgrcezknnsfytob.supabase.co:5432`.
