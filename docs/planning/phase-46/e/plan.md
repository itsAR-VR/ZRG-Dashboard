# Phase 46e — Verification + Rollout (Founders Club)

## Focus
Prove the fixes prevent “double sets” in FC and that booking-aware drafts behave correctly end-to-end.

## Inputs
- Phase 46a root-cause report
- Phase 46b/46c/46d implementation changes
- FC workspace id: `ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`

## Work
1) Local checks:
   - `npm run lint`
   - `npm run build`
2) Manual runbook (FC):
   - Pick a lead with an existing EmailBison thread.
   - Send a manual email reply from the dashboard.
   - Confirm:
     - lead receives exactly one email
     - dashboard shows exactly one outbound `Message` row for that send
   - Trigger/observe `syncEmailConversationHistorySystem(...)` and confirm it heals rather than inserts.
3) Booking-process draft fidelity:
   - For a lead/campaign with booking process stages that include booking link/times/questions, regenerate a draft and confirm:
     - booking link behavior is correct (no placeholders; correct link form)
     - suggested times and/or qualifying questions appear according to stage config
     - wave/stage progression behaves as expected after sends
4) Regression checks:
   - Ensure campaign-sent emails (`EMAIL_SENT`) still ingest correctly and do not create duplicates.
   - Ensure AI auto-send (when enabled) remains idempotent (no duplicate sends).

## Output
- A short “done” checklist with screenshots/log snippets (redacted) proving the issue is resolved in FC.

## Handoff
If verification passes, the phase is ready for merge/deploy. If not, loop back to 46a with the newly observed failure mode and adjust 46b’s dedupe strategy.

## Output (Filled)
### Local checks
- `npm run lint`: ✅ passed (warnings only; no errors)
- `npm run build`: ✅ passed

### FC verification runbook (manual)
1) In the FC workspace (`clientId = ef824aca-a3c9-4cde-b51f-2e421ebb6b6e`), pick a lead with an EmailBison reply thread.
2) Send an EmailBison reply from the dashboard (either:
   - approve + send an email draft, or
   - send a manual email reply).
3) Confirm:
   - recipient receives **one** email
   - dashboard shows **one** new outbound email message
4) Trigger/observe an EmailBison sync for that lead (via existing UI “Sync” or background sync after send).
5) Confirm:
   - no second outbound message appears after sync
   - logs show an outbound heal line like: `[EmailSync] Healed outbound replyId ... -> message ...`
6) Regenerate a draft in ActionStation and confirm the generated content includes the expected booking-process behavior (link rules, times/questions) for the lead’s current stage/wave.

## Handoff (Filled)
Proceed to **46f** to add a deterministic FC duplicate-detector script (and optional cleanup mode) so we can:
- quantify legacy duplicates,
- validate “no new duplicates” after deploy,
- and optionally remove existing duplicate rows without exposing PII.
