# Phase 109 — Review

## Summary
- Fixed missing AI draft generation when a setter manually marks a lead as draft-eligible (e.g., **Interested**) by generating pending drafts (best-effort) for each channel with inbound history.
- Updated ActionStation to refetch drafts on sentiment changes and avoid overwriting user edits when a draft arrives.
- Hardened adjacent production failures from `logs_result (2).json`:
  - Email webhook null-byte sanitization (`0x00`) to prevent Postgres UTF-8 errors.
  - Insights booked-summaries extraction budget bump to reduce `max_output_tokens` retries/failures.
- Quality gates executed on the combined working tree: `npm test`, `npm run lint`, `npm run build` (2026-02-05).

## What Shipped
- Manual sentiment → draft backfill:
  - `actions/crm-actions.ts` (`updateLeadSentimentTag` now triggers draft generation when `shouldGenerateDraft(...)` is true)
  - `lib/manual-draft-generation.ts` (best-effort draft generation for `sms|email|linkedin` with inbound history; dedupes pending drafts)
  - `lib/__tests__/manual-draft-generation.test.ts` + `scripts/test-orchestrator.ts`
- UI draft population:
  - `components/dashboard/action-station.tsx` (draft fetch effect depends on `conversation.lead.sentimentTag`; guarded auto-population)
- Draft pipeline hardening:
  - `lib/ai-drafts.ts` (meeting overseer gate wrapped in try/catch to avoid blocking draft creation)
- Email webhook hardening:
  - `lib/email-cleaning.ts` (`stripNullBytes` + `cleanEmailBody` sanitization)
  - `app/api/webhooks/email/route.ts` (sanitizes inbound payload strings before DB writes)
  - `lib/__tests__/email-cleaning.test.ts` + `scripts/test-orchestrator.ts`
- Insights cron noise reduction:
  - `lib/insights-chat/thread-extractor.ts` (bump `retryMax` and `retryExtraTokens`)

## Verification

### Commands
- `npm test` — pass (174 tests, 0 failures) (Thu Feb  5 14:11 EST 2026)
- `npm run lint` — pass (0 errors, 22 warnings) (Thu Feb  5 14:11 EST 2026)
- `npm run build` — pass (warnings only) (Thu Feb  5 14:11 EST 2026)
- `npm run db:push` — skip (no Prisma schema changes in this phase)

### Notes
- Lint warnings are pre-existing (react-hooks deps, `<img>` usage in auth pages, etc).
- Build warnings are pre-existing (CSS optimizer tokens, `baseline-browser-mapping` age notice, middleware deprecation notice).

## Success Criteria → Evidence

1. When a setter updates a lead sentiment to an eligible tag, create pending drafts for channels with inbound history (skip if pending draft exists).
   - Evidence:
     - `actions/crm-actions.ts` (`updateLeadSentimentTag` calls `generateDraftsForLeadOnManualSentiment` under `shouldGenerateDraft(...)`)
     - `lib/manual-draft-generation.ts` (`message.groupBy` inbound channels; `aIDraft.findFirst` pending dedupe; last-80 transcript; `generateResponseDraft(...)`)
     - `lib/__tests__/manual-draft-generation.test.ts`
   - Status: met (unit coverage + code wiring). Manual smoke test still recommended.

2. After changing sentiment, ActionStation shows the new draft without refresh/channel switch.
   - Evidence:
     - `components/dashboard/action-station.tsx` draft fetch `useEffect` deps include `conversation?.lead?.sentimentTag`
     - Auto-population guarded via `composeMessageRef` + `originalDraftRef` (won’t clobber edits)
   - Status: met (code path). Manual UI verification still recommended.

3. `/api/webhooks/email` no longer throws `invalid byte sequence for encoding "UTF8": 0x00` due to inbound payloads.
   - Evidence:
     - `lib/email-cleaning.ts` `stripNullBytes(...)` used in `cleanEmailBody(...)`
     - `app/api/webhooks/email/route.ts` sanitizes subject/from/to/cc/bcc/body strings before DB writes
     - `lib/__tests__/email-cleaning.test.ts`
   - Status: met (unit coverage). Production monitoring still recommended for real provider payload variance.

4. `/api/cron/insights/booked-summaries` materially reduces `max_output_tokens` failures.
   - Evidence:
     - `logs_result (2).json` shows chronic failures
     - `lib/insights-chat/thread-extractor.ts` increases retry budget (`retryMax`, `retryExtraTokens`)
     - Existing retry path in `lib/ai/prompt-runner/runner.ts` uses the retry budget on incomplete output
   - Status: partial (needs post-deploy log confirmation of reduced error volume).

5. Repo quality gates pass.
   - Evidence: command results above.
   - Status: met.

## Plan Adherence
- 109e: Implemented clobber-protection via refs (`composeMessageRef`, `originalDraftRef`) instead of tracking a draft id in state; intended behavior preserved.
- 109f: Did not add `retryReasoningEffort` because it is not supported for `pattern: "structured_json"` prompts (`StructuredJsonPromptParams`); did the minimal retry-budget bump instead.
- 109c: No dedicated unit test added for “meeting overseer throws” path; behavior is covered by try/catch guard + build/test gates, but would benefit from targeted test/mocking if we see future regressions.

## Multi-Agent Coordination Notes
- Current working tree contains unrelated concurrent changes (not part of Phase 109 scope):
  - `app/api/cron/background-jobs/route.ts` and `lib/__tests__/background-jobs-cron-no-advisory-lock.test.ts` (tracked separately)
  - `docs/planning/phase-110/*` (separate phase plan)
  - Admin dashboard workstream:
    - `components/dashboard/settings-view.tsx`
    - `components/dashboard/admin-dashboard-tab.tsx`
    - `actions/admin-dashboard-actions.ts`
  - Meeting overseer model/config workstream:
    - `lib/ai/prompt-registry.ts`
    - `lib/meeting-overseer.ts`
  - `actions/crm-actions.ts` includes additional CRM search changes unrelated to the manual sentiment draft fix.
- Lint/build/test were executed against the combined state to reduce integration surprises.

## Risks / Rollback
- Manual sentiment updates now **await** best-effort draft generation; on slow AI calls this could add latency to the setter action (tradeoff: drafts are immediately available for UI refetch).
- Email sanitization strips null bytes; this is safe for Postgres storage but may slightly alter raw bodies.
- Rollback is straightforward (no migrations); revert the touched files if needed.

## Follow-ups
- Live smoke test:
  - Mark a lead **Interested** and confirm drafts appear for `sms|email|linkedin` where inbound history exists.
  - Confirm email webhook stores messages with null bytes in provider payloads.
  - Monitor Insights booked-summaries logs to confirm `max_output_tokens` failures drop.
- If Insights still hits token exhaustion frequently, consider increasing `retryMax` further or lowering `outputScale` for the schema.
