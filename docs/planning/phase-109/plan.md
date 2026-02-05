# Phase 109 — Fix Missing AI Drafts on Manual “Interested” + Hardening

## Purpose
Fix the current regression where AI drafts are not populating after a setter manually marks a lead as draft-eligible (e.g., **Interested**), and harden adjacent ingestion/cron failures observed in production logs.

## Context
User report (Feb 2026): AI auto-generated drafts are not populating / not being auto-generated when a lead is marked **Interested**.

Repo reality:
- Draft generation is primarily triggered by **inbound message post-processing** (email/SMS/LinkedIn) via `shouldGenerateDraft(...)` → `generateResponseDraft(...)`.
- The CRM drawer manually updates lead sentiment via `updateLeadSentimentTag` in `actions/crm-actions.ts`, but that code currently:
  - updates `Lead.sentimentTag`,
  - rejects pending drafts when the sentiment is *not* eligible,
  - **does not generate drafts** when the sentiment becomes eligible.
- The inbox compose UI (`components/dashboard/action-station.tsx`) fetches drafts on `[conversation.id, activeChannel, deepLinkedDraftId]` only. Manual sentiment changes do not change `conversation.id`, so the compose box may never refetch drafts even if drafts exist.

Production logs (artifact: `logs_result (2).json`):
- `/api/webhooks/email` error: `invalid byte sequence for encoding "UTF8": 0x00` (Postgres rejects null bytes). This can break email ingestion and prevent downstream post-process + draft creation.
- `/api/cron/insights/booked-summaries` repeatedly fails with `hit max_output_tokens` during insight extraction, producing noisy errors and skipping summary computation.

Decision (from this conversation): when a setter manually changes sentiment to any tag where `shouldGenerateDraft(...) === true`, generate drafts for **all channels with any inbound message** (email/SMS/LinkedIn), best-effort. This uses the same core pipeline as inbound post-processing (last-80 transcript → `shouldGenerateDraft` → `generateResponseDraft`) — no arbitrary time window, just "does this channel have inbound history?"

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 104 | Shipped | `lib/ai-drafts.ts` Step-3 verifier model selection via `WorkspaceSettings.emailDraftVerificationModel` | Re-read `lib/ai-drafts.ts` before edits; keep changes additive and compatible. |
| Phase 101 | Shipped | `AIDraft.responseDisposition` + send paths | No direct overlap; ensure draft creation remains unaffected. |
| Phase 107 | Implemented; live verification pending | AI evaluator context + email send payloads | Independent; avoid touching `lib/email-send.ts` unless required. |
| Phase 108 | Planned/Not pushed (per user) | Insights/reporting domains | Our Insights cron fix should be minimal; avoid large “insights refactors” that would conflict. |
| Phase 106 | Planning | Meeting overseer/booking semantics | Our meeting-overseer hardening should preserve existing semantics; only make it non-fatal on errors. |

## Objectives
* [x] Ensure manual sentiment changes to a draft-eligible tag can trigger draft generation (email/SMS/LinkedIn)
* [x] Ensure Master Inbox compose UI refetches and displays pending drafts after sentiment changes
* [x] Harden draft generation so auxiliary gates (e.g., meeting overseer) cannot prevent draft creation via uncaught exceptions
* [x] Prevent email webhook ingestion from failing on null bytes (`\u0000`) in provider payloads
* [x] Reduce booked-summaries Insights cron failures caused by `max_output_tokens` (targeted retry/budget bump)
* [x] Add tests and run quality gates (`npm test`, `npm run lint`, `npm run build`)

## Constraints
- No secrets or PII in code or logs.
- Multi-tenant safety: all operations remain scoped to the lead’s `clientId`.
- Prefer best-effort behavior on background/AI failures: manual sentiment updates must succeed even if draft generation fails.
- Avoid Prisma schema changes unless absolutely necessary.
- Follow repo conventions: actions return `{ success, data?, error? }`.

## Success Criteria
1. When a setter updates a lead sentiment to an eligible tag (per `shouldGenerateDraft`), the system creates **pending** drafts for all channels with any inbound message, unless a pending draft already exists for that channel.
2. After changing sentiment, the Master Inbox compose UI shows the new draft without requiring a page refresh or channel switch.
3. `/api/webhooks/email` no longer throws `invalid byte sequence for encoding "UTF8": 0x00` due to inbound payloads.
4. `/api/cron/insights/booked-summaries` no longer repeatedly fails due to `hit max_output_tokens` (retry/budget bump reduces failures materially).
5. `npm test`, `npm run lint`, `npm run build` pass.

