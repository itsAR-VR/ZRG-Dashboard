# Phase 128b — Pricing Consistency: Merge Service Descriptions + Block Placeholder Pricing

## Focus
Make AI responses to “How much does it cost?” consistent across leads/campaigns by ensuring the prompt always includes the best available pricing context, and by preventing placeholder pricing (`${PRICE}`, `$X-$Y`, etc.).

## Inputs
- Root context + evidence: `docs/planning/phase-128/plan.md`
- Screenshots from monday item `11211767137` showing mixed outputs:
  - Explicit pricing in one draft
  - Placeholder pricing in others (`${PRICE}`, `$X-$Y`)
- Persona resolution code: `lib/ai-drafts.ts:resolvePersona(...)`
- Prompt composition entrypoint: `lib/ai-drafts.ts:generateResponseDraft(...)`

## Work

### Step 1 — Merge `serviceDescription` at the call site (NOT inside `resolvePersona`)
**RED TEAM fix:** `resolvePersona()` returns early at line 563 when a persona exists — it never reads `settings.serviceDescription`. Merge must happen AFTER `resolvePersona()` returns.

In `lib/ai-drafts.ts`, after line 1469 (`const serviceDescription = persona.serviceDescription`):
```typescript
const settingsServiceDesc = settings?.serviceDescription?.trim() || null;
const mergedServiceDescription = mergeServiceDescriptions(persona.serviceDescription, settingsServiceDesc);
// Use mergedServiceDescription everywhere serviceDescription was used below
```

Add exported pure helper `mergeServiceDescriptions(a: string | null, b: string | null): string | null`:
- Trim both; if both empty/null → `null`
- If only one exists → use it
- If one contains the other (case-insensitive, whitespace-normalized) → keep the longer one
- Else → concatenate with `\n\n`

Replace all downstream usages of `serviceDescription` with `mergedServiceDescription` in `generateResponseDraft()`.

### Step 2 — Add "no pricing placeholders" instruction to ALL prompt builders
**RED TEAM fix:** Add to email, SMS, AND LinkedIn prompt builders (not just email).

In `buildEmailPrompt` (~line 729), `buildSmsPrompt` (~line 600), and `buildLinkedInPrompt` (~line 678), add to OUTPUT RULES:
```
Never use placeholders like ${PRICE}, $X-$Y, or made-up numbers for pricing. If pricing isn't explicitly present in the service description or offer context, ask one clarifying question and offer a call.
```

### Step 3 — Extend `sanitizeDraftContent()` with pricing placeholder detection + strip
**RED TEAM fix:** Replace the over-engineered "rewrite" with the established sanitization pattern.

Add to `lib/ai-drafts.ts` near existing placeholder regexes (line ~91):
```typescript
const PRICING_PLACEHOLDER_REGEX = /\$\{[A-Z_]+\}|\$[A-Z](?:\s*-\s*\$[A-Z])?(?![A-Za-z0-9])/;
const PRICING_PLACEHOLDER_GLOBAL_REGEX = /\$\{[A-Z_]+\}|\$[A-Z](?:\s*-\s*\$[A-Z])?(?![A-Za-z0-9])/g;
```

In `sanitizeDraftContent()` (line 185), add a pricing placeholder check after the existing booking link check:
```typescript
const hadPricingPlaceholders = PRICING_PLACEHOLDER_REGEX.test(result);
if (hadPricingPlaceholders) {
  result = result.replace(PRICING_PLACEHOLDER_GLOBAL_REGEX, "");
}
```
Log warning on strip (same pattern as booking link sanitization).

**Note:** This regex targets template-style `${PRICE}` and placeholder ranges like `$X-$Y` (but avoids matching real dollar amounts like `$5,000` because real prices have digits after `$`, not uppercase letters).

## Validation (RED TEAM)
- Confirm regex does NOT match: `$5,000/year`, `$500/month`, `$1,200`, `$0` (zero is a digit)
- Confirm regex DOES match: `${PRICE}`, `${COST}`, `${AMOUNT}`, `${PRICING_TIER}`
- Confirm merged `serviceDescription` appears in draft prompts when both persona and settings have values

## Expected Output
- Drafts stop producing `${PRICE}` / `$X-$Y` placeholder pricing when responding to cost questions.
- When pricing context exists, it is consistently available to the model due to merged `serviceDescription`.
- When pricing context does not exist, the draft asks for clarification instead of inventing numbers.

## Expected Handoff
Proceed to Phase 128c to add unit tests for:
- `mergeServiceDescriptions(...)` behavior
- placeholder detection + sanitization safety path

## Output
Implemented pricing consistency + placeholder hardening:
- `lib/ai-drafts.ts`
  - Added `mergeServiceDescriptions(primary, secondary)` and merged `persona.serviceDescription` with `WorkspaceSettings.serviceDescription` at the `generateResponseDraft()` call site.
  - Added explicit prompt guidelines (SMS, LinkedIn, Email) to never use pricing placeholders and to ask a clarifying question when pricing context is missing.
  - Added `PRICING_PLACEHOLDER_REGEX` and wired it into:
    - `detectDraftIssues()` (email generation retries when placeholders appear)
    - `sanitizeDraftContent()` (final safety net strips placeholders if they still leak through)

## Handoff
Proceed to Phase 128c to add unit tests for the merge + placeholder stripping behavior, then Phase 128d to run quality gates and update monday/Jam with results.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Wired pricing placeholder detection into email draft retry logic (`detectDraftIssues`) and final draft sanitization (`sanitizeDraftContent`).
  - Added unit tests for `mergeServiceDescriptions` + pricing placeholder stripping and registered them in the test orchestrator.
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - None
- Next concrete steps:
  - Update Phase 128c/128d plans with outputs and post the fix summary back to monday item `11211767137` (optionally populate the Jam Link column).
