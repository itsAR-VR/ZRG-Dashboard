# Lead Reactivation (Phase 1) — Handoff

This doc covers what was implemented for **Lead Reactivation (manual CSV re-engagement)** in `ZRG-Dashboard`, plus the concrete steps to deploy/test/verify it is running in production.

## What shipped (high level)

Goal: upload a CSV of leads (per workspace/client), resolve each lead to an EmailBison thread, then send a **bump email in the same thread** while enforcing **5 reactivation emails/day per sender email address**.

Key behaviors:
- **Per-workspace uploads**: CSV import creates/updates enrollments under a Reactivation Campaign owned by the selected workspace/client.
- **Thread anchor**: pick the **most recent outbound (“Sent”) reply that has a non-null `campaign_id`**. If none exists → `needs_review`.
- **Sender selection**:
  - Prefer the original `sender_email_id` used for the anchor email if it is still present and sendable.
  - If missing/non-sendable → mark as “dead” and pick a fallback sender from current `/api/sender-emails`.
- **Daily limits**: enforce **5/day per sender_email_id**. If at limit, schedule for the next day 9:00am in workspace timezone.
- **Reuse existing follow-up sequencing**: after the bump, optionally start the existing follow-up sequence system (no-response sequences are OK to trigger).

## Where it lives (code map)

UI:
- `components/dashboard/follow-ups-view.tsx` — adds a new Follow-ups sub-tab: **Reactivations**
- `components/dashboard/reactivations-view.tsx` — campaign CRUD + CSV import + enrollments table + “Run now”

Server Actions:
- `actions/reactivation-actions.ts` — campaign CRUD, CSV import, enrollment reset, manual “run now”

Reactivation engine:
- `lib/reactivation-engine.ts` — sender snapshot refresh, enrollment resolution (anchor+sender), send processing, rate limiting, follow-up start

EmailBison / MeetInboxXia API client:
- `lib/emailbison-api.ts` — sender emails, lead lookup helpers, replies fetch, global replies fallback, send reply

Cron:
- `app/api/cron/reactivations/route.ts` — cron handler (refresh snapshots → resolve → send)
- `vercel.json` — schedules `/api/cron/reactivations` every 10 minutes

DB schema (Prisma):
- `prisma/schema.prisma`
- Sync command used: `npm run db:push`

## Data model (Prisma)

### `ReactivationCampaign`
Workspace-owned configuration for reactivation runs.
- `clientId` (workspace)
- `emailCampaignId?` (optional DB relation)
  - Used to filter anchor selection by EmailBison `campaign_id` via `EmailCampaign.bisonCampaignId`
- `followUpSequenceId?` (optional) — start this sequence after the bump
- `dailyLimitPerSender` (default `5`)
- `bumpMessageTemplate` — supports `{firstName}`

### `ReactivationEnrollment`
1 row per (campaign, lead). Tracks resolution + send lifecycle.
Statuses:
- `pending_resolution` → needs lead_id + anchor reply + sender decision
- `ready` → eligible to send now
- `rate_limited` → queued for next day
- `sent` → bump sent and logged
- `needs_review` → missing anchor, missing sender, missing config, etc.
- `failed` → send attempt failed

Key fields:
- `emailBisonLeadId` — numeric string `lead_id`
- `anchorReplyId` — reply to respond to (thread anchor)
- `anchorCampaignId` — EmailBison `campaign_id` of the anchor reply
- `originalSenderEmailId` — EmailBison `sender_email_id` from anchor
- `selectedSenderEmailId` — actual sender used (original or fallback)
- `deadOriginalSender`, `deadReason`
- `nextActionAt` — scheduled send time

### `EmailBisonSenderEmailSnapshot`
Periodic snapshot from `GET /api/sender-emails`.
- `senderEmailId` (EmailBison `sender_email_id`)
- `status`, `isSendable` (heuristic classification)

### `ReactivationSenderDailyUsage`
Per workspace + sender_email_id + dateKey usage counter.
- `dateKey` is `YYYY-MM-DD` in workspace timezone
- Used to enforce **5/day per sender**

