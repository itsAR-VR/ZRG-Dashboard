# Phase 112b — Shared Context Builder + Drafting/Overseer Wiring

## Focus
Implement a shared context builder (per the 112a contract) and use it for:
- draft generation (`lib/ai-drafts.ts`)
- meeting overseer gate inputs (`lib/meeting-overseer.ts` + `lib/ai-drafts.ts` call site)

This is the minimum step to eliminate ad-hoc context assembly in the core reply pipeline.

## Inputs
- Phase 112a spec: `docs/planning/phase-112/a/plan.md`
- Existing code:
  - `lib/ai-drafts.ts`
  - `lib/meeting-overseer.ts`
  - `lib/lead-memory-context.ts`
  - `lib/knowledge-asset-context.ts`

## Work
1. Pre-flight conflict check
   - `git status --porcelain`
   - Re-read current versions of `lib/ai-drafts.ts` and `lib/meeting-overseer.ts` (recent phases touched them).

2. Implement shared builder module
   - Create something like `lib/lead-context-bundle.ts` (or `lib/context/lead-context.ts`).
   - Responsibilities:
     - Load and token-budget verified workspace context (serviceDescription/goals/assets).
     - Load and token-budget lead memory (optionally redacted).
     - Provide stable transcript formatting helpers (do not duplicate with sentiment transcript if avoidable).
     - Return both the bundle and token/byte stats.

3. Wire drafting to use shared context
   - Replace manual asset snippet assembly in `lib/ai-drafts.ts` with `buildKnowledgeContextFromAssets(...)` (or equivalent via the shared builder).
   - Ensure lead memory inclusion remains (same default budgets as current env vars).

4. Wire meeting overseer gate to use shared context
   - Pass the bundle’s “memory” (or a derived section) into `runMeetingOverseerGate`.
   - Ensure failure behavior stays non-fatal (Phase 109): gate exceptions must not block draft creation.

5. Add/adjust unit tests
   - Budgeting/truncation tests for new builder.
   - Regression tests ensuring:
     - Drafts still include lead memory when present.
     - Overseer gate still receives memory context when enabled.

## Output
- Shared builder module exists and is used by `lib/ai-drafts.ts`.
- Meeting overseer gate uses the shared bundle output for memory/context.
- Tests updated/added for the new builder and wiring.

## RED TEAM Refinements (added 2026-02-05)

### R-1: Builder must expose individual sections, not just a single string
The current SMS/email prompt builders (`buildSMSPrompt`, `buildEmailDraftStrategyInstructions`) accept `knowledgeContext`, `serviceDescription`, `aiGoals`, `availability`, etc. as **separate parameters**. The shared builder must return these as individual typed fields so callers can inject them into the right prompt slots. A single concatenated context string would break the prompt template structure.

Suggested return type:
```typescript
type LeadContextBundle = {
  serviceDescription: string | null;
  goals: string | null;
  knowledgeContext: string;        // formatted asset snippets
  memoryContext: string;           // formatted lead memory
  availability: string[];          // slot labels
  bookingLink: string | null;
  leadSchedulerLink: string | null;
  primaryWebsiteUrl: string | null;
  stats: { /* per-section token/byte stats */ };
}
```

### R-2: Swap out the 1000-char truncation in ai-drafts.ts for `buildKnowledgeContextFromAssets`
The plan says "replace manual asset snippet assembly" — specifically this is the `slice(0, 1000)` block at `ai-drafts.ts:1345-1358`. Replace it with `buildKnowledgeContextFromAssets({ assets, maxTokens, maxAssetTokens })` from `lib/knowledge-asset-context.ts` (already tested and used by auto-send evaluator). This is the single highest-value change in 112b.

### R-3: Add env-based kill switch for rollback safety
Implement `USE_SHARED_CONTEXT_BUILDER=1` (default on). If set to `0`, each consumer falls back to its original context assembly. This limits blast radius if the builder introduces regressions across all three consumers simultaneously. Remove after 1 week stable.

### R-4: Transcript formatting is out of scope — clarify
The builder should accept `conversationTranscript: string` as a pre-formatted input (callers already format this). Do NOT create a new transcript formatter — `lib/sentiment.ts:buildSentimentTranscriptFromMessages` is tightly coupled to `SentimentTranscriptMessage[]` and should not be duplicated.

### R-5: Overseer extraction stays lean (explicit non-goal)
`runMeetingOverseerExtraction` currently receives only `messageText` + `offeredSlots`. Unless 112a decides otherwise, do NOT wire the shared builder into extraction. Only the gate consumes the bundle's memory section.

### R-6: Validation step
After wiring, add a validation step: "Run the test suite, then manually verify with `npm run build` that no type errors exist. Check that `buildSMSPrompt` and `buildEmailDraftStrategyInstructions` still receive all required parameters via the shared builder."

## Handoff
Phase 112c wires the same shared context bundle into the auto-send evaluator input path so the judge sees the same aggregated facts.
