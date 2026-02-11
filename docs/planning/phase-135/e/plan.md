# Phase 135e — Runtime Pricing Contract Alignment + Telemetry Adjudication

## Focus

Resolve the remaining runtime ambiguity after rebase: lock the canonical Founders Club pricing contract used for draft validation, then confirm whether negated unsupported prices (for example, "isn't $3,000") are allowed or must be stripped.

## Inputs

- Runtime evidence from 135d:
  - `AIDraft` `c0e81b48-87a1-4b54-b74d-7e29728bf50c` includes unsupported `$3,000` in negation form.
  - `AIDraft` `90d86286-b4fa-45e4-8920-847d37f08fe6` excludes `$3,000` but uses `$2,500/$25,000`.
- Existing phase assumptions in `docs/planning/phase-135/plan.md` still reference `$791/$9,500`.
- Current pricing guard rails:
  - Prompt-level Step 2 + Step 3 updates (completed in 135a/135b).
  - Code-level `detectPricingHallucinations()` telemetry (completed in 135c).

## Work

1. Confirm canonical pricing values with human decision (source-of-truth contract for Founders Club messaging).
2. Confirm policy for negated unsupported price mentions:
   - Option A: disallow any unsupported dollar value anywhere in final draft.
   - Option B: allow negated unsupported values when explicitly clarifying.
3. Compare chosen policy against current implementation behavior:
   - Validate whether current extraction/telemetry logic flags chosen policy violations.
   - If mismatch exists, define a targeted follow-up code patch (prompt + post-pass logic).
4. Run one final synthetic pricing-inquiry runtime probe against the locked contract and capture pass/fail evidence.

## Validation (RED TEAM)

- Query `AIDraft` + `AIInteraction` for the final probe lead/message and verify:
  - Allowed pricing values only (per confirmed contract).
  - No policy-violating unsupported dollar amounts.
  - `pricing_hallucination_detected` telemetry behavior matches policy expectations.
- Confirm no stale-hash drift for affected prompt keys if any additional prompt edits are applied.

## Output

## Handoff

## Progress This Turn (Terminus Maximus)
- Work done:
  - Completed deterministic pricing hardening in `lib/ai-drafts.ts`:
    - Added `isLikelyNonPricingDollarAmount()` helper and reused it in `extractPricingAmounts()` + `enforcePricingAmountSafety()`.
    - Wired `enforcePricingAmountSafety()` into `generateResponseDraft()` post-pass (after sanitize, before final pricing check/persistence) for `email` channel.
    - Added `pricingSafety` payload to final draft pipeline artifact for observability.
  - Expanded pricing tests in `lib/__tests__/ai-drafts-pricing-placeholders.test.ts`:
    - unsupported amount removal,
    - supported amount retention,
    - no-source clarifier injection,
    - non-pricing threshold (`$1M+`) preservation.
  - Performed post-deploy read-only runtime verification via Supabase SQL:
    - recent Step 3 interactions now show workspace prompt key suffix (`draft.verify.email.step3.v1.ws_202602110537`), confirming override resolution is active in production.
  - Confirmed coordination context:
    - Recent overlaps remain limited to prompt-editing phases (`129`, `131`) and shared `lib/ai-drafts.ts` work from prior phases.
    - No conflicting uncommitted changes detected in files touched this turn.
- Commands run:
  - `npm test -- lib/__tests__/ai-drafts-pricing-placeholders.test.ts` — pass
  - `npm run lint` — pass (existing warnings only)
  - `npm run build` — pass
  - Supabase SQL:
    - read-only Step 3 interaction query (`featureId='draft.verify.email.step3'`) — pass
- Blockers:
  - Final runtime closeout is blocked until the newly wired deterministic post-pass is confirmed in production and validated with fresh probes.
- Next concrete steps:
  - Confirm the latest deploy includes this exact `lib/ai-drafts.ts` deterministic patch.
  - Run 3 fresh pricing inquiry probes and require 3/3 final drafts with no unsupported dollar amounts.
  - If any probe still emits unsupported pricing, capture `AIDraft` + `AIInteraction.errorMessage` and decide whether to tighten post-pass cleanup or prompt guardrails further.
