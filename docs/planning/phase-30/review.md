# Phase 30 — Review

## Summary
- Shipped a two-step email draft pipeline (strategy JSON → high-variation generation) with deterministic structure archetypes.
- Added workspace-level model + reasoning settings for draft strategy (schema + actions + admin-gated Settings UI).
- All quality gates passed: `npm run lint`, `npm run build`, `npm run db:push`, `npx tsc --noEmit` (2026-01-17).
- End-to-end runtime validation (webhooks + AIInteraction rows + output variation) was not performed in this session.

## What Shipped
- `lib/ai-drafts.ts`: two-step email pipeline (Structured Outputs strategy + generation) with fallback path.
- `lib/ai-drafts/config.ts`: model/reasoning coercion + 10 email structure archetypes + deterministic selection.
- `lib/ai/prompt-registry.ts`: added `draft.generate.email.strategy.v1` and `draft.generate.email.generation.v1`.
- `prisma/schema.prisma`: added `WorkspaceSettings.draftGenerationModel` / `draftGenerationReasoningEffort`.
- `actions/settings-actions.ts`: plumbed settings fields + admin-gated updates.
- `components/dashboard/settings-view.tsx`: “Email Draft Generation” settings card (admin-gated).

## Verification

### Commands
- `npm run lint` — pass (17 warnings) (2026-01-17T14:50:15+03:00)
- `npm run build` — pass (2026-01-17T14:50:45+03:00)
- `npm run db:push` — pass (DB already in sync) (2026-01-17T14:51:11+03:00)
- `npx tsc --noEmit` — pass (2026-01-17T18:xx:xx+03:00, fixed pre-existing TS errors in `lib/conversation-sync.ts`)

### Notes
- `next build` warned about multiple lockfiles and deprecated middleware convention; build still succeeded.
- Lint warnings include unused eslint-disable directives in `lib/ai-drafts.ts` and `lib/ai/retention.ts` (non-blocking).

## Evidence

### git status (porcelain)
```text
 M README.md
 M actions/insights-chat-actions.ts
 M actions/settings-actions.ts
 M app/api/cron/insights/booked-summaries/route.ts
 M app/api/webhooks/calendly/[clientId]/route.ts
 M components/dashboard/settings-view.tsx
 M lib/ai-drafts.ts
 M lib/ai/prompt-registry.ts
 M lib/booking.ts
 M lib/followup-automation.ts
 M lib/ghl-api.ts
 M lib/insights-chat/chat-answer.ts
 M lib/insights-chat/citations.ts
 M lib/insights-chat/context-pack-worker.ts
 M lib/insights-chat/fast-seed.ts
 M lib/insights-chat/pack-synthesis.ts
 M lib/insights-chat/thread-extractor.ts
 M lib/insights-chat/thread-index.ts
 M lib/insights-chat/transcript.ts
 M lib/meeting-booking-provider.ts
 M prisma/schema.prisma
?? .mcp.json
?? CLAUDE.md
?? docs/planning/phase-28/
?? docs/planning/phase-29/
?? docs/planning/phase-30/
?? docs/planning/phase-31/
?? lib/ai-drafts/
?? lib/ghl-appointment-reconcile.ts
?? lib/insights-chat/message-classifier.ts
?? lib/insights-chat/message-response-type.ts
?? lib/meeting-lifecycle.ts
```

## Success Criteria → Evidence

1. Email drafts are structurally different even for identical lead responses.
   - Evidence:
     - `lib/ai-drafts/config.ts`: 10 explicit structure archetypes + deterministic selection.
     - `lib/ai-drafts.ts`: two-step strategy→generation, temperature set for generation step, archetype injected into prompts.
   - Status: partial (implementation present; needs manual validation with real leads/transcripts)

2. Model and reasoning level are configurable per workspace via Settings UI (admin-gated), with server-side coercion.
   - Evidence:
     - `prisma/schema.prisma`: `WorkspaceSettings.draftGenerationModel` / `draftGenerationReasoningEffort`.
     - `actions/settings-actions.ts`: returns/persists fields, admin-gated updates.
     - `components/dashboard/settings-view.tsx`: admin-gated UI controls with extra_high only on GPT-5.2.
     - `lib/ai-drafts/config.ts`: coercion helpers for invalid combos.
   - Status: met (code-level; runtime UX not exercised here)

3. Both strategy and generation steps are logged to `AIInteraction` (2 rows per email draft attempt).
   - Evidence:
     - `lib/ai/prompt-registry.ts`: distinct prompt templates/feature IDs for strategy + generation.
     - `lib/ai-drafts.ts`: uses `runResponseWithInteraction` for two distinct calls.
   - Status: partial (requires runtime verification in DB)

4. Existing draft generation continues to work via a safe fallback path.
   - Evidence:
     - `lib/ai-drafts.ts`: fallback to a single-step generator when strategy step fails.
   - Status: partial (requires runtime verification under failure conditions)

5. `npm run lint` + `npm run build` pass (no type errors).
   - Evidence:
     - `npm run lint` and `npm run build` succeeded on 2026-01-17.
     - `npx tsc --noEmit` passes (fixed pre-existing errors in `lib/conversation-sync.ts`).
   - Status: **met**

## Plan Adherence
- Planned vs implemented deltas (outside Phase 30 scope in this working tree):
  - `prisma/schema.prisma` also includes “Phase 28” appointment reconciliation fields/indexes.
  - `lib/ai/prompt-registry.ts` and `lib/insights-chat/*` include additional Insights Chat prompt/workflow changes.
  - Additional changes in calendly webhook/booking/meeting provider logic appear unrelated to Phase 30’s stated scope.

## Risks / Rollback
- Risk: two-step drafting increases latency and webhook timeout risk; mitigation is the timeout split + fallback, but needs real webhook timing validation.
- Risk: deliverability/variation goal not verified; needs manual testing against real lead patterns.
- Rollback: revert `lib/ai-drafts.ts`, `lib/ai-drafts/config.ts`, settings schema/UI changes; draft generation will return to the prior single-step behavior.

## Follow-ups

### Completed
- [x] Address `npx tsc --noEmit` failures — Fixed pre-existing TS errors in `lib/conversation-sync.ts` (unrelated to Phase 30).

### Pending Runtime Validation
Manual validation steps before considering Phase 30 fully validated:

1. **AIInteraction telemetry** — Trigger email draft generation and confirm:
   - Two `AIInteraction` rows per attempt: `draft.generate.email.strategy` + `draft.generate.email.generation`
   - Correct model names logged per step
   - Reasoning effort appears correctly (extra_high only for gpt-5.2)

2. **Structural variation** — Test with 5-10 leads receiving identical inbound text:
   - Verify drafts differ in structure (not just synonym swaps)
   - Check that different archetypes are selected for different leads
   - Use distinct `triggerMessageId` values or omit them entirely to get fresh archetypes

3. **Settings persistence** — In Settings UI:
   - Switch model from GPT-5.1 → GPT-5.2 and save
   - Verify `extra_high` reasoning becomes available only for GPT-5.2
   - Switch back to GPT-5.1 and verify `extra_high` downgrades to `high`
   - Confirm saved settings influence Step 1 model/reasoning (check AIInteraction)

4. **Fallback behavior** — Force a strategy step failure and verify:
   - Single-step fallback triggers
   - Archetype + temperature are still applied for variation
   - Draft is generated successfully

5. **Webhook timing** — Monitor email webhook responses:
   - Ensure two-step doesn't cause timeouts under normal conditions
   - Verify timeout split (40% strategy / 60% generation) keeps responses within budget
