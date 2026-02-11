# Phase 135 — Fix AI Draft Pricing Hallucination

## Purpose

Eliminate hallucinated pricing in AI-generated email/SMS/LinkedIn drafts. The AI is inventing dollar amounts (e.g., "$3,000" for Founders Club) instead of using the correct values from workspace configuration ($791/month, $9,500/year). The fix strengthens both the generation prompt (Step 2) and verification prompt (Step 3), updates the Founders Club workspace override, and adds a programmatic pricing validation safety net with telemetry.

## Context

**Problem:** AI drafts for Founders Club (and potentially other workspaces) either omit pricing or hallucinate "$3,000" — a value that does NOT exist anywhere in the database. The actual pricing ($791/month, $9,500/year) is stored in Knowledge Assets (TFC Prompt v2) and flows into the AI prompt as `knowledgeContext`.

**Root cause analysis (verified via DB queries):**
- `WorkspaceSettings.serviceDescription` for Founders Club contains NO pricing — just a club description
- `KnowledgeAsset` records contain correct pricing: "$791 per month" and "$9,500 annual membership"
- No record in the entire database contains "$3,000" as pricing
- The AI is **hallucinating** the amount

**Why existing safeguards fail:**
1. **Step 2 guard** (`lib/ai-drafts.ts:846`): Says "never use made-up numbers" but doesn't require exact-match verification against source material
2. **Step 3 verifier** — Both the code default (`lib/ai/prompt-registry.ts:240-241`) AND the Founders Club workspace override (`PromptOverride` table) have the same weak passive pricing rule: "only use values explicitly described as membership price/price/fee"
3. **Sanitizer** (`lib/ai-drafts.ts:100-221`): Only catches placeholder patterns (`${PRICE}`, `$X-$Y`) — intentionally preserves real-looking dollar amounts like `$3,000`

**Critical discovery — Workspace prompt overrides (Phase 47):**
Founders Club has a **custom `PromptOverride`** for `draft.verify.email.step3.v1` (last updated Feb 7) containing:
- The same weak pricing rule (rule 5) as the code default
- 7 additional custom rules (rules 9-15): no video link requests, $1M+ is a heuristic not pricing, no names on calls, no first-person singular, far-future handling, etc.
- If we ONLY change the code default, the hash drift detection will skip their override and fall back to the new code default — **losing their custom rules 9-15**

**Therefore we must update BOTH the code default AND the Founders Club workspace override.**

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 129 | Complete | Domain: prompt editing + overrides (`PromptOverride`, `SystemPromptOverride`) | Phase 135 changes must respect the flat drift model: overrides only apply when `baseContentHash` matches the current code default. Prefer `savePromptOverride()` / `saveSystemPromptOverride()` for DB updates so hashes + revision history stay aligned. |
| Phase 128 | Complete | File: `lib/ai-drafts.ts` (pricing placeholders, serviceDescription merge) | Preserve Phase 128 pricing placeholder hardening + existing tests. Phase 135 targets hallucinated *real-looking* dollar amounts (e.g., `$3,000`) and must not regress placeholder stripping behavior. |
| Phase 131 | Complete | File: `lib/ai/prompt-registry.ts` (sentiment prompt updates) | Re-read current `prompt-registry.ts` from HEAD before editing; keep changes localized to the Step 3 verifier + draft templates only. |
| Phase 134 | Active (uncommitted in working tree) | Files: `lib/meeting-overseer.ts`, tests | No intended overlap with Phase 135, but keep a strict pre-flight `git status` check before touching shared files. |

## Objectives

* [ ] Strengthen Step 3 verifier default prompt to actively validate pricing
* [ ] Update Founders Club workspace override with the stronger pricing rule (preserving custom rules 9-15)
* [ ] Strengthen Step 2 generation prompt to require exact-match pricing
* [ ] Add programmatic pricing validation with telemetry after Step 3

## Constraints

- Step 3 is conservative by design — changes must be "tiny and localized" (the rewrite guardrail enforces +/- 15% length and will reject large rewrites)
- The pricing validation regex must NOT flag revenue thresholds ("$1M+ in revenue") as pricing
- Must not break existing tests in `lib/__tests__/ai-drafts-pricing-placeholders.test.ts`
- Founders Club workspace override must preserve all existing custom rules (9-15)
- The programmatic safety net should log telemetry, not auto-strip (to avoid edge case breakage)

## Success Criteria

- Regenerating a Founders Club draft where the lead asks about pricing produces $791/month or $9,500/year — NOT $3,000
- `npm run build` and `npm run lint` pass
- Existing pricing placeholder tests still pass
- Founders Club custom Step 3 rules (9-15) are preserved in their workspace override
- `AIInteraction` table logs `pricing_hallucination_detected` when a draft contains dollar amounts not in source material

## Subphase Index

* a — Strengthen Step 3 pricing validation (code default + Founders Club override)
* b — Strengthen Step 2 generation prompt pricing guards
* c — Add programmatic pricing validation safety net with telemetry

## Repo Reality Check (RED TEAM)

- **Override drift is real:** Workspace/system prompt overrides are applied only when `baseContentHash` matches the current code default (`lib/ai/prompt-registry.ts:1684-1702`). Changing code defaults will temporarily disable existing overrides until they are re-saved (hash rebased).
- **Email Step 2 guard is not on the hot path:** The pricing guard at `lib/ai-drafts.ts:846` lives in `buildEmailPrompt()` which is used only for the **single-step fallback** when two-step email generation fails. The primary two-step generation uses `buildEmailDraftStrategyInstructions()` + `buildEmailDraftGenerationInstructions()` and currently has no “exact-match pricing” rule.
- **SMS/LinkedIn hot-path prompts come from the registry:** Runtime system instructions for SMS/LinkedIn come from `lib/ai/prompt-registry.ts` templates (`DRAFT_SMS_SYSTEM_TEMPLATE`, `DRAFT_LINKEDIN_SYSTEM_TEMPLATE`). The `buildSmsPrompt()` / `buildLinkedInPrompt()` pricing guardrails are fallbacks and do not protect the common path unless the registry template is missing.
- **Email strategy/generation prompt keys are suffixed:** Two-step email prompt keys are suffixed (`draft.generate.email.*.arch_*` / `.ai_select`) and do not resolve to prompt-registry templates. Prompt editing/overrides won’t affect them; Step 1/2 fixes must be code-level in `lib/ai-drafts.ts`.

## Open Questions (Need Human Input)

- Telemetry severity: when the safety net detects hallucinated prices, should we (A) mark the most relevant `AIInteraction` as `status="error"` via `markAiInteractionError(..., { severity: "warning" })`, or (B) implement a metadata-only “warning” log path to avoid inflating error counts? (confidence <90%)