## Repo Reality Check (RED TEAM)

### What exists today (post-fix, verified 2026-02-05)

| File | Status | Key Functions/Lines |
|------|--------|---------------------|
| `actions/crm-actions.ts` | ✅ | `updateLeadSentimentTag` now triggers best-effort draft generation via `generateDraftsForLeadOnManualSentiment` |
| `lib/manual-draft-generation.ts` | ✅ | Generates pending drafts for channels with inbound history (dedupes on existing pending drafts) |
| `lib/ai-drafts.ts` | ✅ | Meeting overseer gate wrapped in try/catch so draft creation is non-fatal |
| `lib/email-cleaning.ts` | ✅ | `stripNullBytes` + `cleanEmailBody` sanitizes null bytes from outputs |
| `app/api/webhooks/email/route.ts` | ✅ | Sanitizes inbound/outbound webhook strings before DB writes (subject/from/to/cc/bcc/body html) |
| `lib/insights-chat/thread-extractor.ts` | ✅ | `extractConversationInsightForLead` uses `retryMax: 4800`, `retryExtraTokens: 1200` |
| `components/dashboard/action-station.tsx` | ✅ | Draft fetch effect depends on `conversation?.lead?.sentimentTag` and avoids clobbering edits |
| `lib/ai/prompt-runner/runner.ts` | ✅ | Already handles `max_output_tokens` retries (lines 300-306, 573-579) with budget expansion |

### Plan assumptions verified

- `updateLeadSentimentTag` does NOT call `generateResponseDraft` → **Confirmed**
- ActionStation draft fetch doesn't re-run on sentiment changes → **Confirmed** (deps lack `sentimentTag`)
- Meeting overseer gate is NOT wrapped in try/catch → **Confirmed**
- `cleanEmailBody` doesn't strip null bytes → **Confirmed**
- Prompt-runner already retries on `max_output_tokens` → **Confirmed** (109f may be simpler than expected)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes

1. **109b: Race condition on draft creation** — Multiple channels could race to create drafts → Explicitly check for existing pending draft BEFORE calling `generateResponseDraft` per channel
2. **109b: (Resolved)** No time-window needed — generate for any channel with any inbound. Use the same "last 80 messages" transcript behavior used by `regenerateDraft`.
3. **109c: Masking real errors** — Silently catching all errors could hide config issues → Log at WARN level with error type for observability
4. **109e: UI may clobber user edits** — Need to track "previous draft" ID/content to avoid overwriting manual edits
5. **109f: Retry logic already exists** — Prompt-runner already handles `max_output_tokens` retries; the fix is to bump `retryMax`/`retryExtraTokens` (note: `retryReasoningEffort` is not available for structured-json prompts)

### Missing or ambiguous requirements

| Gap | Subphase | Concrete Fix |
|-----|----------|--------------|
| ~~"Recent inbound" not defined~~ | 109b | **(Resolved)** No time window — any channel with any inbound message gets a draft. Use the same "last 80 messages" transcript behavior used by `regenerateDraft`. |
| Deduplication key for drafts | 109b | Use `prisma.aIDraft.findFirst({ where: { leadId, channel, status: 'pending' }})` before generation |
| Concurrency limit implementation | 109b | Use Promise.all with chunked batches (cap at 2 concurrent) |
| How sentiment change propagates to UI | 109e | Verify `conversation?.sentimentTag` is in props or add to conversation fetch |
| 109f approach given existing retry | 109f | Bump `retryMax`/`retryExtraTokens` instead of adding new retry logic |

### Multi-agent coordination

**Uncommitted changes detected:**
- `app/api/cron/background-jobs/route.ts` (modified; separate concurrent workstream)
- `lib/__tests__/background-jobs-cron-no-advisory-lock.test.ts` (untracked; separate concurrent workstream)
- `docs/planning/phase-110/*` (untracked; separate phase plan)
- `components/dashboard/settings-view.tsx` + `components/dashboard/admin-dashboard-tab.tsx` + `actions/admin-dashboard-actions.ts` (admin dashboard workstream; out of Phase 109 scope)
- `lib/ai/prompt-registry.ts` + `lib/meeting-overseer.ts` (meeting overseer model/config changes; out of Phase 109 scope)
- `actions/crm-actions.ts` also contains additional CRM search filter changes unrelated to draft generation (needs coordination before committing Phase 109 cleanly)

