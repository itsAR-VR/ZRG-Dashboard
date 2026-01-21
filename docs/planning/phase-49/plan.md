# Phase 49 — Step-3 Draft Verification Pass

## Purpose

Add a lightweight “step 3” verification pass at the end of AI draft generation to correct logical errors and enforce formatting/rules (without materially rewriting the draft).

## Context

Step 2 draft generation is working as intended overall, but higher temperature/variance can introduce small, costly failures:

- Em-dashes (“—”) leaking into the final copy
- Wrong or malformed booking link (or the draft changing the link text/URL)
- Language/structure drift (repetition, forbidden terms, unintended rephrasing)
- Calendar/meeting-length inconsistencies (draft mutates durations or offered-slot framing)
- Date-logic misses that require the **latest inbound message** to evaluate (ex: lead requests “first week of February” and the draft responds incorrectly)

We want a final, low-temperature verification step using a smaller model (requested: **GPT‑5 mini medium**) that:

- Takes only the **minimum required context** (no full chat history)
- Always includes the **latest inbound message**
- Receives the same core prompt injections used for step 2 (forbidden rules, booking-process instructions, booking link, etc.)
- Produces either:
  - a minimally corrected final draft, or
  - “no changes needed”

This verifier should be wired into the same “prompt editability” infrastructure we recently added (prompt registry / editable prompt templates), so the verification prompt and its rules can be tuned without code changes.

## Locked Decisions

- Step 3 runs for **email only**.
- Step 3 runs **always** (not only-on-violation).
- Em-dash policy: replace `—` with `", "` (comma + single space). Run a deterministic post-pass after step 3; if any `—` remains, replace it.
- The “calendar lengths changing” issue is actually **calendar links** being mutated/hallucinated; step 3 must enforce the canonical booking link.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 47 | Complete/unknown (check working tree) | `lib/ai-drafts.ts`, prompt registry/snippets | Step 3 verifier prompt should be stored/overridable using the Phase 47 prompt system. |
| Phase 46 | Complete/unknown (check working tree) | `lib/ai-drafts.ts`, booking-process injection | Verifier must consume the same booking-process context (stage/wave/link rules) as step 2. |
| Phase 45 | Complete/unknown (check working tree) | `lib/ai-drafts.ts`, `lib/booking-process-instructions.ts` | Verifier must not regress booking-link sanitization and placeholder protections. |
| Phase 48 | ⚠️ Active/dirty in current working tree | background jobs + test runner scaffolding | Clean/merge before implementing Phase 49 to avoid unrelated conflicts. |

## Repo Reality Check (RED TEAM)

- Current working tree is dirty (modified background job files, `package.json`, planning docs; untracked test runner files). Start Phase 49 from a clean base before touching `lib/ai-drafts.ts` to avoid cross-phase merge noise.
- What exists today:
  - `lib/ai-drafts.ts:generateResponseDraft(...)`:
    - Email: multi-step strategy → generation, with **temperature 0.95** in generation (variation driver).
    - SMS/LinkedIn: uses `gpt-5-mini` + `reasoning.effort="medium"` and prompt overrides via `getPromptWithOverrides(...)`.
    - Post-processing: `sanitizeDraftContent(...)` currently removes booking-link placeholders + truncated URLs, but does **not** remove em-dashes.
  - Prompt editability:
    - `lib/ai/prompt-registry.ts:getPromptWithOverrides(...)` + Prisma models `PromptOverride` / `PromptSnippetOverride`.
    - Snippets live in `lib/ai/prompt-snippets.ts` (forbidden terms, email length rules, archetype overrides).
  - Booking link source of truth:
    - `lib/meeting-booking-provider.ts:getBookingLink(clientId, settings)` (Calendly vs GHL default CalendarLink).
    - Booking-process injection: `lib/booking-process-instructions.ts:getBookingProcessInstructions(...)`.
- Verified touch points:
  - `lib/ai-drafts.ts`: `generateResponseDraft`, `sanitizeDraftContent`, `detectDraftIssues`
  - `lib/ai/prompt-registry.ts`: `getPromptWithOverrides`, `getAIPromptTemplate`
  - `lib/ai/prompt-snippets.ts`: `getEffectiveForbiddenTerms`, `DEFAULT_FORBIDDEN_TERMS`
  - `lib/meeting-booking-provider.ts`: `getBookingLink`
  - `prisma/schema.prisma`: `PromptOverride`, `PromptSnippetOverride`

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Verifier becomes a “rewrite step” and changes tone/structure → Mitigation: strict diff/length guardrails + deterministic fallback to step‑2 draft.
- Webhook timeouts (extra OpenAI call) → Mitigation: small token budget + short timeout + skip verifier when time budget is low (or when no violations detected).
- “Latest inbound message” missing in regenerate flows (no `triggerMessageId`) → Mitigation: DB fallback query for the latest inbound message when `triggerMessageId` is absent.
- Booking link enforcement can be wrong (stage might not want a link, or link is null) → Mitigation: treat booking link rules as input-driven (only enforce canonical replacement, and only add when stage rules say to include).
- Pricing/fact hallucinations (wrong membership price/fees) → Mitigation: pass authoritative facts (service description + knowledge assets) to step 3 and require all numeric/proprietary claims to be supported; correct or remove unsupported claims.

