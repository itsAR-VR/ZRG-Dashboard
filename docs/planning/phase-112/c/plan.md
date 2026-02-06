# Phase 112c — Shared Context for Auto-Send Evaluator (and Other Gates)

## Focus
Wire the shared context bundle into:
- Auto-send evaluator input (`lib/auto-send-evaluator-input.ts` and/or `lib/auto-send-evaluator.ts`)

Goal: the evaluator (judge) should evaluate drafts against the same verified workspace context + lead memory policy used by drafting/overseer, eliminating “split brain” safety decisions.

## Inputs
- Phase 112a spec: `docs/planning/phase-112/a/plan.md`
- Shared builder from 112b
- Existing evaluator code:
  - `lib/auto-send-evaluator.ts`
  - `lib/auto-send-evaluator-input.ts`
  - `lib/auto-send/orchestrator.ts`

## Work
1. Pre-flight conflict check
   - Re-read evaluator code (Phase 107 introduced verified-context injection).

2. Decide and implement memory policy for evaluator
   - If including memory:
     - Use redacted memory context by default (avoid accidental PII amplification).
     - Keep budgets tight (memory should not dominate the evaluation payload).
   - If excluding memory:
     - Ensure the evaluator still receives all “verified workspace context” and thread context.

3. Integrate shared context bundle
   - Replace evaluator-specific workspace context loading (or make it call into the shared builder).
   - Keep the input payload shape stable unless a prompt update is explicitly planned.

4. Telemetry improvements
   - Store per-section stats from the shared bundle in logs/telemetry (without message bodies).
   - Ensure truncation is observable.

5. Tests
   - Update existing evaluator input tests to validate the shared builder integration.
   - Add a regression test to prevent reintroducing divergent context assembly.

## Output
- Auto-send evaluator input uses the shared context builder.
- Lead memory inclusion decision is implemented and documented.
- Tests updated.

## RED TEAM Refinements (added 2026-02-05)

### R-1: Preserve evaluator input payload key set exactly
Phase 107 deliberately injected `service_description`, `goals`, `knowledge_context`, and `verified_context_instructions` as top-level keys to avoid a prompt-key bump. The shared builder integration MUST preserve these exact key names in the evaluator payload. Add a regression test asserting the JSON payload contains these keys:
```typescript
expect(Object.keys(payload)).toContain("service_description");
expect(Object.keys(payload)).toContain("goals");
expect(Object.keys(payload)).toContain("knowledge_context");
expect(Object.keys(payload)).toContain("verified_context_instructions");
```

### R-2: Memory policy — document the decision in code, not just in plan
Whichever option is chosen (include redacted memory vs exclude), add a code comment in the evaluator call site explaining why, and add an ENV override (`AUTO_SEND_EVALUATOR_INCLUDE_MEMORY=0|1`) so the decision can be toggled without a deploy.

### R-3: `loadAutoSendWorkspaceContext` may become redundant
Currently `lib/auto-send-evaluator.ts:40-179` has its own `loadAutoSendWorkspaceContext()` that loads persona + assets. If the shared builder handles this, decide whether to (a) make the evaluator call the shared builder directly and remove `loadAutoSendWorkspaceContext`, or (b) have `loadAutoSendWorkspaceContext` delegate to the shared builder internally. Option (b) is safer for backward compat.

### R-4: Verify token budget alignment
The evaluator currently uses generous budgets (8000 tokens for knowledge, 1200 for service desc, 900 for goals). If the shared builder uses different defaults (e.g., the draft budget of ~1250 tokens for knowledge), the evaluator would see LESS context than before — a regression. Ensure 112c preserves or exceeds the current evaluator budgets by using a per-consumer profile.

## Handoff
Phase 112d builds the evaluation/calibration loop for confidence and proposes evidence-based thresholds.
