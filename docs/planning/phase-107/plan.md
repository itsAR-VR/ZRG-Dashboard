# Phase 107 — Jam fd4cf691: Email Signature Duplication + Confidence Gate Context + Prompt UI Verification

## Purpose
Address the 3 issues called out in Jam `fd4cf691-596b-4061-92de-d05e05434867`: (1) outbound emails include copied recipient signature/link blocks, (2) the AI auto-send confidence gate lacks workspace AI Personality + Knowledge Assets context, and (3) confirm prompts shown in the dashboard are editable and reflect what is actually used at runtime.

## Context
- Jam: https://jam.dev/c/fd4cf691-596b-4061-92de-d05e05434867 (created `2026-02-04`).
- Observed flow in the video:
  1) User reviews sent email threads and points out that the recipient’s “Links: Winery / Restaurant / Garden / Bakehouse” and signature content appear **after our own signature**, making it look like we sent it.
  2) User opens **AI Needs Review** and sees a very low confidence score (10%) + “AI Suggested Needs Review” reason indicating the draft gives a specific price “without verified context”.
  3) User goes to **Settings → AI Personality**, highlights **Knowledge Assets**, then opens **View Prompts** and expands **Auto-Send Evaluator** (`auto_send.evaluate`) to confirm prompt editability and what the system uses.

Repo-level likely causes (to verify):
- Email signature/link duplication is plausibly caused by EmailBison reply payload using `inject_previous_email_body: true` in `lib/email-send.ts`, which appends prior email content (including recipient signature/links) directly after our message.
- The auto-send evaluator (`lib/auto-send-evaluator.ts`) currently evaluates using only inbound + transcript + draft, without including `AiPersona` fields or `KnowledgeAsset` text, so it cannot “verify context” for pricing/service claims and will conservatively flag for review.
- The prompts dashboard is editable (Phase 47 override system), but we must confirm that what it shows is (a) the prompt keys/models actually used by runtime paths and (b) edits affect the relevant runtime behavior.

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 106 | Active (untracked locally) | AI bug triage / Jam links | Add this Jam as a tracked bug item there once Phase 107 is complete, or fold into Phase 106 if that phase is the canonical backlog. |
| Phase 105 | Complete | Email sending + followups | Ensure any EmailBison send/idempotency changes remain compatible with Phase 105’s follow-up send semantics. |
| Phase 97 | Complete | Auto-send evaluator semantics | Reuse Phase 97’s evaluator output interpretation + test expectations; avoid reintroducing old safe-to-send bugs. |
| Phase 104 / 103 | Complete | Prompt runner + verifier settings UI | Keep prompt/dashboard behaviors consistent with model selection + prompt runner conventions established there. |
| Phase 47 | Historical plan (implemented in parts) | Prompt overrides + Settings UI | Use existing prompt override system; only extend UI/notes where runtime usage diverges from what’s shown. |

## Objectives
* [x] Confirm root cause for copied recipient signature/links in outbound emails (provider behavior vs our composition)
* [x] Make outbound email replies stop appending recipient signature/link blocks (or quote them safely)
* [x] Update auto-send evaluator to include AI Personality + Knowledge Assets context so confidence decisions reflect verified workspace assets
* [ ] Verify prompt editability and that the dashboard reflects runtime prompt usage (keys/models/override application)
* [x] Produce an end-to-end QA checklist for these three fixes

## Constraints
- No secrets/tokens in code or docs.
- Keep changes multi-tenant safe (workspace-scoped) and admin-gated where UI edits exist.
- Preserve conservative safety defaults for auto-send (opt-outs, automated replies, risky claims).
- If Prisma schema changes land with this phase (e.g., `MeetingOverseerDecision`), run `npm run db:push` against the intended DB before deploy.

## Success Criteria
- [ ] Outbound emails no longer include the recipient’s signature/link block as plain text immediately after our signature.
  - Implemented by disabling EmailBison `inject_previous_email_body`; needs live-thread verification.
- [ ] Auto-send evaluator “needs review” reasons stop claiming “no verified context” when relevant service/pricing info exists in AI Personality / Knowledge Assets.
  - Implemented by injecting persona + knowledge context into evaluator input; needs live-case verification.
