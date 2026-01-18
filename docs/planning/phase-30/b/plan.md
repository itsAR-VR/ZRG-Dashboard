# Phase 30b — Core: Two-Step Pipeline + Variation Archetypes

## Focus

Refactor `lib/ai-drafts.ts` so email draft generation runs as:
1. **Step 1 (Strategy)**: Strict JSON strategy/skeleton (Structured Outputs)
2. **Step 2 (Generation)**: High-variation email text (temperature + enforced structure archetype)

## Inputs

- Phase 30a completed:
  - `WorkspaceSettings.draftGenerationModel` / `draftGenerationReasoningEffort` exist
  - `actions/settings-actions.ts` returns/persists these fields
- Current single-step implementation: `generateResponseDraft()` in `lib/ai-drafts.ts`
- Telemetry: `runResponseWithInteraction`, `markAiInteractionError` in `lib/ai/openai-telemetry.ts`
- Token budgets: `computeAdaptiveMaxOutputTokens` in `lib/ai/token-budget.ts`
- Prompt registry: `lib/ai/prompt-registry.ts`
- Pattern to copy: strict JSON + parse + telemetry marking (see `lib/sentiment.ts`, `lib/signature-extractor.ts`)

## Work

### 0) Add runtime config coercion helpers

Add a small helper module mirroring `lib/insights-chat/config.ts`:
- **Option A (preferred, low-churn)**: Keep `lib/ai-drafts.ts` as-is, add a sibling folder `lib/ai-drafts/` with `config.ts`, and import via `@/lib/ai-drafts/config`.
  - Avoid adding `lib/ai-drafts/index.ts` (it can change module resolution for `@/lib/ai-drafts`).
- **Option B**: Create `lib/ai-drafts-config.ts` alongside the existing file.
- **Option C (higher churn)**: Convert `lib/ai-drafts.ts` to `lib/ai-drafts/index.ts` (requires updating imports across the repo).

Contents:
- `DRAFT_GENERATION_MODELS = ["gpt-5.1", "gpt-5.2"]`
- `coerceDraftGenerationModel(value)` → defaults to `"gpt-5.1"`
- `coerceDraftGenerationReasoningEffort({ model, storedValue })` → returns:
  - `stored` in `"low" | "medium" | "high" | "extra_high"`
  - `api` in `"low" | "medium" | "high" | "xhigh"` (extra_high maps to xhigh only for gpt-5.2; otherwise high)

Generation step reasoning should be fixed to low/none (not user-configurable) to keep budget for output text.

### 1) Add explicit structure archetypes (variation driver)

Define `EMAIL_DRAFT_STRUCTURE_ARCHETYPES` (8–12 variants) that *force different shapes*, not just wording:
- Examples: “1 short paragraph + bullets + question close”, “question-first opener”, “two-line opener + micro-story”, “direct scheduling ask first”, etc.
- Each archetype should include:
  - `id` (stable string)
  - `instructions` (concise, enforceable)

Pick the archetype deterministically per draft attempt:
- Compute once per `generateResponseDraft()` call (so internal retries don’t reshuffle structure).
- Use a seed:
  - When `triggerMessageId` is present: `${leadId}:${triggerMessageId}`
  - When `triggerMessageId` is null: `${leadId}:${draftRequestStartedAtMs}` where `draftRequestStartedAtMs = Date.now()` captured once at the start of the function (allows different archetypes on later regenerations/retries that call the function again).
- Hash the seed → select an archetype id.

Clarify ownership:
- Code selects the archetype id (deterministic, not model-dependent).
- Step 1 strategy can either (a) echo `structure_archetype_id` for validation, or (b) omit it entirely and rely on the code-selected archetype. If you keep it in the schema, treat mismatches as a post-process error and override to the code-selected id.

This keeps variation even if `temperature` is unsupported by the model.

### 2) Expand the lead context available to prompts

Today `generateResponseDraft()` only selects `firstName`. For personalization + variation, include (at least for email):
- Lead: `lastName`, `email`, `companyName`, `companyWebsite`, `companyState`, `industry`, `employeeHeadcount`, `linkedinUrl`
- Keep existing workspace context: persona, goals, service description, qualification questions, knowledge assets

Important: disambiguate **our company** (`WorkspaceSettings.companyName`) vs **lead company** (`Lead.companyName`) in prompt labels.

### 3) Step 1: Strategy call (Structured Outputs JSON)

Add `buildEmailDraftStrategyInstructions()` and request strict JSON with `text.format: { type: "json_schema", strict: true, schema }`.

