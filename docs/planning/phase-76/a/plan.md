# Phase 76a — AI Signature/Footer Extraction + Prompt Injection

## Focus

Use AI to extract the important information from the trigger email’s signature/footer (scheduling links, key contact lines) and attach that distilled context to the email draft prompts. This prevents drafts from claiming a scheduling link “didn’t come through” when the link exists in the signature.

## Inputs

- Jam report: `c094f375-4eb0-4d55-af87-893facb67c91`
- Trigger message ID: `opts.triggerMessageId` passed into `generateResponseDraft(...)`
- Files:
  - `lib/email-signature-context.ts` (new AI extractor)
  - `lib/ai-drafts.ts` (wire extracted context into prompts)
  - `lib/ai/prompt-registry.ts` (prompt key registration for overrides)

## Work

### Step 1: Add a structured-output signature context extractor

**File:** `lib/email-signature-context.ts`

- Inputs: `rawText`/`rawHtml` from the trigger `Message`, expected sender name/email.
- Pre-processing:
  - strip quoted thread sections
  - clamp input to a tail slice (signatures are at the bottom)
  - detect and isolate a likely signature/footer candidate
  - extract a detected URL list and require the model to choose only from those URLs
- AI call:
  - `runStructuredJsonPrompt(...)` using Responses API `json_schema` (strict)
  - model: `gpt-5-nano` with `reasoningEffort: "minimal"`
  - output schema includes: name/title/company/email/phone/linkedin, `schedulingLinks`, `otherLinks`, `importantLines`, `confidence`
- Validation:
  - only accept `http(s)` URLs
  - only accept URLs present in the detected URL list (no invented links)

### Step 2: Wire the extractor into draft generation

**File:** `lib/ai-drafts.ts`

- When `channel === "email"` and `triggerMessageId` is present:
  - fetch trigger message by id (`rawText`, `rawHtml`)
  - call `extractImportantEmailSignatureContext(...)`
  - format the result to a short prompt block and pass it into:
    - `buildEmailDraftStrategyInstructions({ signatureContext })`
    - `buildEmailDraftGenerationInstructions({ signatureContext })`
- Prompt rule:
  - If the extracted context contains a scheduling link, do **not** claim it was missing.

### Verification

1. `npm run lint`
2. `npm run build`
3. Manual sanity check: a thread where the Calendly link is only present in the signature should not produce “we didn’t receive the link” phrasing.

## Output

- Trigger email signature/footer context is AI-extracted and injected into the email-draft prompt context.

## Handoff

Phase 76b enhances inbox UI link rendering using `rawHtml` link targets without displaying raw HTML code.