**No blocking conflicts.** Phase 109 touchpoints are independent of uncommitted changes.

### Performance / timeouts

- **109b:** 3 parallel OpenAI calls on sentiment change — Plan correctly limits concurrency to 2; add per-channel timeout (30s)
- **109b:** Long message transcript — Enforce "last 80 messages" bound as specified

## Open Questions (Need Human Input)

- [x] **109b: "Recent inbound" definition** — **(Resolved)** No arbitrary time window. Generate drafts for any channel with any inbound message. This matches the existing `regenerateDraft` behavior (loads last 80 messages to build transcript). The feature was previously working via inbound post-processing; this just wires the same core logic to manual sentiment changes.

- [x] **109f: Approach given existing retry logic** — **(Resolved)** Bump `retryMax` from 3200 → 4800 and `retryExtraTokens` from 900 → 1200. (Note: `retryReasoningEffort` is not available on the structured-json prompt runner type.)

## Assumptions (Agent)

- Manual sentiment draft generation reuses the same core pipeline as inbound post-processing: build transcript from last 80 messages → `shouldGenerateDraft` → `generateResponseDraft`. (confidence ~95%)
- Null byte stripping is safe and won't change semantic meaning. (confidence ~98%)
- Meeting overseer try/catch at WARN level won't mask real issues. (confidence ~90%)
- ActionStation has access to `conversation.lead.sentimentTag` and can use it as a refetch trigger. (confidence ~95%)
- Bumping `retryMax` from 3200 → 4800 is sufficient for insights cron token exhaustion. (confidence ~90%)
  - Mitigation: if failures persist, bump `retryMax` further or reduce `outputScale`

## Subphase Index
* a — Audit + reproduction (manual sentiment path, UI refresh behavior, log-driven failure modes)
* b — Backend: generate drafts on manual sentiment change (all channels w/ any inbound)
* c — Backend hardening: make meeting overseer gate non-fatal for draft creation
* d — Email webhook hardening: strip null bytes before DB writes
* e — Frontend: refetch drafts when sentiment changes
* f — Insights cron: retry/budget bump on `max_output_tokens` failures + validation

## Phase Summary (running)
- 2026-02-05 — Fixed manual sentiment “Interested” draft generation + UI refetch, hardened email ingestion (null bytes), made meeting overseer non-fatal, and bumped insights retry budget (files: `actions/crm-actions.ts`, `lib/manual-draft-generation.ts`, `lib/ai-drafts.ts`, `lib/email-cleaning.ts`, `app/api/webhooks/email/route.ts`, `components/dashboard/action-station.tsx`, `lib/insights-chat/thread-extractor.ts`, `lib/__tests__/email-cleaning.test.ts`, `lib/__tests__/manual-draft-generation.test.ts`, `scripts/test-orchestrator.ts`)

## Phase Summary
- Shipped:
  - Manual sentiment draft backfill (`actions/crm-actions.ts`, `lib/manual-draft-generation.ts`)
  - UI refetch-on-sentiment + clobber protection (`components/dashboard/action-station.tsx`)
  - Email webhook null-byte hardening (`lib/email-cleaning.ts`, `app/api/webhooks/email/route.ts`)
  - Meeting overseer made non-fatal for draft creation (`lib/ai-drafts.ts`)
  - Insights token-exhaustion budget bump (`lib/insights-chat/thread-extractor.ts`)
- Verified:
  - `npm test`: pass (174 tests) (2026-02-05)
  - `npm run lint`: pass (warnings only) (2026-02-05)
  - `npm run build`: pass (warnings only) (2026-02-05)
  - `npm run db:push`: skip (no Prisma schema changes)
- Notes:
  - Review: `docs/planning/phase-109/review.md`

## Follow-ups (Post-Ship)
- Live smoke test (setter):
  - Mark a lead **Interested** and confirm drafts appear for each channel with inbound history.
  - Confirm draft auto-population does not overwrite user edits mid-compose.
- Live monitoring:
  - Watch `/api/webhooks/email` logs to confirm the `0x00` UTF-8 error does not recur.
  - Watch `/api/cron/insights/booked-summaries` logs to confirm `max_output_tokens` failures materially drop.
