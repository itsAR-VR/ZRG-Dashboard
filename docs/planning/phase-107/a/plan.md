# Phase 107a — EmailBison Reply Composition: Stop Signature/Link Copying

## Focus
Prevent outbound EmailBison replies from appending the recipient’s signature/link block after our own signature, matching the Jam’s “link issue + signature issue”.

## Inputs
- Jam `fd4cf691-596b-4061-92de-d05e05434867` (segment where links/signature appear after our signature).
- Current reply sender: `sendEmailReplySystem()` in `lib/email-send.ts` (EmailBison payload includes `inject_previous_email_body: true`).
- Existing safe HTML/plaintext utilities: `lib/email-format.ts`, `lib/safe-html.ts`.

## Work
1. **Locate the exact code** (RED TEAM verified):
   - Open `lib/email-send.ts` lines 410-430 (EmailBison reply payload construction)
   - Line 422: `inject_previous_email_body: true` is the root cause
2. **Test threading without injection** (dev environment):
   - Set `inject_previous_email_body: false` temporarily
   - Send a reply to an existing EmailBison thread
   - Verify reply appears in correct thread (threading relies on `reply_id` parameter, not body injection)
3. **Implement the fix**:
   - If threading works: change line 422 to `inject_previous_email_body: false`
   - If threading breaks: implement explicit quoted section (`--- Original Message ---` + sanitized prior body) and keep injection disabled
4. **Add targeted tests**:
   - Create `lib/__tests__/email-send.test.ts` (if not exists)
   - Mock `sendEmailBisonReply` and assert payload has `inject_previous_email_body: false`
5. **Cross-phase regression test** (Phase 105):
   - Trigger a follow-up email (Phase 105 scenario) to a thread with recipient signature/links
   - Verify: only one send occurs (idempotency), recipient signature not duplicated

## Validation (RED TEAM)
- [ ] Send EmailBison reply to thread with recipient signature/links → delivered email does not append recipient signature as plain text
- [ ] Reply appears in correct thread (threading via `reply_id` works)
- [ ] Phase 105 regression: follow-up email idempotency still works (no duplicate sends)
- [ ] Unit test passes: payload has `inject_previous_email_body: false`

## Output
- Disabled EmailBison `inject_previous_email_body` injection to stop appending the lead’s previous email body (signature/links) into our outbound replies.
  - New helper: `lib/emailbison-reply-payload.ts`
  - Wiring change: `lib/email-send.ts` now builds the EmailBison payload via the helper.
  - Wiring change: `lib/reactivation-engine.ts` now builds the EmailBison payload via the helper for reactivation bump replies.
- Added unit test + registered it:
  - `lib/__tests__/emailbison-reply-payload.test.ts`
  - `scripts/test-orchestrator.ts`

## Handoff
- Provide the final behavior contract (whether we disable injection entirely or replace it with a quoted section) to Phase 107b/107c so they can rely on correct outbound message composition when evaluating drafts and prompts.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented EmailBison reply payload builder with `inject_previous_email_body: false`.
  - Updated EmailBison send path to use the builder (keeps payload shape stable, stops signature/link copying).
  - Added a unit test to prevent regressions.
- Commands run:
  - `rg -n "inject_previous_email_body" lib/email-send.ts` — located injection flag.
- Blockers:
  - Cannot validate real delivered-email threading/body behavior without a configured EmailBison workspace + live send.
- Next concrete steps:
  - Run `npm test` to lock the unit test.
  - Manually reply to a known EmailBison thread and confirm signatures/links are not appended and thread still matches.
