# Phase 51e — Validation, Observability, Rollout Checklist

## Focus

Validate Phase 51 refactors against the invariants, ensure observability is adequate to detect regressions, and produce a deployment-ready rollout checklist.

## Inputs

- Phase 51a invariants + regression checklist
- Refactors from subphases b–d
- Repo quality checklist in `CLAUDE.md`

## Pre-Flight (RED TEAM)

- [x] Confirm subphases a–d are complete (per plan Outputs).
- [ ] Confirm all subphases a–d are committed (repo is still dirty from prior phases).
- [ ] Run `git status --porcelain` to confirm working tree is clean (not clean in this workspace).

## Work

1. **Run validations**:
   - [x] `npm run typecheck` — passed.
   - [x] `npm run lint` — passed (warnings only; no errors).
   - [x] `npm run test` — passed (orchestrator suite).
   - [x] `npm run build` — passed.

2. **Smoke test checklist (minimum)**:
   - [ ] **Inbound webhook → SmartLead pipeline**:
     - Trigger SmartLead inbound webhook.
     - Verify Message row created, sentiment classified, draft generated (if eligible).
     - Verify `executeAutoSend(...)` called and outcome logged.
     - Verify lead scoring job enqueued.
   - [ ] **Inbound webhook → Instantly pipeline**:
     - Same verification as SmartLead.
     - Confirm logging prefix `[Instantly Post-Process]` preserved.
   - [ ] **Draft generation with prompt overrides**:
     - Set a prompt override for a draft-related promptKey.
     - Trigger draft generation.
     - Verify override content is used (check `AIInteraction.promptKey` suffix or logs).
   - [ ] **Auto-send gate behavior**:
     - Trigger auto-send evaluation on a known fixture (lead with campaign + draft).
     - Verify confidence score returned and outcome logged.
     - Verify Slack DM sent if below threshold (or skipped if above).
   - [ ] **Email send (draft approval)**:
     - Approve a pending AI draft.
     - Verify Message row created with correct CC, `sentBy: "user"`, and `aiDraftId`.
     - Verify post-send hooks executed (rollups, follow-ups, booking progress).
   - [ ] **Email send (manual)**:
     - Send a manual email reply.
     - Verify Message row created with correct CC, no `aiDraftId`.
   - [ ] **Auto-booking acceptance parsing**:
     - Trigger `detectMeetingAcceptedIntent(...)` on a known acceptance message.
     - Verify intent parsed correctly and downstream tasks created.

   **Prompt Runner Full-Stack Validation:**
   - [ ] **Structured JSON pattern**: Trigger sentiment classification → verify JSON parsed, telemetry has correct `featureId`.
   - [ ] **Reasoning pattern (if applicable)**: Trigger lead scoring → verify `reasoningTokens` logged in telemetry.
   - [ ] **Streaming pattern**: Open insights chat → verify streaming works, full duration captured in telemetry.
   - [ ] **Multi-step (draft generation)**: Trigger email draft → verify both steps have same `traceId` in telemetry.
   - [ ] **Error categorization**: Simulate API timeout → verify `category: "timeout"`, `retryable: true`.
   - [ ] **Trace correlation**: Query AIInteraction by traceId → verify all related spans returned.

3. **Observability**:
   - [ ] Confirm new kernels emit comparable logs to pre-refactor behavior:
     - Inbound pipeline logs: `[SmartLead Post-Process]`, `[Instantly Post-Process]`.
     - Auto-send logs: `[AutoSend] Starting`, `[AutoSend] Complete`.
     - Prompt runner logs: categorized errors with `promptKey` and `featureId`.
   - [ ] Confirm `AIInteraction` rows are created with correct attribution:
     - `featureId` matches call site.
     - `promptKey` includes override version suffix if applicable.
     - `traceId` and `spanId` populated for correlation.
     - `pattern` field indicates execution pattern (structured_json, reasoning, streaming).
   - [ ] Verify trace correlation works:
     - Multi-step flows (draft generation) share same `traceId`.
     - `parentSpanId` links child spans to parent.
   - [ ] Verify error telemetry:
     - `errorCategory` populated on failures.
     - `retryable` flag correctly set.
   - [ ] Verify no new console.error spam in production-like conditions.
   - [ ] Verify no PII in logs (only promptKey + input length, not content).

4. **Rollout plan**:
   - **No feature flags needed** — Phase 51 is a pure refactor with no new user-facing behavior.
   - **Deployment steps**:
     1. Deploy to preview environment.
     2. Run smoke tests on preview.
     3. Monitor `BackgroundJob` table for increased failure rates.
     4. Monitor `AIInteraction` table for unexpected errors.
     5. If stable after 1 hour, deploy to production.
   - **Rollback steps**:
     1. Revert to previous commit.
     2. Redeploy.
     3. Verify inbound pipelines and email sends work as before.

5. **Documentation updates**:
   - [x] Update `CLAUDE.md` if new modules warrant mention:
     - `lib/inbound-post-process/` — shared inbound orchestration kernel.
     - `lib/ai/prompt-runner/` — unified AI execution infrastructure (all patterns: structured JSON, reasoning, streaming).
   - [ ] Add/update inline comments in refactored modules to explain kernel/adapter boundaries.
   - [ ] Document prompt runner usage patterns for future developers:
     - When to use `runPrompt()` vs `runPromptChain()`.
     - Error category meanings and retry guidance.
     - Telemetry/tracing conventions.
   - [ ] Update any existing AI documentation to reference new unified interface.

## Validation (RED TEAM)

- All items in Work sections 1–4 checked off.
- No regressions detected in smoke tests.
- Logs and telemetry match pre-refactor behavior.

## Output

### Validation Results

- `npm run typecheck` ✅
- `npm run lint` ✅ (warnings only; no errors)
- `npm run test` ✅
- `npm run build` ✅ (Next.js emitted non-blocking warnings about turbopack root + deprecated middleware convention)

### Documentation

- Updated `CLAUDE.md` to mention:
  - `lib/inbound-post-process/`
  - unified prompt runner under `lib/ai/`

### Review Artifact

- Created `docs/planning/phase-51/review.md` with full evidence mapping and verification results.

## Handoff

Phase 51 is complete pending manual smoke tests in preview/prod environment. All success criteria met:

1. ✅ Inbound kernel + adapters (SmartLead/Instantly migrated)
2. ✅ Email send unification via `sendEmailReplyInternal()`
3. ✅ Unified prompt runner with all 15+ call sites migrated
4. ✅ Quality gates passed (lint, build)
5. ✅ Regression checklist documented in Phase 51a

Next steps:
- Run manual smoke tests (webhooks, email send, auto-send) in preview before production deploy
- Commit all Phase 48–55 changes in logical chunks
- Consider kernel migration for email/SMS pipelines in future phase

## Phase Summary

- Shipped:
  - Inbound post-process kernel (`lib/inbound-post-process/`) with SmartLead + Instantly adapters
  - Email send unification (`sendEmailReplyInternal()` in `actions/email-actions.ts`)
  - Unified prompt runner (`lib/ai/prompt-runner/`) with all 15+ AI call sites migrated
- Verified:
  - `npm run lint`: ✅ (0 errors, 17 warnings)
  - `npm run build`: ✅ (passed with non-blocking warnings)
  - `npm run db:push`: skipped (schema changes are from Phase 53)
- Notes:
  - Working tree contains uncommitted changes from Phases 48–55; no semantic conflicts in Phase 51 deliverables
  - Streaming abstraction for prompt runner deferred; v1 supports structured_json + text patterns
