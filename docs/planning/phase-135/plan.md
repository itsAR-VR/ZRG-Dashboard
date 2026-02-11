# Phase 135 — Fix AI Draft Pricing Hallucination

## Purpose

Eliminate hallucinated pricing in AI-generated email/SMS/LinkedIn drafts. The AI is inventing dollar amounts (e.g., "$3,000" for Founders Club) instead of using source-supported values. The fix strengthens both the generation prompt (Step 2) and verification prompt (Step 3), updates the Founders Club workspace override, and adds a programmatic pricing validation safety net with telemetry.

## Context

**Problem:** AI drafts for Founders Club (and potentially other workspaces) either omit pricing or hallucinate "$3,000" — a value that does NOT exist anywhere in the database. Knowledge assets include supported pricing references (historically `$791/month` and `$9,500/year`) that flow into the AI prompt as `knowledgeContext`, but recent runtime output shows additional values (`$2,500/$25,000`) that require contract confirmation before final closeout.

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

* [x] Strengthen Step 3 verifier default prompt to actively validate pricing
* [x] Update Founders Club workspace override with the stronger pricing rule (preserving custom rules 9-15)
* [x] Strengthen Step 2 generation prompt to require exact-match pricing
* [x] Add deterministic pricing safety net + telemetry after Step 3

## Constraints

- Step 3 is conservative by design — changes must be "tiny and localized" (the rewrite guardrail enforces +/- 15% length and will reject large rewrites)
- The pricing validation regex must NOT flag revenue thresholds ("$1M+ in revenue") as pricing
- Must not break existing tests in `lib/__tests__/ai-drafts-pricing-placeholders.test.ts`
- Founders Club workspace override must preserve all existing custom rules (9-15)
- The programmatic safety net must deterministically strip unsupported pricing amounts while preserving non-pricing tokens like revenue thresholds (for example `$1M+`)

## Success Criteria

- Regenerating a Founders Club draft where the lead asks about pricing uses only source-supported pricing values and does not emit unsupported amounts (for example `$3,000`) in the final saved draft content
- `npm run build` and `npm run lint` pass
- Existing pricing placeholder tests still pass
- Founders Club custom Step 3 rules (9-15) are preserved in their workspace override
- `AIInteraction` table logs `pricing_hallucination_detected` when a draft contains dollar amounts not in source material
- Founders Club `PromptOverride` for `draft.verify.email.step3.v1` is rebased and verified active under current `baseContentHash`

## Subphase Index

* a — Strengthen Step 3 pricing validation (code default + Founders Club override)
* b — Strengthen Step 2 generation prompt pricing guards
* c — Add programmatic pricing validation safety net with telemetry
* d — Apply + verify Founders Club override rebase in target environment
* e — Runtime pricing contract alignment + telemetry adjudication

## Repo Reality Check (RED TEAM)

- **Override drift is real:** Workspace/system prompt overrides are applied only when `baseContentHash` matches the current code default (`lib/ai/prompt-registry.ts:1684-1702`). Changing code defaults will temporarily disable existing overrides until they are re-saved (hash rebased).
- **Email Step 2 guard is not on the hot path:** The pricing guard at `lib/ai-drafts.ts:846` lives in `buildEmailPrompt()` which is used only for the **single-step fallback** when two-step email generation fails. The primary two-step generation uses `buildEmailDraftStrategyInstructions()` + `buildEmailDraftGenerationInstructions()` and currently has no “exact-match pricing” rule.
- **SMS/LinkedIn hot-path prompts come from the registry:** Runtime system instructions for SMS/LinkedIn come from `lib/ai/prompt-registry.ts` templates (`DRAFT_SMS_SYSTEM_TEMPLATE`, `DRAFT_LINKEDIN_SYSTEM_TEMPLATE`). The `buildSmsPrompt()` / `buildLinkedInPrompt()` pricing guardrails are fallbacks and do not protect the common path unless the registry template is missing.
- **Email strategy/generation prompt keys are suffixed:** Two-step email prompt keys are suffixed (`draft.generate.email.*.arch_*` / `.ai_select`) and do not resolve to prompt-registry templates. Prompt editing/overrides won’t affect them; Step 1/2 fixes must be code-level in `lib/ai-drafts.ts`.
- **Local script path is runtime-constrained:** standalone script execution in this environment hits local connectivity/import constraints (`DATABASE_URL` parsing + direct DB reachability + `server-only` import path). Production override apply was completed via Supabase SQL with equivalent update semantics and revision insertion.

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Prompt-editing drift on `draft.generate.sms.v1` / `draft.generate.linkedin.v1` overrides after template edits → workspace/system overrides may silently stop applying if `baseContentHash` is stale.
- Pricing contract drift after prompt-editing updates → plan assumes `$791/$9,500`, but fresh runtime output now shows `$2,500/$25,000` in one clean-path draft; without an explicit source-of-truth decision, validation can pass while business copy regresses.

### Missing or ambiguous requirements
- Runtime functional verification criterion (live draft regeneration path) is observational and requires a fresh Founders Club draft event; cannot be fully proven from static/unit checks alone.
- Runtime acceptance of the new deterministic post-pass requires a deploy that includes the latest `lib/ai-drafts.ts` changes; otherwise probe outcomes can still reflect pre-patch behavior.

