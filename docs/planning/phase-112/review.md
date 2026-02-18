# Phase 112 — Review

## Summary
- Shared `LeadContextBundle` builder (profile-based budgets + redaction) is implemented and wired into drafting, meeting overseer gate, auto-send evaluator, and followup/booking flows.
- Stats-only AI telemetry is persisted via `AIInteraction.metadata` with an allowlisted sanitizer and prompt-runner metadata plumbing.
- Confidence governance (policies, calibration runs, proposals, revisions/rollback) is implemented end-to-end, with a super-admin-only control plane UI and per-call inspector.
- Quality gates pass on the combined working tree (`npm run lint`, `npm test`, `npm run build`, `npm run db:push`).

## What Shipped
- Shared bundle + telemetry helpers:
  - `lib/lead-context-bundle.ts`
  - `lib/ai/openai-telemetry.ts`
  - `lib/ai/prompt-runner/runner.ts`
  - `lib/ai/prompt-runner/types.ts`
- Bundle consumers:
  - `lib/ai-drafts.ts`
  - `lib/meeting-overseer.ts`
  - `lib/auto-send-evaluator.ts`
  - `lib/auto-send-evaluator-input.ts`
  - `lib/followup-engine.ts`
- Prompt registry additions:
  - `lib/ai/prompt-registry.ts`
- Confidence governance:
  - `lib/confidence-policy.ts`
  - `lib/confidence-calibration.ts`
  - `actions/confidence-policy-actions.ts`
  - `actions/confidence-calibration-actions.ts`
- Rollout + inspector + UI:
  - `actions/lead-context-bundle-rollout-actions.ts`
  - `actions/ai-interaction-inspector-actions.ts`
  - `components/dashboard/confidence-control-plane.tsx`
  - `components/dashboard/admin-dashboard-tab.tsx`
- Schema:
  - `prisma/schema.prisma`
- Tests:
  - `lib/__tests__/confidence-policy.test.ts`
  - `lib/__tests__/lead-context-bundle.test.ts`
  - `lib/__tests__/openai-telemetry-metadata.test.ts`
  - `lib/__tests__/auto-send-evaluator-input.test.ts`
  - `scripts/test-orchestrator.ts`

## Verification

### Commands
- `npm run lint` — pass (warnings only) (2026-02-06 02:05:37 -0500)
- `npm test` — pass (2026-02-06 02:05:37 -0500)
- `npm run build` — pass (2026-02-06 02:05:37 -0500)
- `npm run db:push` — pass (already in sync) (2026-02-06 02:05:37 -0500)

### Notes
- Lint warnings are pre-existing (React hooks deps, `next/no-img-element`, etc.) and are not introduced by Phase 112 changes.
- `next build` reports CSS optimization warnings for certain `bg-[color:var(--token)]` classes; build still succeeds.
- Working tree contains uncommitted changes and new files (expected for in-progress merge/commit workflow).

## Success Criteria → Evidence

1. Drafting, meeting overseer gate, auto-send evaluator, and followup-engine all source knowledge + memory from the same LeadContextBundle builder.
   - Evidence:
     - Builder: `lib/lead-context-bundle.ts`
     - Drafting uses bundle when enabled: `lib/ai-drafts.ts`
     - Meeting overseer gate uses bundle memory when enabled: `lib/meeting-overseer.ts`
     - Auto-send evaluator uses bundle (profile `auto_send_evaluator`): `lib/auto-send-evaluator.ts`
     - Followup parse + booking gate use bundle (profiles `followup_parse`, `followup_booking_gate`): `lib/followup-engine.ts`
   - Status: met

2. Each `AIInteraction` row includes stats-only metadata describing bundle composition and truncation.
   - Evidence:
     - Schema: `prisma/schema.prisma` (`AIInteraction.metadata Json?`)
     - Allowlisted sanitizer: `lib/ai/openai-telemetry.ts` (`sanitizeAiInteractionMetadata`)
     - Prompt runner threads `metadata`: `lib/ai/prompt-runner/runner.ts`, `lib/ai/prompt-runner/types.ts`
   - Status: met

3. Auto-send evaluator input includes redacted lead memory and preserves existing keys (`service_description`, `goals`, `knowledge_context`, `verified_context_instructions`).
   - Evidence:
     - Additive field: `lib/auto-send-evaluator-input.ts` (`lead_memory_context`)
     - Wiring: `lib/auto-send-evaluator.ts`
     - Regression test: `lib/__tests__/auto-send-evaluator-input.test.ts`
   - Status: met

4. Followup-engine auto-book decisions are gated by a booking gate when enabled, and thresholds are configurable (no hardcoded 0.9).
   - Evidence:
     - Threshold resolution: `lib/confidence-policy.ts` + usage in `lib/followup-engine.ts`
     - Booking gate prompt + wiring: `lib/ai/prompt-registry.ts`, `lib/followup-engine.ts`
   - Status: met

5. Super-admin control plane exists inside Settings with per-workspace enable/disable, calibration runs, proposal approve/apply/rollback, and per-call telemetry inspector.
   - Evidence:
     - UI: `components/dashboard/confidence-control-plane.tsx` (mounted via `components/dashboard/admin-dashboard-tab.tsx`)
     - Actions: `actions/lead-context-bundle-rollout-actions.ts`, `actions/confidence-calibration-actions.ts`, `actions/confidence-policy-actions.ts`, `actions/ai-interaction-inspector-actions.ts`
   - Status: met

6. `npm run lint`, `npm run build`, `npm test` pass. If schema changed, `npm run db:push` completed.
   - Evidence: command results above
   - Status: met

## Plan Adherence
- Planned vs implemented deltas (if any):
  - Followup parse/gate telemetry fields were implemented as stats-only and persisted via `AIInteraction.metadata`; some metadata (e.g. `matchedAvailability`) is intentionally not persisted to avoid leaking message/body-derived details.
  - Followup parse/gate stats are written via a post-call `AIInteraction` update to avoid storing raw prompt I/O; this adds an extra DB write per call.

## Risks / Rollback
- Rollback levers:
  - Global kill-switch: `LEAD_CONTEXT_BUNDLE_DISABLED=1`
  - Per-workspace toggle: `WorkspaceSettings.leadContextBundleEnabled=false`
  - Per-workspace booking gate: `WorkspaceSettings.followupBookingGateEnabled=false`
  - Confidence policy rollback: revision rollback via `actions/confidence-policy-actions.ts`
- Primary risk: enabling overrides for newly-registered followup prompts could unintentionally apply existing `PromptOverride` rows (if any exist). Confirm none exist for `followup.parse_proposed_times.v1` before rollout.

## Follow-ups
- Decide whether followup booking gate should run for all auto-book paths (not just proposed-time matches).
- Consider eliminating post-call `AIInteraction` update writes by computing stats at call time when feasible.
- Optional: add a stricter “drafting context cap” if context-length issues are observed in production.
