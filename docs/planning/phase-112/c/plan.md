# Phase 112c — Wire LeadContextBundle into Auto-Send Evaluator (Include Redacted Memory)

## Focus
Wire the shared `LeadContextBundle` (profile `auto_send_evaluator`) into the auto-send evaluator so it evaluates drafts using:
- verified workspace context (service description/goals/knowledge assets)
- **redacted lead memory** (additive field)

Non-negotiables:
- keep `auto_send.evaluate.v1` prompt key stable (no bump)
- preserve evaluator payload key stability (existing keys must remain)
- bundle usage is gated via DB toggle + env kill-switch (112e)

## Inputs
- Bundle contract: `docs/planning/phase-112/a/plan.md`
- Shared builder (from 112b): `lib/lead-context-bundle.ts` (planned)
- Evaluator code:
  - `lib/auto-send-evaluator.ts` (`evaluateAutoSend`, `loadAutoSendWorkspaceContext`)
  - `lib/auto-send-evaluator-input.ts` (`buildAutoSendEvaluatorInput`)
  - `lib/auto-send/orchestrator.ts` (calls `evaluateAutoSend`)
- Tests:
  - `lib/__tests__/auto-send-evaluator-input.test.ts`

## Decisions (Locked 2026-02-06)
- Auto-send evaluator **includes redacted lead memory** when LeadContextBundle is enabled.
- No per-feature env toggle for memory inclusion. Rollout is controlled by:
  - `WorkspaceSettings.leadContextBundleEnabled` (super-admin controlled)
  - env kill-switch (global off)

## Work
1. Pre-flight repo reality check
   - Confirm current evaluator uses:
     - payload keys: `service_description`, `goals`, `knowledge_context`, `verified_context_instructions`
     - budgets: knowledge `8000`, per-asset `1600`, service desc `1200`, goals `900` (`lib/auto-send-evaluator-input.ts`)
   - Confirm `evaluateAutoSend()` uses prompt key `auto_send.evaluate.v1`.

2. Add LeadContextBundle resolution (gated + fallback)
   - When bundle is enabled:
     - Build `LeadContextBundle` with profile `auto_send_evaluator`.
     - Use bundle fields to populate evaluator “verified context” (service/goals/knowledge) and the new memory field.
   - On disable or failure:
     - Keep existing `loadAutoSendWorkspaceContext()` + existing input builder path (best-effort).
     - Do not block evaluation; fail “safe” to `requiresHumanReview=true` only when the evaluator itself fails, not when context enrichment fails.

3. Preserve evaluator payload key stability
   - Keep the existing top-level keys exactly:
     - `service_description`, `goals`, `knowledge_context`, `verified_context_instructions`
   - Add exactly one additive key:
     - `lead_memory_context` (redacted string or null)

4. Update `buildAutoSendEvaluatorInput()` to support memory (no shape breaking)
   - Add an optional `leadMemoryContext?: string | null` input (or a small wrapper) so the payload includes `lead_memory_context`.
   - Update the returned `stats` to include memory tokens estimate (stats-only).

5. Telemetry (stats-only)
   - When the bundle path is used, attach bundle composition stats to `AIInteraction.metadata.leadContextBundle`.
   - Do not include raw memory or knowledge text in metadata.

6. Tests (regression)
   - Update `lib/__tests__/auto-send-evaluator-input.test.ts`:
     - Assert the existing key set remains present.
     - Assert `lead_memory_context` is included when provided.
     - Assert no other top-level key changes are introduced.

## Validation (RED TEAM)
- `npm test` covers:
  - payload key stability (prevents silent prompt override breakage)
  - memory key inclusion (ensures feature is real)
- `npm run build` succeeds (TypeScript catches shape drift).

## Output
- Auto-send evaluator input is sourced from `LeadContextBundle` when enabled.
- Evaluator payload keys remain stable; `lead_memory_context` is additive only.
- Bundle composition stats are observable via `AIInteraction.metadata` (once 112d lands).

## Handoff
112d provides the telemetry metadata plumbing + confidence policy/proposal system, and 112g exposes evaluator bundle stats + policy controls in the super-admin UI.