### Repo mismatches (fix the plan)
- No remaining repo mismatch for subphase `a`/`d`: DB apply + revision were executed and verified for `draft.verify.email.step3.v1`.

### Security / permissions
- Override rebase requires write access to prompt override rows; execution must run only with proper DB credentials and in intended environment.

### Testing / validation
- Unit/build gates pass locally; DB verification confirms workspace override now has updated pricing rule + current `baseContentHash` + revision record.
- Runtime synthetic checks now include both:
  - Fail-case: draft still echoed unsupported `$3,000` in negation form.
  - Clean-case: draft avoided `$3,000` but introduced `$2,500/$25,000`, which conflicts with the phase's original pricing assumptions and requires source-of-truth adjudication.

### Multi-agent coordination
- Recent phase overlap confirmed with prompt-editing workstream (`phase-129`) and prompt-registry touches (`phase-131`); current changes align with drift model and avoid schema/action edits from those phases.
- Uncommitted unrelated change detected in `docs/planning/phase-132/review.md`; no overlap with Phase 135 code paths.

## Resolved Decisions (2026-02-11)

- Override rebase target: **production now**.
- Telemetry mode: keep `markAiInteractionError(..., { severity: "warning" })` for pricing hallucination signal.
- Prompt-editing continuity scope: proactively refresh **only affected workspace keys** if stale hashes exist for `draft.generate.sms.v1` / `draft.generate.linkedin.v1`.
- Pricing source of truth (Step 3): **`WorkspaceSettings.serviceDescription` only**.
- Negated unsupported prices: **disallow** (remove/replace; do not preserve).
- Step 2 role: **stylistic variance only** (no additional pricing policy logic).
- Runtime closeout threshold: **3/3 clean pricing probes**.

## Open Questions (Need Human Input)

- [ ] Confirm whether the most recent production deploy includes the deterministic `enforcePricingAmountSafety()` integration in `lib/ai-drafts.ts` (post-sanitize, pre-final persistence). (confidence ~70%)
  - Why it matters: current Step 3 override keys (`ws_...`) are active, but runtime probes can still show unsupported amounts if production is running code from before the deterministic post-pass wiring.
  - Current assumption in this plan: production still needs one deploy with this latest patch before final 3/3 clean runtime acceptance can be claimed.

## Assumptions (Agent)

- Applying `markAiInteractionError(..., { severity: "warning" })` is acceptable as an interim signal until a metadata-only warning path exists (confidence ~90%).
- Existing lint warnings are pre-existing and non-blocking for this phase (confidence ~95%).

## Validation Snapshot (2026-02-11)

- `npm test` — pass (313 tests, 0 failures)
- `npm run lint` — pass with existing warnings only
- `npm run build` — pass after fixing `generationInteractionId` scope in `lib/ai-drafts.ts`
- `vercel --prod --yes --debug` — fail from this environment (`getaddrinfo ENOTFOUND api.vercel.com`)
- Local rebase script path (dry-run) surfaced environment/runtime constraints:
  - dotenv parse issue from malformed `.env.local` quoting
  - Prisma local reachability (`P1001`) to production DB host
  - `server-only` import constraint when script depended on `prompt-registry` import
- Supabase SQL apply path — pass:
  - `PromptOverride` updated for Founders Club `draft.verify.email.step3.v1` (`updated_rows=1`)
  - `PromptOverrideRevision` inserted (`revision_rows=1`) with `createdByEmail='script:rebase-email-step3-pricing-override'`
  - Updated row has Step 3 service-description-only pricing rule active in content (`has_pricing_validation=true`, `has_legacy_pricing_line=false`)
  - Custom-rule phrases remain present (`video link`, `first-person singular`, `$1M+`, `far-future`)
  - Stale override checks for `draft.generate.sms.v1` / `draft.generate.linkedin.v1`:
    - workspace stale count: `0` for both
    - system stale count: `0` for both
- Runtime synthetic verification (production data path):
  - Lead `tmx_p135_990b87c86596dc91` + pricing-inquiry inbound message:
    - Draft `c0e81b48-87a1-4b54-b74d-7e29728bf50c` contains unsupported `$3,000` (negation form).
  - Lead `tmx_p135_dc04394582583679` + clean pricing-inquiry inbound message:
    - Draft `90d86286-b4fa-45e4-8920-847d37f08fe6` contains no `$3,000`, `$791`, or `$9,500`; generated pricing is `$2,500/$25,000`.
  - Background jobs completed successfully for both synthetic leads; one duplicate pending job row exists for the second message (`c184dedd-41a9-46b9-ae3c-99ebcb73e595`) and should be monitored for queue dedupe hygiene.
