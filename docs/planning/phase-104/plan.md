# Phase 104 — Add UI Control for Email Draft Verification (Step 3) Model

## Purpose
Expose Email Draft Verification (Step 3) model selection in the Settings UI so workspace admins can change it without redeploying or editing environment variables.

## Context
- Step 3 verifier currently runs with low temperature (`temperature: 0`) and uses the prompt runner’s temperature/reasoning compatibility logic.
- We previously added an env-based override (`OPENAI_EMAIL_VERIFIER_MODEL`) and model-aware reasoning coercion to stop 400s.
- New request: add UI controls so admins can change these AI settings per workspace.

## Decisions (Default Assumptions)
- **Scope:** Step 3 verifier model only (not exposing temperature/reasoning knobs yet).
- **Storage:** Persist per-workspace in `WorkspaceSettings`.
- **Precedence:** `OPENAI_EMAIL_VERIFIER_MODEL` (env) overrides workspace setting for ops hot-fixes.
- **Default value:** `gpt-5.2`.
- **Permissions:** Workspace admin only.

## Concurrent Phases / Working Tree State
| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Working tree | Uncommitted | `actions/email-actions.ts`, `lib/email-send.ts`, `lib/followup-engine.ts` | Keep untouched by Phase 104. Validate lint/build/test on combined state. |
| Phase 103 | Complete | `lib/ai/prompt-runner/runner.ts`, tests | Phase 104 shifts Step 3 model selection to workspace settings; keep reasoning-effort coercion fix. |

## Objectives
* [x] Add `WorkspaceSettings.emailDraftVerificationModel`
* [x] Surface setting in `getUserSettings`/`updateUserSettings` (admin-gated)
* [x] Add UI control in Settings → AI Personality
* [x] Wire Step 3 verifier to use workspace setting (with env override)
* [x] Update/adjust tests to match new behavior
* [x] Run `npm run db:push`, `npm test`, `npm run lint`, `npm run build`

## Constraints
- Keep changes surgical and consistent with existing Settings patterns.
- No secrets in UI. This is a workspace setting stored in DB.
- If Prisma schema changes, run `npm run db:push` before finishing.

## Success Criteria
- Admin can select a Step 3 verifier model in UI; it persists in `WorkspaceSettings`.
- Step 3 verifier uses selected model at runtime; `OPENAI_EMAIL_VERIFIER_MODEL` overrides if set.
- `npm run db:push`, `npm test`, `npm run lint`, and `npm run build` pass.

## Subphase Index
* a — Schema + settings actions wiring
* b — Settings UI control
* c — Runtime wiring + tests update
* d — Validation + rollout notes

## Phase Summary (running)
- 2026-02-04 — Added per-workspace Step 3 verifier model setting (schema + settings actions + UI + runtime wiring) (files: `prisma/schema.prisma`, `actions/settings-actions.ts`, `components/dashboard/settings-view.tsx`, `lib/ai-drafts.ts`).
