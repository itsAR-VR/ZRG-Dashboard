# Phase 107d — QA Checklist + Validation Evidence

## Focus
Provide a short, repeatable validation checklist covering the three Jam issues, with specific evidence targets.

## Inputs
- Outputs from Phase 107a–c (final behavior contract + prompt key changes + UI notes).

## Work (RED TEAM Refined)

### 1. Email Send Validation (107a)
- [ ] Send EmailBison reply to thread where recipient has signature with links
- [ ] Verify delivered email does NOT append recipient's signature/links as plain text
- [ ] Verify reply appears in correct thread (threading via `reply_id` works)

### 2. Confidence Gate Validation (107b)
- [ ] Create/find lead with draft that includes pricing matching Knowledge Assets
- [ ] Verify evaluator confidence > 10%
- [ ] Verify reason does NOT mention "missing verified context"
- [ ] Check AIInteraction telemetry shows increased token usage (budget change)

### 3. Prompt UI Validation (107c)
- [ ] Edit Auto-Send Evaluator prompt (add obvious test text like "TEST EDIT")
- [ ] Trigger evaluator run on a new draft
- [ ] Verify edited prompt affects behavior (or check telemetry for prompt hash change)
- [ ] Reset prompt → verify original behavior restored
- [ ] Confirm runtime context preview example is visible in modal

### 4. Cross-Phase Regression Tests (RED TEAM ADDED)

#### Phase 105 — Email Send Idempotency
- [ ] Trigger follow-up email to thread with recipient signature/links
- [ ] Verify only ONE send occurs (no duplicate sends)
- [ ] Verify single-flight `pending -> sending` claim still works
- [ ] Verify recipient signature NOT duplicated in follow-up

#### Phase 97 — Evaluator Qualification Allowance
- [ ] Create draft with standard B2B qualification question (e.g., "What's your timeline?")
- [ ] Verify evaluator marks as safe (not "needs review" for qualification)
- [ ] Verify `safeToSend` interpretation: `safe_to_send === true && !requires_human_review && confidence >= 0.01`

#### Phase 103 — Prompt Runner Reasoning Effort
- [ ] Confirm email verifier Step 3 reasoning-effort coercion still works
- [ ] If model is `gpt-5-mini`, reasoning.effort should coerce to "minimal"

### 5. Engineering Checks
- [ ] `npm run lint` — no errors
- [ ] `npm run build` — succeeds
- [ ] `npm test` — passes (including new tests from 107a/107b)
- [ ] Check `lib/__tests__/auto-send-evaluator.test.ts` exists and passes

## Output
- Engineering checks:
  - ✅ `npx prisma validate` — pass
  - ✅ `npm test` (152 tests) — pass
  - ✅ `npm run lint` — pass (warnings only; no new errors introduced)
  - ✅ `npm run build` — pass
  - ✅ `npm run db:push` — pass (database already in sync)
- Implemented artifacts ready for manual verification:
  - EmailBison injection disabled for replies (`lib/email-send.ts`, `lib/reactivation-engine.ts`)
  - Auto-send evaluator injects AI Personality + Knowledge Assets with token budgeting (`lib/auto-send-evaluator.ts`)
  - Prompt modal shows runtime context preview (`components/dashboard/settings-view.tsx`)
- Manual verification still needed in a real workspace:
  - Confirm delivered EmailBison replies no longer append lead signature/links and threading still works.
  - Confirm evaluator no longer flags “missing verified context” when pricing exists in Knowledge Assets / service description.
  - Confirm prompt override edits affect new evaluator runs (telemetry promptKey suffix / behavior).

## Handoff
- If any part fails, capture:
  - Failure mode (what happened)
  - Suspected cause (which file/function)
  - Exact file(s) to revisit
- If all pass: Phase 107 complete, update Phase 106 to reference this as implementation for confidence gate bug

## Progress This Turn (Terminus Maximus)
- Work done:
  - Ran unit tests, lint, and production build.
  - Documented what still requires live workspace verification.
- Commands run:
  - `npm test` — pass
  - `npm run lint` — pass (warnings only)
  - `npm run build` — pass
- Blockers:
  - No live EmailBison thread + inbox UI/telemetry in this environment to capture screenshots and confirm runtime behavior.
- Next concrete steps:
  - In production/staging, reply to a thread with signature links and verify the delivered email body and threading.
  - Trigger an auto-send evaluation where pricing is present in Knowledge Assets and verify confidence/reason output.