- Local implementation validation (current turn):
  - `lib/ai/prompt-registry.ts` updated Step 3 pricing rule to enforce `service_description`-only pricing and disallow negated unsupported amounts.
  - `lib/ai-drafts.ts` Step 2 strategy/generation pricing policy bullets removed; `detectPricingHallucinations()` now compares against `serviceDescription` only.
  - `lib/__tests__/ai-drafts-pricing-placeholders.test.ts` updated for service-description-only pricing source behavior.
  - `scripts/rebase-email-step3-pricing-override.ts` replacement text updated to the new Step 3 contract.
  - `npm test -- lib/__tests__/ai-drafts-pricing-placeholders.test.ts` — pass
  - `npm run lint` — pass with existing warnings
  - `npm run build` — pass
- Local deterministic hardening validation (latest turn):
  - `lib/ai-drafts.ts` now enforces `enforcePricingAmountSafety()` before final draft persistence for `email` channel.
  - Safety pass now preserves non-pricing thresholds (for example `$1M+`) using the same nearby-context heuristics as `extractPricingAmounts()`.
  - `lib/__tests__/ai-drafts-pricing-placeholders.test.ts` now covers:
    - unsupported amount removal,
    - supported amount retention,
    - no-pricing clarifier injection,
    - non-pricing threshold preservation.
  - `npm test -- lib/__tests__/ai-drafts-pricing-placeholders.test.ts` — pass (318 tests, 0 failures)
  - `npm run lint` — pass with existing warnings
  - `npm run build` — pass
- Runtime probe batches after Step 3 override content update:
  - Batch #1 (`tmx_p135e_*`): 3/3 jobs succeeded, but 2/3 drafts still emitted unsupported `$3,000`.
  - Batch #2 (`tmx_p135e2_*`): first completed draft still emitted `$3,000`; remaining jobs in flight at capture time.
  - Hash probe (`tmx_p135e_hash_*`): Step 3 interaction still logs plain `promptKey = draft.verify.email.step3.v1` (no `ws_` suffix), indicating workspace override is not currently applied in active runtime.
  - Override hash alignment notes:
    - Runtime probe checks were executed while testing `baseContentHash` candidates to detect active runtime hash behavior.
    - Final persisted hash is set to `4c68c87622cc6dc9` (code-aligned) for post-deploy correctness.
  - Latest read-only interaction check (post user deploy):
    - Recent Step 3 interactions now include `promptKey = draft.verify.email.step3.v1.ws_202602110537`, confirming workspace override resolution is active in production.

## Remaining Runtime Verification

- Pending final closeout dependency: confirm production deploy includes the latest deterministic post-pass (`enforcePricingAmountSafety()`), then rerun the required 3/3 clean pricing probes.

## Phase Summary (running)

- 2026-02-10 22:00 EST — Implemented pricing hallucination hardening across prompt defaults and draft builders, added final-draft pricing telemetry + tests, added override-rebase script for Founders Club Step 3 prompt, and resolved a TypeScript scope regression uncovered by build validation (files: `lib/ai/prompt-registry.ts`, `lib/ai-drafts.ts`, `lib/__tests__/ai-drafts-pricing-placeholders.test.ts`, `scripts/rebase-email-step3-pricing-override.ts`).
- 2026-02-10 22:00 EST — RED TEAM pass identified operational gap: Founders Club override rebase/verification is blocked by missing `DATABASE_URL`; appended subphase `d` for environment-scoped apply + verification and added prompt-editing continuity checks for SMS/LinkedIn overrides (files: `docs/planning/phase-135/plan.md`, `docs/planning/phase-135/d/plan.md`).
- 2026-02-11 04:05 UTC — Completed production Founders Club Step 3 prompt override rebase via Supabase SQL (hash + content + revision), verified custom-rule preservation, and confirmed no stale SMS/LinkedIn overrides requiring proactive refresh (files: `docs/planning/phase-135/plan.md`, `docs/planning/phase-135/d/plan.md`).
- 2026-02-11 04:40 UTC — Completed synthetic runtime pricing probes; observed mixed outcomes (`$3,000` negation persists in one draft, `$2,500/$25,000` appears in another), and appended subphase `e` to lock pricing source-of-truth + negation policy before final phase closeout (files: `docs/planning/phase-135/plan.md`, `docs/planning/phase-135/e/plan.md`).
- 2026-02-11 05:37 UTC — Implemented Step 3 service-description-only pricing contract in code + rebase script, aligned pricing telemetry source to workspace description, and executed additional production probe batches; runtime still logs plain Step 3 prompt keys (no workspace override suffix), so final 3/3 acceptance remains blocked pending runtime deployment alignment (files: `lib/ai/prompt-registry.ts`, `lib/ai-drafts.ts`, `lib/__tests__/ai-drafts-pricing-placeholders.test.ts`, `scripts/rebase-email-step3-pricing-override.ts`, `docs/planning/phase-135/plan.md`, `docs/planning/phase-135/e/plan.md`).
- 2026-02-11 06:35 UTC — Wired deterministic email pricing safety into final draft post-pass (`enforcePricingAmountSafety()`), added unit coverage for removal/clarifier/threshold-preservation cases, re-ran tests/lint/build, and updated runtime findings to note active Step 3 workspace override keys in production (files: `lib/ai-drafts.ts`, `lib/__tests__/ai-drafts-pricing-placeholders.test.ts`, `docs/planning/phase-135/plan.md`, `docs/planning/phase-135/e/plan.md`).
