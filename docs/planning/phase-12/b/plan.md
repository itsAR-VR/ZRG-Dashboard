# Phase 12b — System-Safe Draft Approval + Sending

## Focus
Create “system sender” functions that can approve/send AI drafts inside webhooks/cron (no user session), persisting outbound messages and marking drafts as sent.

## Inputs
- Existing draft generation + approval/sending code (search keys: `approveAndSendDraft`, `requireAuthUser`, `requireLeadAccess`)
- Integration clients/utilities in `lib/**` (GHL SMS/email, EmailBison, etc.)
- Message persistence helpers (how outbound messages are written today)

## Work
- Identify the current “approve + send” flow used by the UI and any auth/session dependencies.
- Introduce system-safe entrypoints (names are illustrative; follow repo conventions):
  - `approveAndSendDraftSystem(draftId, { sentBy: "ai" | "setter" })`
  - `sendSmsSystem(leadId, body, meta)`
  - `sendEmailSystem(leadId, body, subject?, meta)`
- Ensure system functions:
  - Load draft + lead + workspace/client + channel credentials
  - Send via the correct provider for the channel
  - Persist an outbound message row (with `sentBy` and `aiDraftId` when applicable)
  - Mark the draft as sent (idempotent if re-run by webhook retries)
- Make webhook/cron paths call these system-safe functions rather than server actions that require a logged-in user.

## Output
- Added system-safe SMS sender: `lib/system-sender.ts` (`sendSmsSystem`) with idempotency via `Message.aiDraftId`.
- Added system-safe draft send entrypoint: `actions/message-actions.ts` (`approveAndSendDraftSystem(draftId, { sentBy })`) for webhook/cron usage (no auth/session).
- Updated email senders to persist tracking + dedupe:
  - `actions/email-actions.ts` (`sendEmailReply`, `sendEmailReplyForLead`) now accept `{ sentBy }`
  - Draft email sends now set `Message.aiDraftId = draftId` and early-return if already sent
- Updated UI send wrappers to tag setter sends:
  - `actions/message-actions.ts` (`sendMessage`, `sendEmailMessage`, `sendLinkedInMessage`) now write `sentBy="setter"` on outbound messages (and `aiDraftId` when sending a LinkedIn draft).
- Updated system paths to stop depending on logged-in server actions:
  - `app/api/webhooks/ghl/sms/route.ts` now calls `approveAndSendDraftSystem(..., { sentBy: "ai" })`
  - `app/api/webhooks/email/route.ts` now calls `approveAndSendDraftSystem(..., { sentBy: "ai" })`
  - `lib/followup-engine.ts` now uses `sendSmsSystem` (cron-safe) instead of `sendMessage` (user-session only).

## Handoff
Subphase 12c can now gate webhook auto-sends by campaign mode/confidence and then call:
- `approveAndSendDraftSystem(draftId, { sentBy: "ai" })` for auto-sends
- Slack bump path can link to the lead and include `draftId` knowing outbound sends will be idempotent via `Message.aiDraftId`.
