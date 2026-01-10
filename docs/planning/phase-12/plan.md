# Phase 12 — Per-Campaign AI Auto-Send (80/20), Provider-Aware Booking, Analytics + Export

## Purpose
Restore booking conversion by replying instantly (when safe) on a per-campaign basis, while adding clean AI-vs-Setter tracking and campaign-level reporting (including a ChatGPT-friendly export).

## Context
Campaigns are generating replies but booking conversion is poor. The highest-leverage fix is sending natural replies near-instantly to **positive replies**. We also need an experiment framework (campaign assignment) to compare setter-managed vs AI auto-send, plus provider-aware booking detection (GHL vs Calendly) and reporting to identify which campaigns and follow-ups convert.

## Objectives
* [x] Add per-campaign response mode config (SETTER_MANAGED vs AI_AUTO_SEND) + threshold defaults on sync
* [x] Implement webhook/cron-safe “system sender” functions (no logged-in user required)
* [x] Add confidence + safety gate for AI_AUTO_SEND campaigns, including Slack DM bump to Jon when not safe/high-confidence
* [x] Add outbound tracking to compare AI auto-send vs setter sends
* [x] Standardize provider-aware booking helpers (GHL + Calendly) and remove hardcoded “GHL-only” checks
* [x] Ship per-campaign analytics + weekly report + “Download dataset for ChatGPT” export (leads.csv + messages.jsonl)

## Constraints
- **Definitions are locked:**
  - Positive replies: `Interested`, `Information Requested`, `Meeting Requested`, `Call Requested` (use the repo’s canonical sentiment constants if spelling differs in code)
  - Meetings requested: `Meeting Requested`, `Call Requested`
  - Meetings booked must be **provider-aware** (GHL vs Calendly) and must not be hardcoded anywhere
- **AI drafts are already generated** for all positive replies; keep draft trigger logic as-is.
- Webhook/cron execution must not depend on any server action requiring a user session (no `requireAuthUser()` / `requireLeadAccess()` gating).
- Slack bump is a **DM** to Jon (resolve by email `jon@zeroriskgrowth.com`) and only for **AI_AUTO_SEND** campaigns when confidence is below threshold or requires review.
- Auto-send threshold default: **0.90** for AI_AUTO_SEND campaigns.
- Never commit secrets/tokens; validate webhook/cron secrets before reading request bodies.
- Export includes names/emails and full message bodies, so endpoints must be access-controlled and scoped to authorized workspaces.

## Success Criteria
- [x] AI_AUTO_SEND campaign: inbound positive reply → draft generated → confidence ≥ threshold and safe_to_send → auto-send occurs within seconds and is persisted as outbound with `sentBy="ai"`.
- [x] AI_AUTO_SEND campaign, confidence low/requires review: inbound positive reply → no auto-send → Jon receives Slack DM with draft + reason + link to lead in dashboard.
- [x] SETTER_MANAGED campaign: inbound positive reply → no auto-send and no Slack DM bump.
- [x] Booking detection works for both providers depending on workspace settings (GHL appointment field vs Calendly invitee/scheduled-event URI).
- [x] Analytics endpoint returns per-campaign: positive replies, meetings requested, meetings booked, and derived rates (including segmentation by industry/headcount bucket where present).
- [x] “Download dataset for ChatGPT” produces `leads.csv` and `messages.jsonl` including lead names/emails and message threads with `sentBy`.

## Subphase Index
* a — Data model + campaign config defaults
* b — System-safe draft approval + sending
* c — Confidence gate + Slack DM bump (webhook path)
* d — Provider-aware booking helpers + adoption
* e — Per-campaign analytics + weekly report
* f — ChatGPT export (leads.csv + messages.jsonl) + UI button

## Phase Summary
- Per-campaign auto-send framework:
  - Prisma: `EmailCampaign.responseMode` + `EmailCampaign.autoSendConfidenceThreshold` (default setter-managed + 0.90 threshold).
  - Webhooks: AI_AUTO_SEND campaigns run `evaluateAutoSend` → auto-send via `approveAndSendDraftSystem` or Slack DM Jon for review.
- System-safe sending + tracking:
  - `lib/system-sender.ts` (`sendSmsSystem`) + `actions/message-actions.ts` (`approveAndSendDraftSystem`) to send from webhooks/cron with no user session.
  - `Message.sentBy` + `Message.aiDraftId` persisted for outbound attribution and idempotency.
- Provider-aware booking:
  - `lib/meeting-booking-provider.ts` provides `isMeetingBooked` and `getBookingLink`, and follow-up templates now resolve `{calendarLink}` via provider-aware booking links.
- Reporting + export:
  - `actions/analytics-actions.ts` adds `getEmailCampaignAnalytics` (weekly report + per-campaign KPIs).
  - `app/api/export/chatgpt/route.ts` exports `leads.csv` + `messages.jsonl` as a `.zip` (auth + workspace-scoped), with a dashboard button in `components/dashboard/analytics-view.tsx`.
- Validation:
  - Ran `npx prisma db push --accept-data-loss` (schema in sync).
  - `npm run lint` (warnings only) and `npm run build` succeeded.