### `ReactivationSendLog`
Append-only send log per enrollment/step.
- Unique `(enrollmentId, stepKey)` (currently uses `bump_1`)

## EmailBison API usage (based on the real response shapes)

API base: `https://send.meetinboxxia.com`

Endpoints used:
- `GET /api/sender-emails`
  - Snapshot senders and compute `isSendable`
- `GET /api/leads` (best-effort search by email)
  - The upstream docs list the endpoint but do not specify the exact query param for searching; code tries several common patterns.
- `GET /api/leads/{lead_id}/replies`
  - Select thread anchor from the most recent reply where:
    - `folder` contains “sent”
    - `campaign_id` is not null (required)
    - `sender_email_id` is not null (required)
- Fallback: `GET /api/replies?filters[search]=email`
  - Used only if lead search cannot find a lead_id; we extract `lead_id` from any matching reply payloads.
- `POST /api/replies/{reply_id}/reply`
  - Sends the bump email in-thread using `sender_email_id`

API reference: `https://send.meetinboxxia.com/api/reference`

## Operational flow (what cron does)

Cron route: `GET /api/cron/reactivations`
- Auth: `Authorization: Bearer ${CRON_SECRET}` (also supports `x-cron-secret` header)
- Runs:
  1) Refresh sender snapshots (TTL-based)
  2) Resolve pending enrollments (lead_id → replies → anchor+sender)
  3) Send due enrollments (rate limit enforced)

Manual trigger (example):
```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://<your-app-domain>/api/cron/reactivations"
```

## UI flow (operator runbook)

1) Open **Follow-ups → Reactivations**
2) Create/select a Reactivation campaign
   - Recommended: choose the matching Email Campaign so anchor resolution is locked to a single `campaign_id`.
   - Set daily limit (default 5).
   - Optionally set a follow-up sequence to start after sending.
3) Upload CSV (must contain at least an `email` column)
4) Click **Run now**
   - Enrollments move to `ready`, `needs_review`, or `rate_limited`.
5) Click **Run now** again (or wait for cron)
   - `ready` enrollments send and move to `sent`.

## Verification checklist (after deploy)

### A) Deploy verification
- Confirm the deployed app includes the Reactivations tab.
- Confirm `vercel.json` cron schedule is deployed and visible in Vercel dashboard.
- Confirm `CRON_SECRET` exists in Vercel env.

### B) API verification (no sends)
1) Call cron without secret → expect `401`
2) Call cron with secret → expect `200` JSON with `snapshots/resolved/sent`

### C) Safe functional verification (small CSV, low risk)
Use a test CSV with 1–3 emails that you are confident are:
- in EmailBison
- have at least one outbound “Sent” reply with a campaign_id

Expected outcomes:
- `pending_resolution` → `ready` after resolution
- `ready` → `sent` after send
- A new outbound `Message` row is created
- `ReactivationSendLog` is written with `stepKey=bump_1`
- If follow-up sequence configured: a `FollowUpInstance` is created/activated

### D) Edge case verification
- Lead not found in EmailBison → `needs_review` (“lead_id not found”)
- No sent-thread anchor with `campaign_id` → `needs_review`
- Original sender missing/non-sendable → `deadOriginalSender=true` and fallback sender selected
- All senders at daily limit → enrollment becomes `rate_limited` with `nextActionAt` set to next-day 9am (workspace timezone)
- Blacklisted lead → never sends; stays `needs_review`

## Known gaps / follow-ups (recommended)

1) **Lead search parameter**: `/api/leads` search by email is best-effort (tries multiple query param patterns). Confirm the canonical pattern from the API and simplify to one reliable call.
2) **Sender status mapping**: `isSendable` is heuristic (string matching). If the API has a formal enum, codify it explicitly.
3) **Backfill default campaign for existing workspaces**: provisioning creates a default “Reactivation” campaign, but existing workspaces won’t get one automatically unless created in the UI.
4) **Allowed sender pool UI**: `allowedSenderEmailIds` exists in schema for future restriction, but the UI does not expose it yet.

## Security notes

- Never commit `.env.local`.
- `CRON_SECRET` must stay private (cron route is privileged).
- Consider rotating any secrets that were ever shared in chat or screenshots.

