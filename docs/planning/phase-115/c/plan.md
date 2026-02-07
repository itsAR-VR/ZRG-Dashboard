# Phase 115c - Integrate Revision Into Auto-Send Paths + Safety + Telemetry + Tests

## Focus
Wire the revision agent into production auto-send execution paths (campaign AI auto-send) with deterministic safety gates, bounded behavior, and operator visibility.

## Inputs
- Phase 115a context selector + Phase 115b revision helper
- Auto-send orchestrator: `lib/auto-send/orchestrator.ts` (factory pattern via `createAutoSendExecutor(deps: AutoSendDependencies)`)
- Auto-send DI types: `lib/auto-send/types.ts` (`AutoSendDependencies`, `AutoSendContext`, `AutoSendTelemetry`, `AutoSendResult`)
- Admin AI Ops visibility: `actions/ai-ops-feed-actions.ts` + `components/dashboard/ai-ops-panel.tsx` (Phase 114)
- Existing telemetry plumbing: `AIInteraction.metadata` (Phase 112)
- ~~Duplicate email auto-send path: `app/api/webhooks/email/route.ts`~~ **REMOVED (RT-01):** Email webhook already delegates to background jobs that call `executeAutoSend()`. No inline auto-send code exists.

## Work
1. Add deterministic "hard block" classification to `evaluateAutoSend` output (recommended to avoid brittle string matching):
   - Extend `AutoSendEvaluation` to include (**optional fields for backward compat — RT-19/20**):
     - `source?: "hard_block" | "model"` (default `"model"` when omitted)
     - `hardBlockCode?: "empty_draft" | "opt_out" | "blacklist" | "automated_reply" | "missing_openai_key" | "other"`
   - Map early-return branches in `lib/auto-send-evaluator.ts:203-248` to `source="hard_block"` with appropriate code:
     - Line 203 (empty draft) → `hardBlockCode: "empty_draft"`
     - Line 213 (opt-out/unsubscribe) → `hardBlockCode: "opt_out"`
     - Line 222 (blacklist/automated categorization) → `hardBlockCode: "blacklist"` or `"automated_reply"`
     - Line 231 (provider automated flag) → `hardBlockCode: "automated_reply"`
     - Line 241 (no OpenAI key) → `hardBlockCode: "missing_openai_key"`
   - LLM-based results use `source="model"`.

1b. Add revision tracking fields to `AIDraft` schema (**RT-17**):
   - In `prisma/schema.prisma`, add to `AIDraft` model:
     - `autoSendRevised           Boolean  @default(false)`
     - `autoSendOriginalConfidence Float?`
   - Run `npm run db:push` to apply.
   - Update `recordAutoSendDecision` in `lib/auto-send/record-auto-send-decision.ts` to accept and persist these fields.

2. Integrate revision into orchestrator path:
   - **Add `maybeReviseAutoSendDraft` to `AutoSendDependencies`** in `lib/auto-send/types.ts` (RT-06):
     - `maybeReviseAutoSendDraft?: typeof import("./revision-agent").maybeReviseAutoSendDraft`
     - Make it optional so existing callers (tests, delayed-send) don't break
     - Wire default binding in `lib/auto-send/orchestrator.ts` at the `defaultExecutor` export (line ~664)
   - In `lib/auto-send/orchestrator.ts`, inside `executeAiAutoSendPath` (insertion point: after evaluation at ~line 268, before threshold check at ~line 270):
     - if `evaluation.source === "model"` AND `evaluation.confidence < threshold`:
       - call `deps.maybeReviseAutoSendDraft(...)`, passing `deps.evaluateAutoSend` as the re-evaluator
       - if revised draft returned:
         - **DB persistence already handled inside `maybeReviseAutoSendDraft`** (RT-09 — draft written to `AIDraft.content` before return)
         - update `context.draftContent = revisedDraft` (in-memory, for downstream send logic)
         - use revised evaluation for threshold check
         - record `autoSendRevised = true` and `autoSendOriginalConfidence = originalEval.confidence`
       - if null returned: continue as today (needs_review path)
   - Ensure revision runs **before** delayed scheduling decisions, so the draft content is final for delayed jobs.
   - **Add `createDefaultMocks()` helper** to `lib/auto-send/__tests__/orchestrator.test.ts` (RT-15) — returns complete deps object with `maybeReviseAutoSendDraft: mock.fn(() => null)` as default. Update existing test cases to use this helper.

~~3. Deduplicate email webhook auto-send implementation~~ **REMOVED (RT-01)**
   - The email webhook (`app/api/webhooks/email/route.ts`) was refactored in Phase 35 to enqueue `EMAIL_INBOUND_POST_PROCESS` background jobs.
   - The background job processor (`lib/background-jobs/email-inbound-post-process.ts`) already calls `executeAutoSend()`.
   - All 4 active `executeAutoSend()` call sites (email-inbound-pp, sms-inbound-pp, inbound-post-process/pipeline, delayed-auto-send) will automatically inherit the revision agent via the orchestrator integration in Work Item 2.
   - **No webhook-level changes needed.**

3. Telemetry + AI Ops visibility (renumbered from 4)
   - Update `AI_OPS_FEATURE_IDS` array in `actions/ai-ops-feed-actions.ts:28-36` to include:
     - `"auto_send.context_select"`
     - `"auto_send.revise"`
   - Add extraction logic in `extractAiInteractionSummary()` for revision metadata (original_confidence, revised_confidence, improved boolean).
   - Ensure feed returns stats-only DTO (no prompt bodies/drafts).
   - Add minimal UI affordance in AI Ops panel to show:
     - revision attempted? (boolean)
     - confidence delta (original -> revised)
     - final action (send_immediate/send_delayed/needs_review/skip/error)

4. Feature gating / safety levers (renumbered from 5)
   - Add env kill-switch for revision (in addition to global `AUTO_SEND_DISABLED`):
     - `AUTO_SEND_REVISION_DISABLED=1` disables selector/reviser steps while leaving evaluator behavior unchanged.
   - Ensure "fail closed" behavior:
     - any selector/reviser error falls back to existing needs_review behavior

5. Tests + validation (renumbered from 6)
   - Orchestrator unit tests (using `createDefaultMocks()` helper):
     - when below threshold and reviser improves confidence above threshold → send path continues
     - when below threshold but reviser does not improve → needs_review (Slack) unchanged
     - hard blocks (`source === "hard_block"`) never attempt revision
     - kill-switch (`AUTO_SEND_REVISION_DISABLED=1`) skips revision entirely
   - ~~Email webhook regression test~~ **REMOVED (RT-01):** No webhook changes needed.
   - Run quality gates:
     - `npm test`
     - `npm run lint`
     - `npm run build`
     - `npm run db:push` (for new AIDraft fields)

## Output
- Revision integrated into `lib/auto-send/orchestrator.ts` via DI factory pattern
- ~~Email webhook route uses orchestrator~~ Already done (Phase 35); revision auto-propagates via orchestrator
- `AIDraft` schema extended with `autoSendRevised`, `autoSendOriginalConfidence` fields
- `AutoSendEvaluation` type extended with optional `source`, `hardBlockCode` fields
- AI Ops feed includes revision events (backend + UI)
- Tests covering the new revision loop, gating, and kill-switch

## Handoff
Once validated locally, ship with revision disabled by default (`AUTO_SEND_REVISION_DISABLED=1` in prod), then enable per environment once Slack review volume and confidence deltas look healthy.

