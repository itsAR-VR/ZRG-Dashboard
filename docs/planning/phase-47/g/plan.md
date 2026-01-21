# Phase 47g — Expand Variables: Email Length Rules + Archetypes

## Focus

Extend the “snippet/variable” override system beyond forbidden terms so **all prompt-building components** can be edited from the prompt modal, including:
- email length instruction template (and bounds if overridden)
- email draft structure archetype instructions

## Inputs

- Phase 47e: `PromptSnippetOverride` (per-workspace text overrides keyed by `snippetKey`)
- Email length rules: `lib/ai-drafts.ts` (`buildEmailLengthRules`, env bounds)
- Archetypes: `lib/ai-drafts/config.ts` (`EMAIL_DRAFT_STRUCTURE_ARCHETYPES`)

## Work

1. **Define canonical snippet keys + defaults (single source of truth in code):**
   - Create/update a server-only helper that returns a registry of editable variables:
     - `snippetKey`
     - label/description
     - type (`text`, `number`, `list`, `template`)
     - default value
     - placeholder variables supported by templates (if applicable)
   - Use this both for:
     - UI rendering (“nested UX” driven by schema)
     - runtime insertion/formatting

2. **Email forbidden terms (already MVP in 47e):**
   - Keep as a first-class list editor.
   - Ensure both:
     - Step 2 generation instructions
     - fallback single-step forbidden-terms message
     use the same effective value (override or default).

3. **Email length instructions (template + optional bounds overrides):**
   - Introduce snippet keys (examples; pick final names and document them in the helper):
     - `emailLengthRulesTemplate` (string template with `{minChars}` + `{maxChars}`)
     - `emailLengthMinChars` (int as string, optional override)
     - `emailLengthMaxChars` (int as string, optional override)
   - Runtime behavior:
     - If min/max overrides are not present → fallback to env defaults (current behavior).
     - Build the length block by rendering the template with the effective bounds.
     - Validate min/max sanity (`max > min`, clamp to safe floor/ceiling).

4. **Archetype instructions (editable per archetype):**
   - Keep archetype IDs stable for deterministic selection.
   - Allow overriding the **instructions** per archetype via snippet key:
     - e.g. `emailArchetype.${id}.instructions`
   - Runtime usage:
     - select archetype by seed (same as today)
     - apply override for the chosen archetype’s `instructions` if present

5. **Telemetry versioning (expand scope):**
   - Extend the “override version” suffix to include:
     - relevant `PromptOverride` rows
     - all snippet keys used for the prompt path (forbidden terms, length rules, archetype override)
   - Keep version derivation stable and compact (timestamp or short hash).

## Validation (RED TEAM)

- Default behavior unchanged when no overrides exist (diff generated prompts vs current output).
- Bad template edits don’t crash generation:
  - missing placeholders → show warning + fall back to default template for that snippet (or block save; decide and document)
  - invalid numeric bounds → reject save or clamp with warning

## Output

**Completed:**

1. **Expanded snippet registry** (`lib/ai/prompt-snippets.ts`):
   - Added `DEFAULT_EMAIL_LENGTH_RULES_TEMPLATE` — template with `{minChars}` and `{maxChars}` placeholders
   - Added `DEFAULT_EMAIL_LENGTH_MIN_CHARS` (220) and `DEFAULT_EMAIL_LENGTH_MAX_CHARS` (1200)
   - Added `DEFAULT_ARCHETYPE_INSTRUCTIONS` — map of archetype ID → instructions for all 10 archetypes
   - Expanded `SNIPPET_DEFAULTS` to include:
     - `forbiddenTerms`
     - `emailLengthRulesTemplate`
     - `emailLengthMinChars`
     - `emailLengthMaxChars`
     - `emailArchetype.{id}.instructions` for each archetype

2. **New helper functions** (`lib/ai/prompt-snippets.ts`):
   - `getEffectiveEmailLengthBounds(clientId)` — returns bounds with override priority: workspace → env → default
   - `buildEffectiveEmailLengthRules(clientId)` — builds the instruction block with substituted bounds
   - `getEffectiveArchetypeInstructions(archetypeId, clientId)` — returns override or default instructions

3. **Runtime integration** (`lib/ai-drafts.ts`):
   - Updated email draft pipeline to fetch overrides in parallel:
     - Forbidden terms
     - Email length rules (template + bounds)
   - Added archetype instructions override lookup
   - All generation paths now use effective values from overrides

**Note:** Telemetry promptKey versioning for these new overrides deferred to 47i.

**Verification:**
- `npm run lint` — passed
- `npm run build` — passed

## Handoff

Phase 47h expands the prompt modal UI to expose these new editable variables (email length, archetypes) and provide a master variables editor.
