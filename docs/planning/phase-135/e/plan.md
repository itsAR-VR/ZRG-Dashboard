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
  - Implemented plan decisions in code:
    - Step 3 pricing contract updated to service-description-only matching in `lib/ai/prompt-registry.ts`.
    - Step 2 strategy/generation pricing policy bullets removed in `lib/ai-drafts.ts` (stylistic-only role).
    - Pricing hallucination source comparison aligned to `serviceDescription` only in `detectPricingHallucinations()`.
    - Rebase script replacement rule updated in `scripts/rebase-email-step3-pricing-override.ts`.
    - Unit tests updated in `lib/__tests__/ai-drafts-pricing-placeholders.test.ts`.
  - Rebased Founders Club Step 3 override content in production DB and preserved custom rules.
  - Finalized override base hash at `4c68c87622cc6dc9` to align with updated local Step 3 code hash for next deploy.
  - Executed additional runtime probe batches (`tmx_p135e_*`, `tmx_p135e2_*`, `tmx_p135e_hash_*`) and captured Step 3 runtime behavior.
  - Confirmed coordination context:
    - No functional overlap with active Phase 134 files.
    - Unrelated dirty-file overlap remains only in `docs/planning/phase-132/review.md`.
- Commands run:
  - `npm test -- lib/__tests__/ai-drafts-pricing-placeholders.test.ts` — pass
  - `npm run lint` — pass (existing warnings only)
  - `npm run build` — pass
  - `vercel --prod --yes --debug` — fail (`getaddrinfo ENOTFOUND api.vercel.com` from this environment)
  - Supabase SQL:
    - prompt override update + revision insert — pass
    - runtime probe lead/message/job inserts — pass
    - probe status + draft + interaction verification queries — pass
- Blockers:
  - Runtime acceptance remains blocked by production runtime alignment:
    - Step 3 interactions still record plain `promptKey = draft.verify.email.step3.v1` (no `ws_...` suffix), indicating workspace overrides are not currently applied in the active runtime path.
    - Under this runtime path, probe drafts still emit unsupported `$3,000`, so 3/3 clean acceptance cannot be proven yet.
    - Automated production deploy from this environment is blocked by DNS/network resolution to `api.vercel.com`.
- Next concrete steps:
  - Deploy current code changes so runtime uses updated Step 3 template resolution.
  - Re-run 3 fresh pricing probes and require 3/3 clean before closeout.