- [ ] Settings → AI Personality → View Prompts shows what the evaluator actually uses (prompt key + dynamic context), and edits affect new runtime evaluations.
  - Implemented runtime context preview; needs live override verification.
- [x] Lint/build/tests pass; targeted tests exist for evaluator input composition and EmailBison reply payload behavior.

## Repo Reality Check (RED TEAM)

### What exists today (verified 2026-02-05)

| File | Status | Key Functions/Parameters |
|------|--------|-------------------------|
| `lib/email-send.ts` | ✅ Updated | `sendEmailReplySystem()` uses `buildEmailBisonReplyPayload()` (no `inject_previous_email_body`) |
| `lib/emailbison-reply-payload.ts` | ✅ Added | `inject_previous_email_body: false` (prevents signature/link copying) |
| `lib/reactivation-engine.ts` | ✅ Updated | Reactivation bump replies now use `buildEmailBisonReplyPayload()` |
| `lib/auto-send-evaluator.ts` | ✅ Updated | `evaluateAutoSend()` now injects AI Personality + Knowledge Assets into evaluator input |
| `lib/auto-send/orchestrator.ts` | ✅ Exists | Imports and calls `evaluateAutoSend` |
| `lib/ai/prompt-registry.ts` | ✅ Exists | `AUTO_SEND_EVALUATOR_SYSTEM` (line 104), `getPromptWithOverrides()` |
| `components/dashboard/settings-view.tsx` | ✅ Updated | Prompt modal shows runtime context preview for `auto_send.evaluate.v1` |
| `actions/ai-observability-actions.ts` | ✅ Exists | `savePromptOverride()`, `resetPromptOverride()` |
| `actions/settings-actions.ts` | ✅ Exists | `getKnowledgeAssetsForAI()` (line 1318) |
| `lib/ai-drafts.ts` | ✅ Exists | Uses `knowledgeContext` parameter for draft generation |

### Plan assumptions verified

| Plan Assumption | Reality | Status |
|-----------------|---------|--------|
| `inject_previous_email_body: true` causes signature duplication | Confirmed; fixed by enforcing `inject_previous_email_body: false` via `lib/emailbison-reply-payload.ts` | ✅ Fixed |
| Evaluator lacks AI Personality context | Fixed: evaluator now loads persona goals/service description and injects into input | ✅ Fixed |
| Evaluator lacks Knowledge Assets context | Fixed: evaluator now loads Knowledge Assets and injects token-budgeted context | ✅ Fixed |
| Prompt override system exists | Confirmed - `getPromptWithOverrides()` in prompt-registry | ✅ Verified |

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes

1. **Phase 105 file conflict (`lib/email-send.ts`)** → Phase 105 added single-flight send semantics to this file. Phase 107a must not break idempotency logic.
   - **Mitigation:** Add regression test: send follow-up email with recipient link content → confirm single send + no signature duplication.

2. **Evaluator context injection shifts confidence scores** → Adding AI Personality + Knowledge Assets will change all confidence scores.
   - **Mitigation:** Run regression test with sample drafts before/after. Document expected score shifts.

3. **Prompt key version bump orphans overrides** → If bumped to `v2`, existing `PromptOverride` records for `v1` stop working.
   - **Mitigation:** Keep prompt key as `auto_send.evaluate.v1`; avoid version bump.

### Missing or ambiguous requirements

1. **107a:** What replaces `inject_previous_email_body`? Does threading still work via `reply_id` alone? (confidence ~75%)
2. **107b:** Which AiPersona fields to include? Max token budget for context? (confidence ~85% — assume same format as `lib/ai-drafts.ts`)
3. **107c:** What counts as "dashboard shows runtime usage"? Show raw prompt only, or also runtime-composed context? (confidence ~70%)

### Repo mismatches (fix the plan)

1. **107a:** Plan references `lib/email-format.ts`, `lib/safe-html.ts` but actual payload is built inline in `lib/email-send.ts` lines 410-430.
2. **107b:** Plan references `actions/settings-actions.ts:getKnowledgeAssetsForAI()` but draft generation uses direct `settings.knowledgeAssets` access pattern in `lib/ai-drafts.ts` lines 1297-1307.

### Performance / timeouts

1. ✅ **Evaluator token budget** increased (`max: 1600`, `retryMax: 2400`) and prompt runner now sets `truncation: "auto"` to avoid hard 400s on oversized inputs.
2. ✅ **Knowledge Asset compilation** is token-budgeted (per-asset + total caps) with per-asset stats surfaced in the prompt modal preview.

