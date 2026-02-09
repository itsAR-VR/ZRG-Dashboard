# Phase 119a — Consolidate + Validate + Commit Fix Set

## Focus
Turn the current working-tree changes (Insights truncation + Step 3 verifier guardrail hardening) into clean, reviewable commits with tests wired into `npm test`.

## Inputs
- Current git working tree modifications (must be reviewed and either kept or reverted deliberately):
  - `lib/insights-chat/thread-extractor.ts`
  - `lib/insights-chat/chat-answer.ts`
  - `lib/ai/prompt-runner/types.ts`
  - `lib/ai/prompt-runner/runner.ts`
  - `lib/ai/openai-telemetry.ts`
  - `lib/ai-drafts.ts`
  - `lib/ai/prompt-registry.ts`
  - `lib/ai-drafts/step3-verifier.ts`
  - `lib/ai-drafts/step3-guardrail.ts`
  - `lib/ai-drafts/__tests__/step3-verifier.test.ts`
  - `lib/ai-drafts/__tests__/step3-guardrail.test.ts`
- Prior art:
  - Phase 109: Insights extractor budget tuning (`docs/planning/phase-109/plan.md`)
  - Phase 104/100: Step 3 verifier model + reasoning constraints (historical reference; do not re-open model selection defaults)

## Work
1. Review diffs for correctness and scope control:
   - Ensure no unrelated files are included.
   - Ensure defaults remain safe (no new waits by default; new env knobs default to no-op).
   - `retryExtraTokens` semantics are now implemented in prompt-runner attempt expansion (`lib/ai/prompt-runner/attempts.ts`) and covered by unit tests.
2. Wire Step 3 tests into the repo test harness (**HARD PREREQUISITE — GAP-1**):
   - Add the new test files to `scripts/test-orchestrator.ts` so `npm test` executes them:
     ```
     "lib/ai-drafts/__tests__/step3-verifier.test.ts",
     "lib/ai-drafts/__tests__/step3-guardrail.test.ts",
     ```
   - **This must happen before step 3** — without it, `npm test` passes silently without exercising Step 3 logic, giving false confidence.
3. Extend guardrail test coverage (recommended — **GAP-3**):
   - Add at least 2–3 boundary-condition tests to `step3-guardrail.test.ts`:
     - Input exactly at threshold values (ratio = 0.45, delta = 250)
     - Line-only changes without character delta exceeding threshold
     - Empty string / identical string inputs (should never flag as rewrite)
4. Validate locally (must pass before commit):
   - `npm test`
   - `npm run lint`
   - `npm run build`
5. Commit in a clean sequence (suggested split; adjust only if it reduces conflict risk):
   1. Prompt runner + telemetry metadata changes
   2. Insights budgets + call-site tuning
   3. Step 3 verifier hardening + tests + harness wiring
   - Note: commits cannot be created inside this sandbox (no `.git/` write access). Commit from a normal dev environment/CI.

## Rollback
`git revert` the commit series. No Prisma migrations to undo. All changes are additive code; no schema or data changes.

## Output
- Working tree changes are consolidated and validated:
  - `npm test` passes (Step 3 verifier + guardrail tests included; prompt-runner attempt-expansion tests included).
  - `npm run lint` passes (warnings only).
  - `npm run build` passes.
  - Commit creation is blocked in this sandbox due to `.git/` write restrictions.

## Handoff
Proceed to Phase 119b to deploy and verify in production using AI Dashboard + cron smoke checks. Deployment must be executed from an environment with outbound DNS/network access (Vercel CLI/GitHub are unreachable here).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Confirmed Phase 119 fix set is limited to intended files and is build-safe.
  - Wired Step 3 tests into `npm test` and expanded guardrail coverage.
  - Implemented real `retryExtraTokens` semantics via `lib/ai/prompt-runner/attempts.ts` + unit tests.
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - Cannot commit in this sandbox: `.git/` is not writable.
  - Cannot deploy from this sandbox: outbound DNS fails (e.g. `api.vercel.com` ENOTFOUND).
- Next concrete steps:
  - Commit the working tree changes from a normal dev environment.
  - Deploy preview/prod from that environment and proceed with 119b verification.
