# Phase 81f — Webhook/Slack Alignment + Logging/Docs Cleanup

## Focus

Align Slack interactions + legacy email webhook with per-workspace approval recipients and remove hardcoded “notify Jon” assumptions. Update docs and logs to reflect configurable recipients.

## Inputs

- `lib/slack-dm.ts`: `sendSlackDmByUserIdWithToken`, `updateSlackMessageWithToken`
- `lib/auto-send/get-approval-recipients.ts`: `getSlackAutoSendApprovalConfig`
- Existing files using hardcoded Slack email or “notify Jon” logging

## Work

1. **Slack interactions webhook**
   - Update `app/api/webhooks/slack/interactions/route.ts` to:
     - Load `Client.slackBotToken` by `value.clientId`
     - Use `updateSlackMessageWithToken` for all message updates
     - Return a clear error when token is missing

2. **Email webhook auto-send review DM**
   - Update `app/api/webhooks/email/route.ts` to replace `sendSlackDmByEmail("jonandmika@gmail.com")` with:
     - `getSlackAutoSendApprovalConfig(client.id)`
     - Loop over configured recipients and send DMs via `sendSlackDmByUserIdWithToken`
     - If missing token or recipients, **skip** without logging a failure

3. **Log messaging cleanup**
   - Replace “Failed to notify Jon” strings with neutral wording in:
     - `lib/inbound-post-process/pipeline.ts`
     - `lib/background-jobs/email-inbound-post-process.ts`
     - `lib/background-jobs/sms-inbound-post-process.ts`

4. **Docs update**
   - Update `lib/auto-send/README.md` to describe configurable recipients and skip behavior when none configured.

## Output

- `app/api/webhooks/slack/interactions/route.ts`: Slack message updates now use workspace token
- `app/api/webhooks/email/route.ts`: Review DMs sent to configured recipients via workspace token
- Neutralized “notify Jon” logs in inbound/background jobs
- `lib/auto-send/README.md`: Documented configurable recipients + skip behavior
- `lib/auto-send/types.ts`: Removed unused hardcoded review email constant

## Handoff

Phase 81 completed with aligned Slack interactions, updated webhook logic, and neutral logs/docs.
