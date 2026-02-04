# Phase 104 — Review

## Summary
- Added per-workspace UI control for Email Draft Verification (Step 3) model selection (admin-gated).
- Persisted model setting in `WorkspaceSettings.emailDraftVerificationModel` (default `gpt-5.2`).
- Wired Step 3 runtime to use workspace setting, with `OPENAI_EMAIL_VERIFIER_MODEL` env override precedence.
- Quality gates passed: `npm run db:push`, `npm test`, `npm run lint` (warnings only), `npm run build` (2026-02-04).

## What Shipped
- `prisma/schema.prisma` — added `WorkspaceSettings.emailDraftVerificationModel` (default `gpt-5.2`).
- `actions/settings-actions.ts`
  - extended `UserSettingsData` + `getUserSettings`/`updateUserSettings` to load/save the setting (admin-only).
- `components/dashboard/settings-view.tsx`
  - Settings → AI Personality card: **Email Draft Verification (Step 3)** model selector.
- `lib/ai-drafts/config.ts` — `coerceEmailDraftVerificationModel`.
- `lib/ai-drafts.ts` — Step 3 verifier model resolution:
  1) `OPENAI_EMAIL_VERIFIER_MODEL` (env, if set)
  2) `WorkspaceSettings.emailDraftVerificationModel`
  3) default `gpt-5.2`
- `lib/ai/prompt-runner/runner.ts` — removed Step 3 model override (kept reasoning-effort compatibility logic).
- `lib/__tests__/prompt-runner-temperature-reasoning.test.ts` — updated tests (reasoning compatibility only).

## Verification

### Commands
- `npm run db:push` — pass (2026-02-04)
- `npm test` — pass (2026-02-04)
- `npm run lint` — pass (warnings only, pre-existing) (2026-02-04)
- `npm run build` — pass (2026-02-04)

## Success Criteria → Evidence

1. Admin can select a Step 3 verifier model in UI; it persists in `WorkspaceSettings`.
   - Evidence:
     - UI: `components/dashboard/settings-view.tsx` (AI Personality → Email Draft Verification card)
     - Persistence: `actions/settings-actions.ts` upserts `emailDraftVerificationModel`
     - Schema: `prisma/schema.prisma` field exists
   - Status: met

2. Step 3 verifier uses selected model at runtime; `OPENAI_EMAIL_VERIFIER_MODEL` overrides if set.
   - Evidence:
     - Runtime: `lib/ai-drafts.ts` computes `verifierModel` with env override precedence.
   - Status: met

3. `npm run db:push`, `npm test`, `npm run lint`, and `npm run build` pass.
   - Evidence: command outputs recorded above.
   - Status: met

## Risks / Rollback
- Risk: Confusion if ops set `OPENAI_EMAIL_VERIFIER_MODEL` (env) and it silently overrides the UI setting.
  - Mitigation: UI copy notes env var precedence; confirm via `AIInteraction` telemetry `model` for `draft.verify.email.step3`.
- Rollback:
  - Remove `emailDraftVerificationModel` from schema/actions/UI and keep the Step 3 model hardcoded.

## Follow-ups
- If needed: add a small banner that indicates when env override is active (requires a server-provided config flag).

