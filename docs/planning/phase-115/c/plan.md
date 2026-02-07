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

1b. (Deferred) Add revision tracking fields to `AIDraft` schema (**RT-17**):
   - Not required for v1 success criteria; would require a real DB `db:push` and rollout coordination.
   - Operator visibility for v1 comes from:
     - AI Ops feed events (`auto_send.context_select`, `auto_send.revise`)
     - existing `AIDraft.autoSend*` fields + Slack review flow

2. Integrate revision into orchestrator path:
   - **Add `maybeReviseAutoSendDraft` to `AutoSendDependencies`** in `lib/auto-send/orchestrator.ts` (RT-06):
     - optional dep so existing callers/tests don’t break
     - default export binds it to `lib/auto-send/revision-agent.ts`
   - In `lib/auto-send/orchestrator.ts`, inside `executeAiAutoSendPath` (insertion point: after evaluation at ~line 268, before threshold check at ~line 270):
     - if `evaluation.source === "model"` AND `evaluation.confidence < threshold`:
       - call `deps.maybeReviseAutoSendDraft(...)`, passing `deps.evaluateAutoSend` as the re-evaluator
       - if revised draft returned:
         - **DB persistence already handled inside `maybeReviseAutoSendDraft`** (RT-09 — draft written to `AIDraft.content` before return)
         - update `context.draftContent = revisedDraft` (in-memory, for downstream send logic)
         - use revised evaluation for threshold check
       - if null returned: continue as today (needs_review path)
   - Ensure revision runs **before** delayed scheduling decisions, so the draft content is final for delayed jobs.
   - (No helper required) Dependency is optional; orchestrator tests cover revision gating explicitly.

~~3. Deduplicate email webhook auto-send implementation~~ **REMOVED (RT-01)**
   - The email webhook (`app/api/webhooks/email/route.ts`) was refactored in Phase 35 to enqueue `EMAIL_INBOUND_POST_PROCESS` background jobs.
   - The background job processor (`lib/background-jobs/email-inbound-post-process.ts`) already calls `executeAutoSend()`.
   - All 4 active `executeAutoSend()` call sites (email-inbound-pp, sms-inbound-pp, inbound-post-process/pipeline, delayed-auto-send) will automatically inherit the revision agent via the orchestrator integration in Work Item 2.
   - **No webhook-level changes needed.**

3. Telemetry + AI Ops visibility (renumbered from 4)
   - Update `AI_OPS_FEATURE_IDS` array in `actions/ai-ops-feed-actions.ts:28-36` to include:
     - `"auto_send.context_select"`
     - `"auto_send.revise"`
   - Extend AIInteraction metadata allowlist to include stats-only `autoSendRevision` (Phase 112 policy).
   - Ensure feed returns stats-only DTO (no prompt bodies/drafts).
   - Add UI filters for the new auto-send featureIds in the AI Ops panel.

4. Feature gating / safety levers (renumbered from 5)
   - Add env kill-switch for revision (in addition to global `AUTO_SEND_DISABLED`):
     - `AUTO_SEND_REVISION_DISABLED=1` disables selector/reviser steps while leaving evaluator behavior unchanged.
   - Ensure "fail closed" behavior:
     - any selector/reviser error falls back to existing needs_review behavior

5. Tests + validation (renumbered from 6)
   - Orchestrator unit tests:
     - when below threshold and reviser improves confidence above threshold → send path continues
     - when below threshold but reviser does not improve → needs_review (Slack) unchanged
     - hard blocks (`source === "hard_block"`) never attempt revision
     - kill-switch (`AUTO_SEND_REVISION_DISABLED=1`) skips revision entirely
   - ~~Email webhook regression test~~ **REMOVED (RT-01):** No webhook changes needed.
   - Run quality gates:
     - `npm test`
     - `npm run lint`
     - `npm run build`
     - `npm run db:push` (only if schema changes are introduced later)

## Output
- `lib/auto-send-evaluator.ts`: `AutoSendEvaluation` includes optional `{ source, hardBlockCode }` and deterministic branches are tagged as `source="hard_block"`.
- `lib/auto-send/orchestrator.ts`: AI_AUTO_SEND path attempts a single revision when below threshold (bounded + fail-closed).
- `lib/ai/openai-telemetry.ts`: allowlists stats-only `autoSendRevision` metadata.
- `actions/ai-ops-feed-actions.ts`: AI Ops feed includes `auto_send.context_select` + `auto_send.revise`.
- `components/dashboard/ai-ops-panel.tsx`: adds filters for the new featureIds.
- Tests + harness:
  - `lib/__tests__/auto-send-optimization-context.test.ts`
  - `lib/__tests__/auto-send-revision-agent.test.ts`
  - `lib/auto-send/__tests__/orchestrator.test.ts` (revision gating)
  - `lib/__tests__/openai-telemetry-metadata.test.ts` (allowlist)
  - `scripts/test-orchestrator.ts` updated to include new tests

## Handoff
Once validated locally, ship with revision disabled by default (`AUTO_SEND_REVISION_DISABLED=1` in prod), then enable per environment once Slack review volume and confidence deltas look healthy.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented hard-block tagging for the auto-send evaluator (`lib/auto-send-evaluator.ts`).
  - Integrated revision agent into the AI auto-send orchestrator path (`lib/auto-send/orchestrator.ts`).
  - Extended AIInteraction metadata allowlist + AI Ops visibility (`lib/ai/openai-telemetry.ts`, `actions/ai-ops-feed-actions.ts`, `components/dashboard/ai-ops-panel.tsx`).
  - Added/updated unit tests + test harness (`lib/auto-send/__tests__/orchestrator.test.ts`, `scripts/test-orchestrator.ts`).
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass (warnings only, pre-existing)
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Commit Phase 115 changes; optionally enrich AI Ops summary with revision confidence deltas (stats-only) if needed.