### Security / permissions

1. **Prompt override saves are admin-gated** → Already uses `requireClientAdminAccess()` pattern. ✅ OK.

### Testing / validation

1. ✅ Added unit tests for evaluator input composition + knowledge-asset budgeting:
   - `lib/__tests__/auto-send-evaluator-input.test.ts`
   - `lib/__tests__/knowledge-asset-context.test.ts`
2. ✅ Added unit test for EmailBison reply payload:
   - `lib/__tests__/emailbison-reply-payload.test.ts`

## Open Questions (Need Human Input)

- [ ] Does EmailBison threading work correctly when `inject_previous_email_body: false`? (confidence ~75%)
  - Why it matters: If threading breaks, we need to implement our own quoted reply section.
  - Current assumption: Threading works via `reply_id` alone.

- [ ] Should the prompt dashboard show runtime-composed context (Knowledge Assets snippets), or just note that it exists? (confidence ~70%)
  - Why it matters: Showing full context is complex and varies per lead.
  - Current assumption: Add a note explaining runtime context is injected dynamically.

- [ ] Prisma schema changes are present in this working tree — which database should receive `npm run db:push`? (resolved)
  - Run `npm run db:push` successfully

## Assumptions (Agent)

- Prompt key should stay `v1` to avoid orphaning existing PromptOverride records. (confidence ~95%)
- Knowledge context format matches `lib/ai-drafts.ts` pattern (`[Asset Name]: content...`). (confidence ~92%)
- Token budget increase to 1600 is sufficient for added context. (confidence ~90%)

## Subphase Index
* a — EmailBison reply composition: stop signature/link copying
* b — Confidence gate: inject AI Personality + Knowledge Assets into evaluator
* c — Prompt dashboard: verify editability + runtime fidelity
* d — QA checklist + validation evidence
* e — Token budgeting hardening: byte-based token estimates + safer truncation

## Phase Summary (running)
- 2026-02-05 — Disabled EmailBison `inject_previous_email_body` to stop copying lead signatures/links into outbound replies (files: `lib/emailbison-reply-payload.ts`, `lib/email-send.ts`, `lib/reactivation-engine.ts`, `lib/__tests__/emailbison-reply-payload.test.ts`, `scripts/test-orchestrator.ts`)
- 2026-02-05 — Auto-send evaluator now injects AI Personality + Knowledge Assets with token budgeting + per-asset token/byte stats (files: `lib/auto-send-evaluator.ts`, `lib/auto-send-evaluator-input.ts`, `lib/knowledge-asset-context.ts`, `lib/ai/token-estimate.ts`, `lib/__tests__/auto-send-evaluator-input.test.ts`, `scripts/test-orchestrator.ts`)
- 2026-02-05 — Prompt modal now shows a runtime context preview for `auto_send.evaluate.v1` (files: `components/dashboard/settings-view.tsx`)
- 2026-02-05 — Token estimates now derive from UTF-8 byte length (“file size”) and truncation is UTF-8-safe (files: `lib/ai/token-estimate.ts`, `lib/knowledge-asset-context.ts`, `components/dashboard/settings-view.tsx`)
- 2026-02-05 — Cleared build blockers found during validation (Prisma relation backrefs + meeting overseer gate input + prompt runner resolved template typing) (files: `prisma/schema.prisma`, `lib/ai-drafts.ts`, `lib/ai/prompt-runner/types.ts`, `lib/ai/prompt-runner/runner.ts`, `lib/meeting-overseer.ts`)

## Phase Summary
- Shipped: EmailBison reply payload no longer injects previous thread body (prevents lead signature/link copying).
- Shipped: Auto-send evaluator input now includes token-budgeted AI Personality + Knowledge Assets context (plus per-asset bytes/tokens accounting).
- Shipped: Prompt modal now explains/shows dynamic evaluator context (service description, goals, knowledge assets) with approximate token/byte totals.
- Verified: `npm test`, `npm run lint`, `npm run build` all pass.
- Remaining: live verification for (a) EmailBison threading + delivered body, (b) evaluator confidence/reasoning on a real pricing case, (c) prompt override edit affecting evaluator runs.
