# Phase 130 — Review

## Summary
- Shipped a per-campaign `autoSendSkipHumanReview` toggle that lets AI auto-send rely on confidence threshold even when the evaluator flags human review (hard blocks still apply).
- Wired the toggle end-to-end (DB schema, server actions, inbound pipelines, Campaign Assignment UI).
- Verified on the combined working tree (includes Phase 129 WIP changes): `npm test`, `npm run lint`, `npm run build`, `npm run db:push` all passed on 2026-02-10.

## What Shipped
- Schema:
  - `EmailCampaign.autoSendSkipHumanReview Boolean @default(false)` (`prisma/schema.prisma`)
- Orchestrator decision:
  - `safeToSend` bypass when campaign toggle enabled, while still blocking `source === "hard_block"` / `hardBlockCode` (`lib/auto-send/orchestrator.ts`)
  - Optional decision log behind `AUTO_SEND_DEBUG=1` (`lib/auto-send/orchestrator.ts`)
- Data flow wiring:
  - Campaign CRUD/read via server action (`actions/email-campaign-actions.ts`)
  - Inbound pipeline selects updated (`lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/email-inbound-post-process.ts`, `lib/background-jobs/sms-inbound-post-process.ts`)
- UI:
  - Campaign Assignment checkbox (AI auto-send only), dirty detection, save wiring (`components/dashboard/settings/ai-campaign-assignment.tsx`)
- Tests:
  - Orchestrator tests covering toggle off/on, hard blocks, and below-threshold behavior (`lib/auto-send/__tests__/orchestrator.test.ts`)

## Verification

### Commands
- `npm test` — pass (Tue Feb 10 11:30 EST 2026)
- `npm run lint` — pass (warnings only) (Tue Feb 10 11:30 EST 2026)
- `npm run build` — pass (Tue Feb 10 11:31 EST 2026)
- `npm run db:push` — pass (Tue Feb 10 11:17 EST 2026)

### Notes
- Build output includes pre-existing warnings (e.g. Baseline data age, CSS optimizer warnings, deprecated middleware convention); none are new errors introduced by this phase.

## Success Criteria → Evidence

1. Setting `autoSendSkipHumanReview = true` on a campaign causes drafts with `confidence >= threshold` to auto-send even when the evaluator returns `requires_human_review: true`
   - Evidence:
     - Decision logic: `lib/auto-send/orchestrator.ts`
     - Unit test: `lib/auto-send/__tests__/orchestrator.test.ts` ("bypasses safeToSend when campaign toggle is enabled (confidence >= threshold)")
   - Status: met

2. Hard-blocked drafts (opt-out, blacklist, automated reply) are still blocked regardless of the toggle
   - Evidence:
     - Decision logic checks hard blocks: `lib/auto-send/orchestrator.ts`
     - Unit test: `lib/auto-send/__tests__/orchestrator.test.ts` ("does not bypass hard blocks when campaign toggle is enabled")
   - Status: met

3. `npm run build` passes with no type errors
   - Evidence: `npm run build` (Tue Feb 10 11:31 EST 2026) — pass
   - Status: met

4. `npm run lint` passes
   - Evidence: `npm run lint` (Tue Feb 10 11:30 EST 2026) — pass (warnings only)
   - Status: met

5. Orchestrator test suite covers both toggle states
   - Evidence: `lib/auto-send/__tests__/orchestrator.test.ts` (4 new tests + factory default)
   - Status: met

## Plan Adherence
- Planned vs implemented deltas:
  - Orchestrator gating uses `hardBlockCode` in addition to `source === "hard_block"` to make the "hard block" check more robust.
  - Revision-loop early-exit uses the same derived `passesSafety && passesConfidence` condition, so skip-human-review campaigns stop revising once threshold is met.
  - Campaign list action uses `include` (not explicit `select`) so the new field is present without a query shape rewrite.

## Risks / Rollback
- Risk: Enabling skip-human-review reduces safety checks to hard blocks + confidence threshold; misuse could increase low-quality sends.
  - Mitigation: Toggle is per-campaign and UI-only enabled for `AI_AUTO_SEND`.
- Rollback:
  - Set `autoSendSkipHumanReview=false` for affected campaigns (no code rollback needed).

## Follow-ups
- (Optional) If the decision log is needed in non-debug observability, promote the `skipHumanReview` metadata into a persisted decision record (instead of `AUTO_SEND_DEBUG` logging).
