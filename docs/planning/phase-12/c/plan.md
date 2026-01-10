# Phase 12c — Confidence Gate + Slack DM Bump (Webhook Path)

## Focus
After generating an AI draft for a positive reply, run a lightweight evaluator for AI_AUTO_SEND campaigns only. Auto-send when safe and confident; otherwise DM Jon with the draft + reason + link.

## Inputs
- Inbound reply webhook ingestion (search keys: `webhook`, `bison`, `EmailBison`, `campaignId`, `autoReplyEnabled`)
- AI draft generation pipeline (already triggers on positive replies)
- System-safe sending from Phase 12b
- Existing Slack utilities (search keys: `SLACK`, `chat.postMessage`)

## Work
- Implement evaluator output shape:
  - `confidence (0..1)`
  - `safe_to_send (boolean)`
  - `requires_human_review (boolean)`
  - `reason (string)`
- Enforce hard blockers (always require review / never auto-send):
  - Unsubscribe/opt-out language
  - Ambiguous/missing context required to answer
  - Anything flagged high-risk by evaluator
- Decision logic (AI_AUTO_SEND only):
  - If `safe_to_send && confidence >= threshold` → `approveAndSendDraftSystem(..., { sentBy: "ai" })`
  - Else → do not send; Slack DM Jon with draft + context
- Slack DM implementation (Slack Web API):
  - `users.lookupByEmail({ email: "jon@zeroriskgrowth.com" })` (cache userId to avoid repeated lookups)
  - `conversations.open({ users: userId })`
  - `chat.postMessage({ channel, text/blocks })`
  - Required scopes: `chat:write`, `users:read.email`, and DM open scope (`im:write` or `conversations.open` equivalent)
- DM content (minimum):
  - Lead name + email
  - Campaign name + campaignId
  - Sentiment tag
  - Confidence + reason
  - Draft preview
  - Link to open lead in dashboard
- Ensure **no Slack bumps** for SETTER_MANAGED campaigns.

## Output
- Added evaluator:
  - Prompt template: `lib/ai/prompt-registry.ts` (`auto_send.evaluate.v1`)
  - Runtime: `lib/auto-send-evaluator.ts` (`evaluateAutoSend`) → `{ confidence, safeToSend, requiresHumanReview, reason }`
- Added Slack DM helper (Slack Web API, DM-by-email with caching + dedupe):
  - `lib/slack-dm.ts` (`sendSlackDmByEmail`)
  - Uses `users.lookupByEmail` → `conversations.open` → `chat.postMessage`
  - Supports `SLACK_BOT_TOKEN` and optional `SLACK_JON_USER_ID` env cache
- Wired AI_AUTO_SEND gating into inbound webhooks:
  - `app/api/webhooks/email/route.ts`:
    - If `emailCampaign.responseMode === "AI_AUTO_SEND"`: run evaluator → auto-send via `approveAndSendDraftSystem(..., { sentBy: "ai" })` when `confidence >= emailCampaign.autoSendConfidenceThreshold`
    - Else: no auto-send and no Slack DM (SETTER_MANAGED default)
  - `app/api/webhooks/ghl/sms/route.ts`:
    - If lead is linked to an EmailCampaign with `responseMode === "AI_AUTO_SEND"`: same evaluator + auto-send/DM behavior
    - Falls back to legacy `lead.autoReplyEnabled` only when no EmailCampaign is present

## Handoff
Subphase 12d can now standardize booking detection/link generation knowing:
- Auto-sends are campaign-driven (AI_AUTO_SEND only) and will DM Jon on low-confidence.
- Auto-send copy that suggests booking can safely call provider-aware helpers (`getBookingLink`, `isMeetingBooked`) once implemented.
