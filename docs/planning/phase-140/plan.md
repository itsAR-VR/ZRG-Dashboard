# Phase 140 - Fix Pricing Omission + Cadence Drift (Knowledge Context + Billing Semantics)

## Purpose

Eliminate the pricing failure loop where valid pricing is generated from workspace context, then stripped by Step 3 and post-pass enforcement. At the same time, prevent cadence drift (for example, implying a monthly payment plan when billing is quarterly and only a monthly equivalent should be shown).

## Context

**Production signals (2026-02-11):**

1. Existing Founders Club cases in this phase show drafts omitting pricing entirely even when pricing is present in workspace knowledge context.
2. New report (Jam link provided by user: `3d46ecaf-1604-4f56-826a-fb74943c7d89`) adds cadence mismatch risk: pricing wording differs between monthly vs annual (and workspace-specific billing semantics).
3. User guidance locks a critical edge case:
   - A workspace may bill quarterly only.
   - Messaging may still present a monthly-equivalent amount.
   - Drafts must not imply a monthly payment plan when one does not exist.

## Locked Product Decisions

- `serviceDescription` is the canonical source when pricing/cadence conflicts exist.
- `knowledgeContext` is a valid pricing source only when `serviceDescription` is silent on that pricing fact.
- If cadence differs from a normalized display amount, copy must be explicit (for example: billed quarterly, equivalent monthly amount).
- If pricing or cadence is unsupported/ambiguous, remove unsupported claim and ask one clarifying pricing question.

## Repo Reality Check (RED TEAM)

- `lib/ai-drafts.ts`
  - `detectPricingHallucinations()` currently ignores `knowledgeContext`.
  - `enforcePricingAmountSafety()` currently validates against `serviceDescription` only.
  - Both functions are numeric-only and cadence-blind.
  - Email final post-pass currently calls `enforcePricingAmountSafety(draft, serviceDescription)`.
- `lib/ai/prompt-registry.ts`
  - `EMAIL_DRAFT_VERIFY_STEP3_SYSTEM` still enforces pricing from `<service_description>` only and explicitly ignores `<knowledge_context>`.
  - Rule text currently mentions monthly vs annual but does not cover quarterly billing semantics.
- `scripts/rebase-email-step3-pricing-override.ts`
  - Replacement text still reflects service-description-only behavior.
  - Patch strategy must be updated for the new Step 3 rule contract.
- `lib/__tests__/ai-drafts-pricing-placeholders.test.ts`
  - Existing tests assert old behavior (`knowledgeContext` ignored).
  - No cadence mismatch coverage exists.

## Concurrent Phases / Coordination

| Phase | Status | Overlap | Coordination |
|------|------|------|------|
| Phase 137 | Active (uncommitted) | `lib/ai-drafts.ts` | Serialize edits in `lib/ai-drafts.ts`; re-read file immediately before editing. |
| Phase 138 | Active (uncommitted) | `lib/ai-drafts.ts` | Pricing edits are in different sections but same file; apply by symbol, not line number. |
| Phase 139 | Active | `lib/ai-drafts.ts` | Same guard: avoid stale line references and preserve concurrent changes. |
| Phase 135 | Complete predecessor | `prompt-registry`, pricing tests, rebase script | This phase intentionally relaxes/extends the prior serviceDescription-only rule. |

**Pre-flight conflict checks required before each subphase implementation:**
- `git status --short`
- re-open touched files from disk (no cached assumptions)
- verify subphase changes are merged against current working-tree content

## Objectives

* [ ] Update Step 3 verifier prompt to enforce pricing against canonical source rules (`serviceDescription` first, `knowledgeContext` fallback when service description is silent)
* [ ] Extend pricing safety functions to use both sources with explicit precedence
* [ ] Add cadence-aware validation to prevent monthly/annual/quarterly semantic drift
* [ ] Update callsites and tests to the new source + cadence contract
* [ ] Update Founders Club Step 3 override rebase script to the new rule text
* [ ] Rebase workspace override after deployment and verify runtime prompt suffix + behavior
* [ ] Add evaluator/observability signals for pricing cadence mismatch

## Constraints

- Must not regress anti-hallucination behavior (unsupported dollar amounts are still stripped)
- Must preserve threshold exclusions (`$1M+`, raised/ARR contexts are not pricing)
- Must preserve Founders Club custom rules (rules 9-15) during override rebase
- Must keep Step 3 rewrite guardrail (+/- 15% length)
- Must support workspace billing semantics where billing cadence and display cadence differ
- Clarifier text must be cadence-safe (not hard-coded to monthly/annual when unsupported)
- `npm run lint` and `npm run build` must pass

## Success Criteria

- Drafts retain valid pricing from `knowledgeContext` when `serviceDescription` is silent
- If `serviceDescription` conflicts with `knowledgeContext`, final draft follows `serviceDescription`
- Cadence mismatch is caught (same amount with wrong cadence is corrected or removed)
- Quarterly billing workspaces do not emit false monthly-plan claims
- Rebased override is active (`promptKey` telemetry shows workspace suffix)
- Pricing tests cover source precedence, cadence mismatch, clarifier behavior, and threshold exclusions
- `npm run lint` and `npm run build` pass

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Numeric-only pricing checks can pass wrong cadence text when amount matches.
- Step 3 and safety layer currently disagree with evaluator trust model.
- Rebase script can appear successful while preserving stale pricing rule text.
- Concurrency in `lib/ai-drafts.ts` can silently drop pricing edits if merged by stale line ranges.

### Mitigations required in this phase
- Introduce cadence-aware structured pricing extraction/matching (amount + cadence + type).
- Enforce explicit source precedence (`serviceDescription` canonical).
- Update rebase script replacement/patch logic to match the new Step 3 pricing rule exactly.
- Add test matrix for monthly/annual/quarterly wording and conflict handling.
- Keep pricing-related edits atomic across prompt text, safety logic, and tests.

## Assumptions (Agent)

- `serviceDescription` is maintained as the workspace’s canonical offer contract. (confidence ~95%)
- Workspace-specific pricing semantics can be represented in prompt text and deterministic checks without schema changes in this phase. (confidence ~90%)
- Existing deployment flow from Phase 135d remains valid for override rebasing after base hash changes. (confidence ~95%)

## Open Questions (Need Human Input)

- [ ] For cadence mismatch, should the deterministic safety layer rewrite to supported cadence text when possible, or always strip and ask clarifier? (confidence < 90%)
  - Why it matters: rewrite gives better continuity; strip+clarify is safer but may reduce conversion.
  - Current default in this plan: strip unsupported pricing claim and ask one clarifying pricing question.

## Subphase Index

* a - Expand Step 3 Verifier Prompt + Rebase Script
* b - Expand Programmatic Pricing Validation Functions + Source Precedence
* c - Update Callsites + Cadence Test Coverage
* d - Apply Founders Club Override Rebase + Runtime Verification
* e - Add Cadence Guardrails to Evaluator + Observability
