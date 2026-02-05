# Phase 107 — Review

## Summary
- Shipped EmailBison reply payload change to stop copying lead signatures/links into outbound replies.
- Shipped auto-send evaluator context injection using AI Personality + Knowledge Assets with token/byte accounting + safer truncation.
- Shipped prompt modal runtime context preview for `auto_send.evaluate.v1`.
- Hardened token estimation to be UTF-8 byte-based (“file size”) and truncation to be UTF-8-safe.
- Verified locally: `npm test`, `npm run lint`, `npm run build` all pass.
- Remaining: live verification for EmailBison threading/body + evaluator behavior on a real pricing case + prompt override runtime confirmation.

## What Shipped
- EmailBison reply payload builder:
  - `lib/emailbison-reply-payload.ts`
  - Wired into:
    - `lib/email-send.ts`
    - `lib/reactivation-engine.ts`
  - Test:
    - `lib/__tests__/emailbison-reply-payload.test.ts`
- Auto-send evaluator context injection + robust token budgeting:
  - `lib/auto-send-evaluator.ts` (loads persona + knowledge assets via Prisma; injects into evaluator input)
  - `lib/auto-send-evaluator-input.ts` (builds evaluator JSON input with truncation + verified-context hint)
  - `lib/knowledge-asset-context.ts` (token/byte stats + budgeted context pack builder)
  - `lib/ai/token-estimate.ts` (byte-based token + byte estimation; UTF-8-safe truncation)
  - Test:
    - `lib/__tests__/auto-send-evaluator-input.test.ts`
- Prompt dashboard clarification:
  - `components/dashboard/settings-view.tsx` (adds runtime context preview under Auto-Send Evaluator user prompt)

## Verification

### Commands
- `npx prisma validate` — pass
- `npm test` — pass (152 tests)
- `npm run lint` — pass (warnings only; no errors)
- `npm run build` — pass
- `npm run db:push` — pass (database already in sync)

### Notes
- The OpenAI Node SDK type defs confirm `truncation?: "auto" | "disabled"` is supported for Responses API requests (used in the prompt runner to prevent hard 400s when context is large).
- `prisma/schema.prisma` is modified in this working tree; run `npm run db:push` only against the intended (non-prod) database before deploying.

## Success Criteria → Evidence
- Outbound emails no longer include recipient signature/link block as plain text immediately after our signature.
  - Evidence: `inject_previous_email_body: false` enforced by `lib/emailbison-reply-payload.ts` and used by both reply send paths.
  - Remaining: verify delivered-email body + threading on a real EmailBison thread.
- Auto-send evaluator “needs review” reasons stop claiming “no verified context” when workspace assets contain the info.
  - Evidence: `lib/auto-send-evaluator.ts` now injects `service_description`, `goals`, `knowledge_context` into evaluator input via `lib/auto-send-evaluator-input.ts`.
  - Remaining: trigger a real pricing case and confirm evaluator confidence + reason text.
- Settings → AI Personality → View Prompts reflects runtime usage and edits affect new evaluator runs.
  - Evidence: runtime context preview added in `components/dashboard/settings-view.tsx` for `auto_send.evaluate.v1`.
  - Remaining: confirm a saved PromptOverride changes subsequent evaluator behavior/telemetry in a live workspace.
- Lint/build passes; targeted tests exist.
  - Evidence: verification commands above + new unit tests registered in `scripts/test-orchestrator.ts`.

## Gaps / Follow-ups
- Live EmailBison threading check:
  - Reply to a thread that contains a signature with links; confirm the delivered email does not append the lead signature/links and remains in-thread.
- Live evaluator behavior check:
  - Use a thread where pricing/service info exists in Knowledge Assets or AI Persona service description; confirm evaluator no longer claims missing context.
- Prompt override runtime check:
  - Edit the Auto-Send Evaluator system prompt in the modal; trigger a new evaluation; confirm the override applied (telemetry promptKey suffix / observable behavior).

## Coordination Notes
- `git status` shows local uncommitted changes for Phase 107 files plus additional work-in-progress changes from other phases. `npm test` / `npm run lint` / `npm run build` are green with the combined working tree.
