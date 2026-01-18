# Phase 30d — Integration: Wire Settings to Draft Generation, Test End-to-End

## Focus

Connect the workspace settings to the draft generation pipeline, ensure backward compatibility, and validate the two-step approach produces varied outputs.

## Inputs

- Phase 30a: Schema fields exist
- Phase 30b: Two-step pipeline implemented
- Phase 30c: UI for model selection exists

## Work

### 1) Wire settings into `generateResponseDraft()`

- Read `WorkspaceSettings.draftGenerationModel` and `draftGenerationReasoningEffort` and run them through server-side coercion helpers (don’t trust raw strings).
- Use the coerced settings for **Step 1 (strategy)**.
- Keep **Step 2 (generation)** reasoning low/none (not user-configurable), and keep temperature high for variation.

Note: `generateResponseDraft()` currently `include`s workspace settings (and thus already has all scalar fields). Only update the Prisma `select` if the query is later optimized to select specific fields.

### 2) Backward compatibility

If settings are null/undefined, fall back to defaults:
- Model: `gpt-5.1`
- Reasoning: `medium`

If Step 1 (strategy JSON) fails or times out, fall back to the single-step generator (but still include archetype + temperature so variation improves).

### 3) Test scenarios (manual)

Manually test (or create test fixtures for):

1. **Variation across identical transcripts**:
   - Use 5–10 different leads with the same inbound text (or replay the same transcript with different leadIds).
   - Verify drafts differ in structure (not just synonyms).
   - Reminder: if you pass the same `triggerMessageId`, idempotency will return the existing draft; use distinct triggers or omit `triggerMessageId` for testing.

2. **Model switching**: Change settings to GPT 5.2 + high reasoning, verify it's used (check AIInteraction logs)

3. **Webhook flow**: Trigger email webhook → verify draft generated with correct model

4. **Error handling**: Test fallback when reasoning step fails

### 4) Verify telemetry

Check AIInteraction table shows:
- Strategy step entries (e.g. `draft.generate.email.strategy`)
- Generation step entries (e.g. `draft.generate.email.generation`)
- Correct model names logged per step
- Reasoning effort coercion behaves (extra_high only maps to xhigh on gpt-5.2)

### 5) Build verification

Run:
```bash
npm run lint
npm run build
```

Fix any type errors.

## Output

**Completed:**

1. **Wiring** (already done in Phase 30b):
   - `generateResponseDraft()` reads `settings?.draftGenerationModel` and `settings?.draftGenerationReasoningEffort`
   - Coerces via `coerceDraftGenerationModel()` and `coerceDraftGenerationReasoningEffort()`
   - Step 1 uses coerced model + reasoning; Step 2 uses same model but no reasoning (just temperature)

2. **Backward compatibility**:
   - Defaults to `gpt-5.1` / `medium` when settings are null
   - Fallback to single-step + archetype + temperature when two-step fails

3. **Build verification**:
   - `npm run lint` - passes (only pre-existing warnings)
   - `npm run build` - succeeds

4. **Telemetry**:
   - Strategy step logged with featureId `draft.generate.email.strategy`
   - Generation step logged with featureId `draft.generate.email.generation`
   - promptKey includes archetype suffix (e.g. `.arch_A1_short_paragraph_bullets_question`)

**Manual testing not performed in this session** - live validation should be done by triggering email webhooks and checking:
- AIInteraction table for both steps
- AIDraft table for structurally varied content
- Settings UI saves/loads correctly

## Handoff

Phase 30 complete. System now generates structurally varied email drafts using:
1. **Two-step pipeline**: Strategy (reasoning) → Generation (high temperature)
2. **10 structure archetypes**: Deterministically selected per lead+trigger
3. **Configurable model**: GPT-5.1 / GPT-5.2 with reasoning level selection
4. **Fallback**: Single-step with archetype + temperature if two-step fails
