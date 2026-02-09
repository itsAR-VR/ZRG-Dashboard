# Phase 128 — Review

## Summary
- Fixed Compose-with-AI blocking error caused by booking escalation (`max_booking_attempts_exceeded`) by making escalation fail-open (drafting continues; booking nudges suppressed).
- Hardened pricing replies by merging persona + workspace `serviceDescription` and preventing pricing placeholders (`${PRICE}`, `$X-$Y`) via prompt guardrails, retry detection, and final sanitization.
- Verified locally: `npm test`, `npm run lint`, `npm run build` all pass (lint has warnings only).
- Manual live UI/Jam repro validation is still pending (requires authenticated session + real lead state).
- monday.com item `11211767137` updated with fix summary and Jam link.

## What Shipped
- Booking escalation fail-open:
  - `lib/booking-process-instructions.ts` — escalation now returns `requiresHumanReview: false` with `escalationReason`.
  - `lib/ai-drafts.ts` — treats escalation as a soft signal; suppresses `availability` and booking link usage; appends explicit “no times/links” prompt appendix.
- Pricing consistency + placeholder hardening:
  - `lib/ai-drafts.ts` — `mergeServiceDescriptions()` + merged persona + workspace service description at draft generation call site.
  - `lib/ai-drafts.ts` — pricing placeholder regex + detection wired into `detectDraftIssues()` retries and `sanitizeDraftContent()` final pass.
  - `lib/__tests__/ai-drafts-service-description-merge.test.ts` — merge behavior coverage.
  - `lib/__tests__/ai-drafts-pricing-placeholders.test.ts` — placeholder stripping coverage (and verifies real prices are preserved).
  - `scripts/test-orchestrator.ts` — registers the new tests.

## Verification

### Commands
- `npm test` — pass (`2026-02-09`)
- `npm run lint` — pass (warnings only) (`2026-02-09`)
- `npm run build` — pass (`2026-02-09`)
- `npm run db:push` — skip (Phase 128 is schema-free; `prisma/schema.prisma` is modified in the working tree due to other phases and should be pushed in the owning phase/environment)

### Notes
- Working tree is very dirty (multiple concurrent phases touching related files, including `lib/ai-drafts.ts`). The Phase 128 changes were kept surgical and layered on top of the existing Phase 123/127 draft-pipeline work.
- Jam MCP (`jam/*`) is not usable in this environment (“Auth required”); Jam investigation relied on the Jam URL + monday screenshots.

## Success Criteria → Evidence

1. Clicking **Compose with AI** no longer fails with `Human review required: max_booking_attempts_exceeded`.
   - Evidence: `lib/ai-drafts.ts` no longer returns `{ success:false, error:"Human review required: ..." }` for booking escalation; `lib/booking-process-instructions.ts` now returns `requiresHumanReview:false` for the escalation reason.
   - Status: **partial** (code-level fix + tests/build passed; live Jam/UI validation pending)

2. When booking escalation is active, generated drafts do not propose time slots / booking links automatically, but still answer inbound questions normally.
   - Evidence: `lib/ai-drafts.ts` clears `availability`, suppresses booking link usage, and appends an explicit “no times/links” instruction when escalation is active.
   - Status: **partial** (code-level fix; live validation pending)

3. Booking escalation is treated as a soft signal (suppresses booking nudges, but never blocks drafting).
   - Evidence: `lib/booking-process-instructions.ts` escalation path returns `requiresHumanReview:false`; `lib/ai-drafts.ts` handles `escalationReason` without returning an error.
   - Status: **met**

4. Pricing suggestions stop using placeholders when pricing context exists; otherwise ask a clarifying question (no hallucinated numbers).
   - Evidence:
     - `lib/ai-drafts.ts` merges service descriptions so pricing context isn’t dropped.
     - `lib/ai-drafts.ts` prompt guardrails discourage placeholders.
     - `lib/ai-drafts.ts` retries on placeholder output (email) and strips placeholders as a final safety net.
     - Tests: `lib/__tests__/ai-drafts-service-description-merge.test.ts`, `lib/__tests__/ai-drafts-pricing-placeholders.test.ts`.
   - Status: **met**

5. Quality gates pass: `npm test`, `npm run lint`, `npm run build`.
   - Evidence: command runs recorded in `docs/planning/phase-128/d/plan.md` and executed locally.
   - Status: **met**

## Plan Adherence
- Planned vs implemented deltas:
  - Phase 128c planned an additional booking escalation unit test; it was skipped due to lack of an established node:test module-mocking pattern for Prisma in this repo (most tests use dependency injection).

## Risks / Rollback
- Risk: If a pricing placeholder slips through despite prompt/retry, sanitization can remove the placeholder but may leave awkward phrasing (“from to”).
  - Mitigation: placeholder detection triggers retries for email drafts; sanitization is a last-resort. Future improvement would be a small “rewrite the sentence without placeholders” pass when placeholder stripping occurs.

## Follow-ups
- Manual live validation: replay Jam repro (Compose with AI) on staging/prod for a lead in escalated booking state.
- Optional: add SMS/LinkedIn retry-on-placeholder similar to email retry loop.
