# Phase 121 — Review

## Summary
- Prevented quoted email thread content from influencing auto-booking by storing reply-only bodies, re-stripping quotes at automation time, and tightening generic acceptance/time-proposal heuristics.
- Verified locally: `npm test` (243 tests), `npm run lint` (warnings only), `npm run build` (success).

## What Shipped
- Hardened email quote stripping + exposed automation-safe helper:
  - `lib/email-cleaning.ts`
  - `lib/__tests__/email-cleaning.test.ts`
- Webhook storage semantics: never fall back to raw HTML/text in `Message.body`:
  - `app/api/webhooks/email/route.ts`
- Auto-book gating hardening (generic acceptance constraints + proposed-time heuristic tightening):
  - `lib/followup-engine.ts`
  - `lib/__tests__/followup-generic-acceptance.test.ts`
  - `scripts/test-orchestrator.ts`
- Defense-in-depth: strip quoted sections again immediately before snooze detection + auto-booking:
  - `lib/inbound-post-process/pipeline.ts`
  - `lib/background-jobs/email-inbound-post-process.ts`

## Verification

### Commands
- `npm test` — pass (2026-02-09T08:57:48Z)
- `npm run lint` — pass (warnings only) (2026-02-09T08:57:48Z)
- `npm run build` — pass (2026-02-09T08:57:48Z)
- `npm run db:push` — skip (no Prisma schema changes)

### Notes
- Lint currently reports existing warnings in unrelated UI files (no errors).
- Next build currently reports existing CSS optimization warnings and a deprecated middleware convention warning (build still succeeds).

## Success Criteria → Evidence

1. Quoted thread content (including offered times) cannot trigger auto-booking.
   - Evidence:
     - `app/api/webhooks/email/route.ts` stores `Message.body` as `cleaned.cleaned` only (no raw fallback).
     - `lib/inbound-post-process/pipeline.ts` and `lib/background-jobs/email-inbound-post-process.ts` strip quoted sections again right before snooze detection + auto-booking.
     - `lib/__tests__/email-cleaning.test.ts` covers multi-line Gmail `On ... wrote:` stripping + forwarded message stripping.
   - Status: met

2. Non-scheduling inbound replies like "not looking to sell" / "not interested" never auto-book.
   - Evidence:
     - `lib/followup-engine.ts` fails closed for generic acceptance unless the message is a short acknowledgement.
     - `lib/__tests__/followup-generic-acceptance.test.ts` includes a negative example ("We are not interested...") that must not pass gating.
   - Status: met

3. Generic acceptance ("Yes", "Sounds good") still auto-books only for a short acknowledgement to a recent offered-slot message.
   - Evidence:
     - `lib/followup-engine.ts:isLowRiskGenericAcceptance(...)` requires acknowledgement-like text and an `offeredAt` freshness window (<= 7 days).
     - `lib/__tests__/followup-generic-acceptance.test.ts`
   - Status: met

4. Tests cover the regression surface.
   - Evidence:
     - `lib/__tests__/email-cleaning.test.ts`
     - `lib/__tests__/followup-generic-acceptance.test.ts`
   - Status: met

5. `npm test`, `npm run lint`, `npm run build` pass.
   - Evidence: command results above
   - Status: met

## Plan Adherence
- Planned vs implemented deltas:
  - The plan suggested a dedicated webhook-level unit test asserting `Message.body` never falls back to raw content; this was not added (route is not currently unit tested in this repo). The behavior is still enforced deterministically in code and defended again at automation time.

## Risks / Rollback
- Risk: the stricter generic-acceptance gating may reduce legitimate auto-books for short acknowledgements on older threads.
  - Mitigation: only affects generic acceptance; specific acceptances still go through the normal booking flow. Monitor booking rates and Slack notifications post-deploy.
- Rollback: revert Phase 121 changes in `lib/followup-engine.ts` and/or the inbound reply-only stripping in the email pipelines if needed.

## Follow-ups
- Add an integration-style test harness for `app/api/webhooks/email/route.ts` (mock Prisma) to lock in storage semantics long-term.
- After deploy: spot-check inbound email threads that contain quoted availability; confirm no spurious booking confirmations are sent.

