# Phase 162e — Drafting Guardrails: Phone Context + “Don’t Ask Which Number” + No-PII Output

## Focus
Improve FC draft generation so it correctly leverages signature-derived phone context without leaking the phone number into outbound drafts, and without asking redundant questions like “Which number should we call?”.

## Inputs
- `docs/planning/phase-162/d/plan.md` (auto-send policy)
- Code:
  - `lib/ai-drafts.ts` (prompt builders, action-signal appendix)
  - `lib/background-jobs/email-inbound-post-process.ts` (signature extraction + lead updates)
  - Step 3 verifier prompt: `draft.verify.email.step3.v1` (as configured in `lib/ai/prompt-registry.ts`)

## Work
- Surface phone context to drafting safely:
  - Load `Lead.phone` in `generateResponseDraft()` and pass it into the strategy/generation system prompt as internal context.
  - Add explicit instruction: phone is internal; do not include in outbound draft; if phone exists do not ask “which number”.
- Strengthen no-PII outbound guarantee:
  - Add a hardening/guard step that blocks or removes phone numbers from the final draft text before persisting/sending.
  - Ensure auto-send evaluator hard-blocks if a phone number appears in the draft.
- Ensure Process 4 draft behavior is coherent even though auto-send skips:
  - Draft should be useful for a human to send if needed (e.g., “Got it, we’ll call you shortly” or “What time works best?”) but should not ask for a phone number if already known.
- Tests:
  - Add a fixture/test that when lead phone exists and action signal indicates call intent, the generated draft does not ask for the phone number and does not contain digits that match a phone.

## Output
- Draft quality is correct and safe even when signature is stripped from the inbound body used for generation.

## Handoff
- Proceed to 162f to run NTTAN validation and FC replays with a larger sample size.
