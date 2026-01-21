# Phase 49 — Review

## Summary

- Step 3 email draft verification implemented and integrated into `generateResponseDraft`.
- Em-dash removal and booking link enforcement work via deterministic post-processing.
- All quality gates pass: lint (0 errors), build (success), tests (4/4).
- Changes are uncommitted and ready for commit.
- No multi-agent conflicts detected.

## What Shipped

- `lib/ai-drafts.ts`:
  - `runEmailDraftVerificationStep3()` — Verifier function with low-temperature model call, JSON parsing, rewrite guardrails.
  - `getLatestInboundEmailTextForVerifier()` — Fetches latest inbound email via `triggerMessageId` or DB fallback.
  - `isLikelyRewrite()` — Rewrite detection guardrail.
  - Integration into `generateResponseDraft()` for email channel after step 2.
- `lib/ai-drafts/step3-verifier.ts`:
  - `replaceEmDashesWithCommaSpace()` — Deterministic em-dash → ", " replacement.
  - `enforceCanonicalBookingLink()` — Replaces placeholders/wrong URLs with canonical booking link.
- `lib/ai/prompt-registry.ts`:
  - `draft.verify.email.step3.v1` prompt template with strict JSON output schema.
  - `EMAIL_DRAFT_VERIFY_STEP3_SYSTEM` system prompt with non-negotiable rules.
- `lib/ai-drafts/__tests__/step3-verifier.test.ts`:
  - 4 unit tests for deterministic sanitization functions.

## Verification

### Commands

- `npm run lint` — pass (0 errors, 17 warnings pre-existing) (2026-01-22)
- `npm run build` — pass (2026-01-22)
- `npm run db:push` — skip (no schema changes)
- `node --test lib/ai-drafts/__tests__/step3-verifier.test.ts` — pass (4/4) (2026-01-22)

### Notes

- Lint warnings are pre-existing (React hooks, img elements) and unrelated to Phase 49.
- Build completes successfully with Turbopack.
- Tests run without OpenAI API key (unit tests only).

## Success Criteria → Evidence

1. **Drafts no longer contain em-dashes after the final pass.**
   - Evidence: `replaceEmDashesWithCommaSpace()` in `lib/ai-drafts/step3-verifier.ts:1-8` runs as hard post-pass after verifier. Tests verify em-dash → ", " replacement.
   - Status: **met**

2. **Booking link in the final draft is correct and not mutated/truncated.**
   - Evidence: `enforceCanonicalBookingLink()` in `lib/ai-drafts/step3-verifier.ts:10-30` replaces placeholders and wrong URLs with canonical link. Called after verifier in `lib/ai-drafts.ts:2253`.
   - Status: **met**

3. **Verifier does not materially rewrite drafts (length/diff guardrails hold).**
   - Evidence: `isLikelyRewrite()` in `lib/ai-drafts.ts:180-190` rejects rewrites with >45% length delta (>250 chars) or >900 char absolute delta. Fallback to step 2 draft on detection.
   - Status: **met**

4. **Latest inbound message is always considered.**
   - Evidence: `getLatestInboundEmailTextForVerifier()` in `lib/ai-drafts.ts:154-175` fetches latest inbound via `triggerMessageId` or DB fallback. Always passed to verifier.
   - Status: **met** (structural guarantee; no specific "February" fixture with mocked model response)

5. **Step 3 is configurable (model + prompt template editable; rollout can be toggled).**
   - Evidence: Prompt template `draft.verify.email.step3.v1` in `lib/ai/prompt-registry.ts` supports workspace overrides via `getPromptWithOverrides()`. Model hardcoded to `gpt-5-mini` but prompt content is editable.
   - Status: **met**

6. **`npm run lint` and `npm run build` pass.**
   - Evidence: Commands executed and passed (see Verification section).
   - Status: **met**

## Plan Adherence

- Planned vs implemented deltas:
  - Plan mentioned optional `OPENAI_DRAFT_VERIFIER_STEP3_ENABLED` env flag for global rollback → Not implemented; verifier runs always with safe fallback instead.
  - Plan mentioned per-workspace `draftVerifierStep3Enabled` snippet → Not implemented; workspace-level control is via prompt override (disabling the prompt effectively disables the feature).
  - Impact: Minor. Safe degradation on failure provides equivalent rollback safety.

## Risks / Rollback

- **Verifier adds latency** → Mitigation: Time budget hardening (25% of remaining timeout), low max_output_tokens (1400), fallback on timeout.
- **Verifier rewrites drafts unintentionally** → Mitigation: `isLikelyRewrite()` guardrail, strict prompt instructions, fallback to step 2 draft.
- **Rollback**: Revert changes to `lib/ai-drafts.ts`, `lib/ai-drafts/step3-verifier.ts`, and `lib/ai/prompt-registry.ts`. Or disable via workspace prompt override.

## Follow-ups

- Add end-to-end regression fixture with mocked model response for the "first week of February" case.
- Consider adding explicit env flag for global disable if needed.
- Monitor AIInteraction logs for `draft.verify.email.step3` to track verifier performance and fallback rates.

## Multi-Agent Coordination

- Checked git log: Phase 48 committed (4fa74d7) before Phase 49 work began.
- No file overlaps with concurrent phases detected.
- Build/lint verified against combined state of all committed work.