### Missing or ambiguous requirements
- Should step 3 be allowed to add a booking link if the draft omitted it (and under what conditions)?
- How much context beyond “latest inbound” is allowed when the latest inbound references earlier messages (“that works”, “next week”, etc.)?

### Performance / timeouts
- Add explicit verifier budgets (small max output tokens) and a remaining-time check (especially in webhook/background-job contexts).

### Testing / validation
- Plan must lock behavior with unit tests that don’t hit OpenAI (mock model output), including the “first week of February” regression.

## Assumptions (Agent)

- Step‑3 verifier uses `gpt-5-mini` with `reasoning.effort="medium"` and **low temperature** for determinism (confidence ~90%).
  - Mitigation check: confirm desired model/effort for email verification vs SMS/LinkedIn parity.
- Verifier prompt is stored as a prompt template in `lib/ai/prompt-registry.ts` so it is workspace-overridable (confidence ~95%).

## Objectives

* [ ] Define the step‑3 verifier contract (inputs/outputs, “minimal edit” rules, failure/fallback behavior)
* [ ] Add an editable prompt template for verification (prompt registry + workspace overrides)
* [ ] Implement verifier call using small model + low temperature
* [ ] Add guardrails to prevent unintended rewrites (diff/length checks + booking-link validation)
* [ ] Add regression coverage using the provided “first week of February” example
* [ ] Add observability (log what was changed and why) and a safe rollout switch

## Constraints

- Must not require full conversation history; only include the latest inbound message plus small, deterministic context blocks.
- Must be **non-destructive**: only fix rule violations and clear logical errors; avoid stylistic rewrites.
- Must preserve correct booking link and not introduce placeholders/truncated URLs.
- Must remove em-dashes (and similar forbidden punctuation) deterministically.
- Must support prompt editability (verifier prompt + rule snippets live in the prompt registry / overrides).
- If verifier output is invalid/unparseable or looks like a rewrite, fall back to step 2 draft and flag for human review.
- Must be safe in tight-latency contexts (webhooks/background jobs): verifier must be skippable when time budget is low.

## Success Criteria

- [x] Drafts no longer contain em‑dashes after the final pass.
- [x] Booking link in the final draft is correct and not mutated/truncated.
- [x] Verifier does not materially rewrite drafts (length/diff guardrails hold).
- [x] Latest inbound message is always considered (regression test covers the "first week of February" case).
- [x] Step 3 is configurable (model + prompt template editable; rollout can be toggled).
- [x] `npm run lint` and `npm run build` pass.

## Open Questions (Need Human Input)

- None (locked decisions provided; remaining ambiguities are handled via guardrails + safe fallback).

## Subphase Index

* a — Audit pipeline + define verifier contract
* b — Add verifier prompt template + config
* c — Implement step‑3 verifier + guardrails
* d — Regression fixtures + tests
* e — Observability + rollout controls

## Phase Summary

### Shipped
- **Step 3 email draft verification** — A new `runEmailDraftVerificationStep3()` function in `lib/ai-drafts.ts` that minimally corrects email drafts after step 2 generation.
- **Deterministic post-processing** — `replaceEmDashesWithCommaSpace()` and `enforceCanonicalBookingLink()` in `lib/ai-drafts/step3-verifier.ts` ensure em-dashes are removed and booking links are canonical, even if the verifier fails.
- **Prompt template** — `draft.verify.email.step3.v1` added to `lib/ai/prompt-registry.ts` with workspace-override support.
- **Unit tests** — 4 passing tests in `lib/ai-drafts/__tests__/step3-verifier.test.ts`.

### Key Files
- `lib/ai-drafts.ts` — Main implementation (verifier function + integration into generateResponseDraft)
- `lib/ai-drafts/step3-verifier.ts` — Deterministic sanitization utilities
- `lib/ai/prompt-registry.ts` — Verifier prompt template
- `lib/ai-drafts/__tests__/step3-verifier.test.ts` — Unit tests

### Verified
- `npm run lint`: 0 errors (17 warnings, pre-existing)
- `npm run build`: Success
- Tests: 4/4 pass

### Notes
- Changes are uncommitted (working tree dirty). Ready for commit.
- No schema changes (no `db:push` required).
- No multi-agent conflicts detected (Phase 48 committed before Phase 49 work began).