JSON schema (v1) should include only what generation needs:
- `structure_archetype_id` (string)
- `personalization_points` (array of short strings)
- `intent_summary` (string)
- `scheduling_plan` (e.g., `should_offer_times`, `times_to_offer`), derived from already-computed availability
- `outline` (array of short “section intent” bullets)
- `must_avoid` (array)

Structured Outputs note (RED TEAM): OpenAI `json_schema` requires `required` to include *every* key in `properties` (no optional keys). Use `null` for “not present”, and set `additionalProperties: false`.

Use:
- `model`: coerced workspace model
- `reasoning`: coerced workspace reasoning effort (from settings)
- Conservative `max_output_tokens` (strategy should stay small)

Parse JSON robustly; on parse/shape failure:
- call `markAiInteractionError(interactionId, ...)`
- fall back to single-step generation (see below)

### 4) Step 2: Generation call (high variation text)

Add `buildEmailDraftGenerationInstructions()` that:
- Reuses existing `buildEmailPrompt()` hard rules (opt-out => empty, no subject, forbidden terms, scheduling rules)
- Injects:
  - chosen `structure_archetype` instructions
  - a compact summary of the strategy JSON
- Sets:
  - `temperature` high (e.g. `0.9–1.1`) for variation (telemetry layer already retries without temperature if unsupported)
  - reasoning effort low/none

### 5) Budgets + webhook resilience

Two-step doubles OpenAI calls; keep it safe in webhook contexts:
- Compute `max_output_tokens` separately for Step 1 and Step 2 (adaptive budgets).
- Consider splitting `opts.timeoutMs` across the two calls (e.g. ~40% strategy / 60% generation) so a tight webhook timeout doesn’t become 2× slow.
- Keep existing “retry on max_output_tokens” behavior for Step 2.
- Step 1 can retry once with more headroom only when JSON is truncated.

### 6) Telemetry + prompt registry updates

Add prompt templates in `lib/ai/prompt-registry.ts` for observability:
- `draft.generate.email.strategy.v1` → featureId `draft.generate.email.strategy`
- `draft.generate.email.generation.v1` → featureId `draft.generate.email.generation`

Use these keys in `generateResponseDraft()`. (Optional: suffix promptKey with archetype id for analysis, e.g. `.arch_A3`.)

### 7) Fallback behavior

If Step 1 fails:
- Run a single-step email generation using the existing prompt rules, but still include:
  - a chosen archetype
  - high temperature (where supported)

This ensures Phase 30 still improves variation even under failures.

## Output

**Completed:**

1. **Config module** (`lib/ai-drafts/config.ts`):
   - `DRAFT_GENERATION_MODELS` and `DRAFT_GENERATION_EFFORTS` constants
   - `coerceDraftGenerationModel()` - defaults to "gpt-5.1"
   - `coerceDraftGenerationReasoningEffort()` - returns `{ stored, api }` with proper xhigh mapping
   - `EMAIL_DRAFT_STRUCTURE_ARCHETYPES` - 10 distinct structural patterns for email variation
   - `selectArchetypeFromSeed()` - deterministic archetype selection via hash
   - `buildArchetypeSeed()` - creates seed from leadId + triggerMessageId (or timestamp)

2. **Prompt registry** (`lib/ai/prompt-registry.ts` lines 692-716):
   - Added `draft.generate.email.strategy.v1` template
   - Added `draft.generate.email.generation.v1` template

3. **Core pipeline** (`lib/ai-drafts.ts`):
   - Added imports for config module and `runResponseWithInteraction`
   - Added `EMAIL_DRAFT_STRATEGY_JSON_SCHEMA` for Structured Outputs
   - Added `buildEmailDraftStrategyInstructions()` - Step 1 prompt builder
   - Added `buildEmailDraftGenerationInstructions()` - Step 2 prompt builder
   - Added `parseStrategyJson()` - robust JSON parsing with validation
   - Expanded lead query to include: lastName, email, companyName, companyWebsite, companyState, industry, employeeHeadcount, linkedinUrl
   - Implemented two-step email pipeline (lines 751-975):
     - Step 1: Strategy (Structured Outputs JSON, workspace model/reasoning)
     - Step 2: Generation (temperature 0.95, archetype instructions)
     - Fallback: Single-step with archetype + high temperature
   - SMS/LinkedIn unchanged (single-step, lines 977-1133)
   - Timeout split: 40% strategy / 60% generation
   - Telemetry: separate featureIds for strategy vs generation, archetype suffix in promptKey

4. **Type check and lint**: Passes with no new errors

## Handoff

Phase 30c adds the Settings UI controls for model/reasoning selection. Phase 30d validates end-to-end across webhooks and checks AIInteraction logs for both steps.
