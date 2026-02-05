# Phase 107b — Confidence Gate: Inject AI Personality + Knowledge Assets Context

## Focus
Update the AI auto-send evaluator so its “safe-to-send / needs review / confidence” decision can verify claims (e.g., pricing) against the workspace’s AI Personality + Knowledge Assets, eliminating false “no verified context” flags.

## Inputs
- Jam segment in **AI Needs Review** showing ~10% confidence and a reason about pricing without verified context.
- Evaluator path:
  - `lib/auto-send-evaluator.ts` (`evaluateAutoSend`)
  - `lib/auto-send/orchestrator.ts` (applies confidence threshold)
  - Prompt: `auto_send.evaluate.v1` in `lib/ai/prompt-registry.ts` (`AUTO_SEND_EVALUATOR_SYSTEM`)
- Workspace context sources:
  - Default persona: `AiPersona` (includes `greeting`, `signature`, `goals`, `serviceDescription`, etc.)
  - Knowledge Assets: `KnowledgeAsset.textContent` (via `actions/settings-actions.ts:getKnowledgeAssetsForAI()` or direct Prisma usage consistent with `lib/ai-drafts.ts`)

## Work (RED TEAM Refined)

### Step 1: Confirm current evaluator blind spots (verified)
- ✅ `evaluateAutoSend()` at `lib/auto-send-evaluator.ts:45-199` receives only:
  - `channel`, `subject`, `latestInbound`, `conversationHistory`, `categorization`, `automatedReply`, `draft`
- ❌ No `serviceDescription`, `goals`, or `knowledgeContext` — this is the root cause

### Step 2: Build a robust, token-budgeted context pack
- Implemented heuristic token counting (chars/4) + byte counts:
  - `lib/ai/token-estimate.ts`
- Implemented knowledge-asset context builder that:
  - computes per-asset `bytes` + `tokensEstimated`
  - builds a `[AssetName]` snippet pack within a token budget
  - reports total vs included assets (so we know what got dropped)
  - `lib/knowledge-asset-context.ts`
- Implemented evaluator input builder that:
  - truncates long fields by token estimate (conversation history keeps the *end*)
  - injects `service_description`, `goals`, `knowledge_context`
  - adds `verified_context_instructions` without bumping prompt versions
  - `lib/auto-send-evaluator-input.ts`

### Step 3: Load AI Personality + Knowledge Assets in the evaluator (no call-site changes)
- `lib/auto-send-evaluator.ts` now loads workspace context via Prisma:
  - campaign persona → default persona → workspace settings (back-compat)
  - all Knowledge Assets (ordered by most recently updated)
- The evaluator input now includes:
  - `service_description`, `goals`, `knowledge_context`
  - `verified_context_instructions` (keeps prompt key stable; doesn’t break overrides)

### Step 5: Keep prompt key as `auto_send.evaluate.v1`
- ⚠️ Do NOT bump to v2 — this would orphan existing `PromptOverride` records
- The prompt shape change is additive (new optional context fields), not breaking

### Step 6: Increase token budget (output/reasoning headroom)
- Increased `runStructuredJsonPrompt` output budget cap to reduce truncation risk when input is larger:
  - `max: 900 → 1600`, `retryMax: 2400`
  - increased overhead/outputScale slightly (reasoning tokens are counted in `max_output_tokens` for GPT‑5 family).

### Step 9: Add tests
- Added pure unit tests (no OpenAI/DB dependency):
  - `lib/__tests__/auto-send-evaluator-input.test.ts`
  - registered in `scripts/test-orchestrator.ts`

## Validation (RED TEAM)
- [ ] Evaluator receives non-empty context when workspace has AI Personality + Knowledge Assets configured
- [ ] Draft with pricing that matches Knowledge Asset does not return "missing verified context" reason
- [ ] Phase 97 regression: qualification questions still allowed (not flagged as unsafe)
- [ ] Token budget increase verified in AIInteraction telemetry

## Output
- Implemented evaluator context injection + token-budgeted input build:
  - `lib/auto-send-evaluator.ts`
  - `lib/auto-send-evaluator-input.ts`
  - `lib/knowledge-asset-context.ts`
  - `lib/ai/token-estimate.ts`
- Added tests:
  - `lib/__tests__/auto-send-evaluator-input.test.ts`
  - `scripts/test-orchestrator.ts`
- Prompt key remains `auto_send.evaluate.v1` (no v2 bump; existing overrides remain applicable).

## Handoff
- Phase 107c: UI should clearly communicate that the evaluator receives `service_description`, `goals`, `knowledge_context` dynamically (and show a preview).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented token estimator + knowledge asset context builder with per-asset bytes/tokens stats.
  - Updated `evaluateAutoSend()` to load AI Personality + Knowledge Assets and inject them into the evaluator input without changing call sites.
  - Increased evaluator output token budget to reduce truncation risk.
  - Added unit tests for the input builder and knowledge-asset budgeting.
- Commands run:
  - (pending) `npm test` — run during Phase 107d validation.
- Blockers:
  - Live verification requires a workspace with populated AI Personality + Knowledge Assets and an inbound that triggers auto-send evaluation.
- Next concrete steps:
  - Implement Phase 107c UI clarification (runtime context preview + token/bytes estimate).
  - Run `npm test`, `npm run lint`, `npm run build`.
