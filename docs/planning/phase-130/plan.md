# Phase 130 — Per-Campaign "Skip Human Review" Toggle for Auto-Send

## Purpose

Add a per-campaign `autoSendSkipHumanReview` toggle that bypasses the AI evaluator's `requires_human_review` / `safeToSend` safety flag, allowing auto-send decisions to be governed solely by the confidence threshold. Hard blocks (opt-out, blacklist, automated reply) are always respected.

## Context

**Problem discovered via data investigation:**

All "AI Responses" campaigns for the Founders Club client have `autoSendConfidenceThreshold = 0`, yet every draft still triggers Slack approval notifications — even drafts with confidence scores of 0.86–0.90.

**Root cause:** The auto-send decision at `orchestrator.ts:437` uses a compound condition:

```typescript
if (evaluation.safeToSend && evaluation.confidence >= threshold)
```

The AI evaluator model returns `requires_human_review: true` for drafts that violate playbook voice rules (e.g., using "I" instead of "we", saying "thanks"). This makes `safeToSend = false` at `auto-send-evaluator.ts:43`:

```typescript
safeToSend = safe_to_send && !requires_human_review && confidence >= 0.01
```

When `safeToSend = false`, the threshold is completely bypassed — `false && true = false` — and the Slack notification path fires unconditionally. There is currently no way to override this from the UI.

**Evidence (today's AIDraft data):**

| Time  | Confidence | Threshold | Action       | Reason                                           |
|-------|-----------|-----------|--------------|--------------------------------------------------|
| 15:44 | 0.90      | 0         | needs_review | "Draft uses first-person 'I'... must use 'we'"   |
| 15:17 | 0.90      | 0         | needs_review | "Draft uses first-person 'I' and signs as Chris"  |
| 12:01 | 0.86      | 0         | needs_review | "Draft uses 'thanks' (no thank-yous)"             |

**Design decision:** Add a per-campaign boolean toggle (not a global override) so operators can opt specific campaigns into "threshold-only" mode while preserving the safety check as the default for all other campaigns.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 129 | Active (uncommitted) | `prisma/schema.prisma` | Schema change is additive (new field on `EmailCampaign`); no conflict with Phase 129's `WorkspaceSettings` changes |
| Phase 123 | Complete | `lib/auto-send/orchestrator.ts` (revision loop) | Our change is in the final decision block (line 437), downstream of the revision loop — no overlap |
| Phase 127 | Complete | Evaluator model/reasoning config | Independent; we don't change evaluator behavior, only the orchestrator's interpretation of its output |

## Objectives

* [x] Add `autoSendSkipHumanReview` Boolean field to `EmailCampaign` schema
* [x] Update orchestrator decision logic to bypass `safeToSend` when toggle is on (preserving hard blocks)
* [x] Expose the toggle in the Campaign Assignment UI with clear labeling
* [x] Wire through the pipeline so the field is fetched and passed to `executeAutoSend`
* [x] Add test coverage for the new toggle behavior

## Constraints

- Hard blocks (`source === "hard_block"`: opt-out, blacklist, automated reply, empty draft) MUST still be respected even with the toggle enabled
- Default value MUST be `false` (existing behavior unchanged for all campaigns)
- The toggle should only be editable when `responseMode === "AI_AUTO_SEND"`
- Follow existing patterns for server action save/return and UI component structure

## Success Criteria

- Setting `autoSendSkipHumanReview = true` on a campaign causes drafts with `confidence >= threshold` to auto-send even when the evaluator returns `requires_human_review: true`
- Hard-blocked drafts (opt-out, blacklist, automated reply) are still blocked regardless of the toggle
- `npm run build` passes with no type errors
- `npm run lint` passes
- Orchestrator test suite covers both toggle states

## Subphase Index

* a — Schema + types + orchestrator logic
* b — Server action + pipeline passthrough + UI toggle
* c — Tests + verification

## Phase Summary (running)
- 2026-02-10 — Added per-campaign `autoSendSkipHumanReview` toggle for AI auto-send (schema + orchestrator + pipeline + UI + tests); verified with `npm run db:push`, `npm test`, `npm run lint`, `npm run build`. (files: `prisma/schema.prisma`, `lib/auto-send/types.ts`, `lib/auto-send/orchestrator.ts`, `actions/email-campaign-actions.ts`, `lib/inbound-post-process/pipeline.ts`, `lib/background-jobs/email-inbound-post-process.ts`, `lib/background-jobs/sms-inbound-post-process.ts`, `components/dashboard/settings/ai-campaign-assignment.tsx`, `lib/auto-send/__tests__/orchestrator.test.ts`)

## Phase Summary
- Shipped:
  - Per-campaign toggle to ignore evaluator `safeToSend` (except hard blocks) and rely solely on confidence threshold for AI auto-send.
  - Campaign Assignment UI checkbox (AI auto-send only) with end-to-end persistence.
- Verified:
  - `npm run db:push` — pass
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
