# Phase 49c — Implement Step‑3 Verifier + Guardrails

## Focus

Add a final verifier pass after step‑2 draft generation that minimally edits the draft to correct rule violations and small logical errors, with strong guardrails and safe fallback behavior.

## Inputs

- Phase 49a contract
- Phase 49b prompt template + model config
- Existing draft generation implementation:
  - `lib/ai-drafts.ts:generateResponseDraft(...)`
  - `lib/ai-drafts.ts:sanitizeDraftContent(...)`
  - `lib/ai-drafts.ts:detectDraftIssues(...)`
  - `lib/ai/openai-telemetry.ts` (`runResponseWithInteraction`, `markAiInteractionError`)

## Work

- Implement a step‑3 verifier function (name TBD) that:
  - Builds the verifier input bundle (latest inbound message + injected context + step‑2 draft).
    - Latest inbound message source:
      - Prefer `opts.triggerMessageId` → fetch exact inbound `Message` body.
      - If absent → query the most recent inbound message for the lead (DB fallback).
  - Computes canonical booking link (for validation/replacement) using:
    - `lib/meeting-booking-provider.ts:getBookingLink(clientId, workspaceSettings)`
  - Calls the small model (`gpt-5-mini`) with low temperature + constrained max tokens.
  - Uses strict JSON output (prefer Responses `json_schema`) and parses safely.

- Time budget hardening:
  - Track elapsed time within `generateResponseDraft` and skip verifier if remaining time is low (especially when `opts.timeoutMs` is provided).
  - Optional: run verifier only when deterministic checks detect violations (em/en dashes, forbidden terms, suspicious URLs, repetition).
- Guardrails:
  - If JSON parse fails → fallback to step‑2 draft (and log).
  - If `finalDraft` exceeds rewrite thresholds (length delta, too many changed lines, missing required sections) → fallback (or set `needsHumanReview`).
  - Validate booking link:
    - Ensure canonical link is present if required.
    - Ensure no truncated URLs / placeholders.
    - If model changes the link, overwrite it with canonical (or fallback).
  - Deterministic punctuation cleanup:
    - Remove/replace em‑dashes even if the verifier misses them.
- Deterministic post-processing (always applied after verifier step):
  - `sanitizeDraftContent(...)` again (placeholders/truncated URLs)
  - em/en dash replacement normalization
- Ensure this step does not require full chat history:
  - Only pass the latest inbound message + deterministic context blocks.
- Decide where to store/verbalize changes:
  - Optional: attach `changes`/`violationsDetected` to `AIInteraction` metadata or logs for observability.

## Validation (RED TEAM)

- Confirm verifier runs after generation and before DB write:
  - `rg -n "sanitizeDraftContent\\(" lib/ai-drafts.ts`
  - `rg -n "prisma\\.aIDraft\\.create" lib/ai-drafts.ts`
- Confirm featureId/promptKey naming is stable and debuggable in telemetry (no PII in logs).

## Output

- Implemented `runEmailDraftVerificationStep3()` in `lib/ai-drafts.ts`:
  - Fetches latest inbound email via `triggerMessageId` or DB fallback query.
  - Calls `gpt-5-mini` with low temperature (0) and strict JSON schema.
  - Parses response and applies rewrite guardrails (`isLikelyRewrite`).
  - Logs violations/changes for observability.
  - Falls back to step 2 draft on parse failure, truncation, or rewrite detection.
- Implemented deterministic post-processing utilities in `lib/ai-drafts/step3-verifier.ts`:
  - `replaceEmDashesWithCommaSpace()` — em-dash replacement.
  - `enforceCanonicalBookingLink()` — placeholder/URL canonicalization.
- Wired step 3 into `generateResponseDraft()` for email channel:
  - Runs after step 2 generation, before final `sanitizeDraftContent`.
  - Time budget hardening: verifier gets up to 25% of remaining timeout.
  - Hard post-pass: em-dash + booking link enforcement always runs (even if verifier fails).

## Handoff

Subphase 49d adds regression fixtures and tests that lock the behavior.
