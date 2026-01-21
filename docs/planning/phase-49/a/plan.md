# Phase 49a — Audit Pipeline + Define Verifier Contract

## Focus

Identify the exact step‑2 draft generation flow and define the step‑3 verifier’s required inputs, output schema, and safety constraints (minimal edits, fallback rules).

## Inputs

- Phase 49 root context (failure modes + goals)
- Existing draft pipeline code:
  - `lib/ai-drafts.ts:generateResponseDraft(...)`
  - `lib/ai-drafts.ts:sanitizeDraftContent(...)`
  - `lib/ai-drafts.ts:detectDraftIssues(...)`
  - `lib/booking-process-instructions.ts:getBookingProcessInstructions(...)`
  - `lib/meeting-booking-provider.ts:getBookingLink(...)`
- Prior phases touching drafts/prompts: Phase 45–47
- The user-provided regression example (“first week of February”)

## Work

- Pre-flight conflict check:
  - Confirm `git status --porcelain` is clean before implementing Phase 49 (Phase 48 is currently dirty).
  - Scan recent phases for overlaps in `lib/ai-drafts.ts` and `lib/ai/prompt-registry.ts`.

- Map the current draft pipeline:
  - Where step 1 context is assembled (forbidden rules, booking-process injection, persona, etc.)
  - Where step 2 model call happens (model, temperature, response format)
  - Existing sanitization steps (booking link placeholder/truncation, etc.)
- Define the step‑3 verifier contract:
  - **Inputs** (minimum set):
    - Latest inbound message (required)
    - Booking link (canonical URL) + “link must not change” rule
    - Booking-process instruction block (stage/wave, time-offer framing, qualifying Qs)
    - Availability slots offered to the model (if any) + “do not invent/change” rule
    - Forbidden terms/rules block
    - Step‑2 draft text (candidate output)
  - **Outputs**:
    - Prefer strict JSON:
      - `finalDraft` (string)
      - `changed` (boolean)
      - `changes` (short list, optional)
      - `violationsDetected` (optional)
    - Decide whether to support a “block” outcome (ex: `needsHumanReview: true`) vs always returning text.
  - **Guardrails**:
    - Max allowed length delta / rewrite heuristics
    - Must preserve booking link exactly (or use canonical link substitution)
    - Must not change meeting length/time windows unless clearly correcting a contradiction with injected booking-process context
    - Must not invent availability not present in inputs
- Decide how to avoid full chat history:
  - Include only the latest inbound message plus small deterministic context blocks (no raw thread dump).
  - If date-logic requires more context, prefer extracting a short “conversation state” summary deterministically (not model-generated).
  - Use `triggerMessageId` when available to fetch the exact latest inbound message; otherwise define a DB fallback query (latest inbound `Message` for the lead).

## Validation (RED TEAM)

- Confirm insertion point and available context in code:
  - `rg -n "draftContent = sanitizeDraftContent" lib/ai-drafts.ts`
  - `rg -n "triggerMessageId" lib/ai-drafts.ts`
- Confirm booking link source:
  - `rg -n "export async function getBookingLink" lib/meeting-booking-provider.ts`
- Confirm prompt override plumbing exists (for Phase 49b):
  - `rg -n "getPromptWithOverrides" lib/ai/prompt-registry.ts`

## Output

- Verified insertion point: `generateResponseDraft` in `lib/ai-drafts.ts` after step 2 generation, before `sanitizeDraftContent`.
- Confirmed `triggerMessageId` is passed through to `generateResponseDraft` for latest inbound message lookup.
- Confirmed `getBookingLink` from `lib/meeting-booking-provider.ts` provides canonical booking link.
- Confirmed `getPromptWithOverrides` from `lib/ai/prompt-registry.ts` supports workspace-level prompt overrides.
- Defined step 3 verifier contract:
  - **Inputs**: latestInbound, availability, bookingLink, bookingProcessInstructions, serviceDescription, knowledgeContext, forbiddenTerms, draft
  - **Outputs**: JSON `{ finalDraft, changed, violationsDetected[], changes[] }`
  - **Guardrails**: max rewrite ratio, em-dash deterministic post-pass, canonical booking link enforcement

## Handoff

Subphase 49b uses the contract to define the verifier prompt + response format.
