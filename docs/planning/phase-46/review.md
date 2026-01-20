# Phase 46 — Review

## Summary
- Root cause confirmed: FC “double sets” are primarily duplicate outbound EmailBison reply `Message` rows created by the send→sync loop (one row with `emailBisonReplyId = NULL`, one with `emailBisonReplyId != NULL`).
- Implemented deterministic outbound “heal” in `syncEmailConversationHistorySystem(...)` to attach the provider reply id to the existing send-created row instead of inserting a second row.
- Improved setter draft regeneration to use the same transcript builder/window as automated draft generation, preserving booking-process context.
- Local quality gates passed (`npm run lint`, `npm run build`); no schema changes detected.
- Remaining: FC live/manual verification (provider send count + post-sync UI behavior) and optional cleanup of legacy duplicates.

## What Shipped
- Outbound EmailBison dedupe in sync: `lib/conversation-sync.ts`
- Additional sync observability counters (reply heal/import breakdown): `lib/conversation-sync.ts`
- Setter regenerate transcript + email bounce gating: `actions/message-actions.ts`
- CRM sentiment override now respects bounce gating when rejecting pending drafts: `actions/crm-actions.ts`
- Human vs AI outbound attribution in conversation UI: `actions/lead-actions.ts`, `components/dashboard/chat-message.tsx`
- FC duplicate detector/merger (dry-run default): `scripts/dedupe-fc-emailbison-outbound.ts`
- Phase artifacts: `docs/planning/phase-46/*`

## Verification

### Commands
- `npm run lint` — pass (Tue Jan 20 23:41:13 +03 2026; warnings only)
- `npm run build` — pass (Tue Jan 20 23:41:28 +03 2026)
- `npm run db:push` — skip (no `prisma/schema.prisma` changes detected in working tree)

### Notes
- Lint output includes pre-existing warnings (React hook deps, `<img>` usage, etc.) but no errors.
- `next build` succeeded; it warns about multiple lockfiles and deprecated middleware convention (pre-existing).
- Working tree is not clean and includes uncommitted/untracked artifacts from other phases (notably Phase 40/45). Build/lint were run on this combined state.
  - After the final CRM bounce-gating tweak (`actions/crm-actions.ts`), `npm run lint` and `npm run build` were re-run and still passed.

## Success Criteria → Evidence

1. Sending an EmailBison reply (manual or AI draft approval) results in **one** outbound email sent and **one** outbound `Message` row (no “double set” in the inbox UI).
   - Evidence:
     - Root cause + duplication pattern: `docs/planning/phase-46/a/plan.md`
     - Fix to prevent new duplicates during sync: `lib/conversation-sync.ts`
     - FC manual runbook: `docs/planning/phase-46/e/plan.md`
   - Status: partial (requires FC manual verification of provider send count + UI state after sync)

2. `syncEmailConversationHistorySystem(...)` no longer creates duplicate outbound `Message` rows for messages we already stored during send.
   - Evidence:
     - Outbound heal logic: `lib/conversation-sync.ts`
     - Dry-run detector shows legacy duplicates exist (example output): `npx tsx scripts/dedupe-fc-emailbison-outbound.ts --since-days 30 --limit 10 --verbose`
   - Status: partial (logic implemented; needs FC manual verification after an actual send+sync)

3. AI drafts (create + regenerate) reliably include correct booking-process context (stage/wave, booking link behavior, suggested times, qualifying questions), including setter-facing workflows.
   - Evidence:
     - Booking-process injection is centralized in `lib/ai-drafts.ts` via `getBookingProcessInstructions(...)`
     - Setter regenerate now uses `buildSentimentTranscriptFromMessages(...)` + recent-message window: `actions/message-actions.ts`
   - Status: partial (logic improved; needs FC manual verification of actual draft content)

4. Lint/build pass (`npm run lint`, `npm run build`) and a written verification runbook exists for FC.
   - Evidence:
     - Commands ran successfully (see Verification section above)
     - Runbook exists: `docs/planning/phase-46/e/plan.md`
   - Status: met

## Plan Adherence
- Planned: capture provider reply id on send if available; fallback to robust sync healing.
  - Implemented: robust sync healing (time-window + subject preference) without adding new synchronous EmailBison API calls.
- Planned: improve setter regenerate transcript quality and ensure booking-process context is used.
  - Implemented: regenerate now uses `buildSentimentTranscriptFromMessages(...)` over recent messages, preserving channel/subject context.
- Planned: add lightweight validation harness without adding a new test runner.
  - Implemented: `tsx` script under `scripts/` for detection/optional cleanup.

## Risks / Rollback
- Risk: false-positive heal merges two distinct outbound emails if multiple sends occur within the time window.
  - Mitigation: heal is constrained (`leadId`, `direction=outbound`, `source="zrg"`, near-time window, prefer exact `subject`), and aborts on ambiguity → falls back to insert.
- Rollback lever: revert the outbound heal block in `lib/conversation-sync.ts` (returns to prior behavior) and/or widen/narrow the heal window constants.

## Follow-ups
- Run FC manual verification (Phase 46e runbook) to confirm:
  - one provider send per action
  - no extra outbound row appears after sync
  - regenerated drafts include correct booking-process behavior for the current stage/wave
- Optional: run `scripts/dedupe-fc-emailbison-outbound.ts` in `--dry-run` first, then `--apply` in a safe environment to remove legacy duplicates.
- Optional: add a small counter/metric for “outbound heal vs insert” to make regressions visible without log scraping.
