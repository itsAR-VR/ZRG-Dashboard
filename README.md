# ZRG AI Master Inbox & CRM Dashboard

A scalable, full-stack application designed to manage high-volume sales outreach. This system replaces legacy n8n/Airtable workflows by unifying Email, SMS (GoHighLevel), and LinkedIn conversations into a single "Master Inbox" with AI-driven sentiment analysis, automatic drafting, and campaign management.

**Current Status:** Phases I–IV complete for core operations (SMS + Email inbox, follow-up automation, LinkedIn outbound via Unipile, calendar availability + booking). LinkedIn inbound ingestion is still pending.

**Live Demo:** [https://app.codex.ai/](https://app.codex.ai/)

---

## 🏗 Architecture

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 16 (App Router), Tailwind CSS, Shadcn UI, Lucide Icons |
| **Backend** | Next.js Server Actions & API Routes |
| **Database** | Supabase (PostgreSQL) with Prisma ORM |
| **AI Engine** | OpenAI (GPT-5.1 / GPT-5-mini / GPT 5-nano) |
| **Hosting** | Vercel (Serverless) |
| **Email Platform** | EmailBison (Inboxxia) / SmartLead / Instantly - Cold email campaigns & replies |
| **SMS Platform** | GoHighLevel (GHL) - SMS messaging & CRM sync |
| **LinkedIn Platform** | Unipile - LinkedIn connection requests + DMs |

---

## ✅ Completed Features

### Phase I: GoHighLevel SMS Integration
- [x] SMS webhook ingestion (`/api/webhooks/ghl/sms`)
- [x] AI sentiment classification of incoming messages
- [x] Dynamic multi-tenancy (multiple GHL workspaces via API keys)
- [x] Conversation threading and message history
- [x] CRM drawer for lead management

### Phase II: Email Integration & Intelligence
- [x] **Inboxxia Integration** - Full email campaign management
- [x] **Multi-Event Webhook Handler** (`/api/webhooks/email`) supporting 7 event types:
  | Event | Description |
  |-------|-------------|
  | `LEAD_REPLIED` | Inbound reply processing with AI sentiment classification |
  | `LEAD_INTERESTED` | Inboxxia's positive interest signal - upgrades sentiment |
  | `UNTRACKED_REPLY_RECEIVED` | Replies from unknown senders - auto-creates leads |
  | `EMAIL_SENT` | Records outbound campaign emails in conversation feed |
  | `EMAIL_OPENED` | Tracks email opens (analytics logging) |
  | `EMAIL_BOUNCED` | Blacklists lead + creates visible bounce notification |
  | `LEAD_UNSUBSCRIBED` | Blacklists lead with unsubscribe status |
- [x] **AI Draft Generation** - Context-aware response drafts based on sentiment
- [x] **Auto-Reply System** - Automatic sending when enabled per lead
- [x] **Auto-Reply Safety Gate** - Suppresses replies to opt-outs, automated replies, and acknowledgement-only messages
- [x] **Email Body Sanitization** - Strips quoted text, signatures, HTML boilerplate
- [x] **Deduplication** - Prevents duplicate messages via `emailBisonReplyId` and `inboxxiaScheduledEmailId`
- [x] **Campaign Sync** - Syncs Inboxxia campaigns to dashboard
- [x] **Unified Inbox** - SMS and Email in single conversation view with platform/channel badges
- [x] **EmailGuard Validation** - Validates recipient domains before sending replies (auto-blacklists invalid)

### Multi-Channel Lead Architecture (New)
- [x] **Single Lead, Multiple Channels** — Leads can own SMS + Email + LinkedIn (outbound supported; inbound pending).
- [x] **`Message.channel`** — Explicit channel field (`sms` | `email` | `linkedin`) on all messages.
- [x] **Cross-Channel Dedup** — `findOrCreateLead` utility matches by email **or** normalized phone to prevent duplicate leads across webhooks.
- [x] **GHL SMS Webhook** — Uses unified lead-matching, captures email when present, saves `channel: "sms"`.
- [x] **Inboxxia Email Webhook** — Uses unified lead-matching, saves `channel: "email"`.
- [x] **Inbox UI** — Conversation cards show all active channels; Action Station has channel tabs (SMS/Email) and supports LinkedIn follow-up steps.

### Phase III: LinkedIn Integration (Unipile)
- [x] **Outbound LinkedIn Messaging** — Follow-up steps can send LinkedIn DMs via Unipile.
- [x] **Connection Request Automation** — If not connected, sends a connection request with the follow-up step message as the note.
- [x] **Sequence Conditions** — `linkedin_connected` supported for step gating.

### Phase IV: Calendar Automation (Availability + Booking)
- [x] **Calendar Link Management** — Multiple calendar links per workspace (`CalendarLink`), default link used as availability source-of-truth.
- [x] **Live Availability Cache** — Per-workspace `WorkspaceAvailabilityCache` refreshed every 10 minutes (30-day lookahead).
- [x] **GHL Widget Support** — Handles GHL `/widget/booking/` and `/widget/bookings/` (including custom domains) and parses `NUXT_DATA` variants.
- [x] **Lead Timezone Display** — Slots display in lead timezone (“your time”), fallback to workspace timezone with explicit TZ label.
- [x] **Offered Slot Persistence** — When the system proposes times, it stores `Lead.offeredSlots` for later matching.
- [x] **Slot Distribution + Soft Holds** — Workspace-wide `WorkspaceOfferedSlot` tracks how often a slot has been offered; suggestions prefer the next 5 days and spread across days (morning + afternoon) before reusing.
- [x] **Booking Modal (All Slots + Grid)** — “Book Meeting (GHL)” shows all available slots for the next 30 days in a scrollable grid and displays per-slot offered counts.
- [x] **Snooze-by-Reply** — Messages like “call after Jan 13” set `Lead.snoozedUntil`, pause sequences until that date, and filter booking availability to start after the snooze cutoff.
- [x] **Hardened Auto-Booking** — Only books when the lead clearly accepts one of the offered slots; ambiguous “yes/sounds good” routes to Follow-ups instead.
- [x] **Lead Scheduler Link (Manual Review)** — Captures lead-provided scheduler links and creates a review task (with overlap suggestions when possible). See `docs/notes/booking-process-5.md`.
- [x] **Warn-Only Calendar Mismatch** — If the calendar inferred from the Calendar Link differs from `ghlDefaultCalendarId`, UI warns but does not block booking.
- [ ] **Meeting Completion Tracking (Deferred)** — Attendance/no-show signals are not tracked yet; for now we treat a provider-verified booking as “meeting completed” until completion tracking is implemented.

### Phase IV: Follow-Up Automation (No-Response Sequences)
- [x] **Auto-Start on Outbound Touch** — Starts `triggerOn="no_response"` sequences when SMS/Email/LinkedIn is sent.
- [x] **Pause on Reply** — Pauses no-response sequences when the lead replies.
- [x] **Re-Engage After 7 Days** — Resumes paused sequences at the next step if the lead goes ghost for 7+ days.
- [x] **Auto-Send When Allowed** — Steps with `requiresApproval=false` send automatically (SMS/LinkedIn; email is reply-only when a thread exists, otherwise queues a task).

### Dashboard Features
- [x] **Inbox View** - Filterable conversation list with search
- [x] **Action Station** - AI draft review, edit, approve/reject workflow
- [x] **Channel Tabs** - Switch per-lead between SMS/Email (LinkedIn outbound supported via follow-ups) with per-channel message counts
- [x] **CRM Drawer** - Lead details, status management, sentiment tags
- [x] **Settings Page** - Workspace management, API key configuration
- [x] **Email Credential Management** - Inboxxia API key input per workspace

### Client Portal Users (Read-Only)
- **Resend per workspace:** Configure `Resend` API key + From email in Settings → Integrations → Resend (stored on `Client`).
- **Provisioning:** Settings → Team → Client Portal Users → enter client email (optional temp password) → “Create & Send Login”.
- **Password resets:** Use the same panel (“Reset password”) or the client can use “Forgot password”.
- **Permissions:** Inbox + CRM + draft approval only. Settings are read-only; AI personality is view-only; prompts/cost/observability are hidden.
- **Mobile app:** Uses the same Supabase email/password credentials as web.

---

## 🧭 Roadmap (Planned / Skeleton-Only Fields)

- **Analytics → CRM Sheet Replica**: replicate the Founders Club CRM Google Sheet view inside the Analytics tab with live updates as interest is registered.
- **Pipeline Tracking**: stage, value, and outcome fields exist as nullable schema skeletons; full pipeline workflows and UI are not yet implemented.
- **Sales Call Metadata**: placeholders for call context, score, coaching notes, and recording URL are present; capture + review flows are not yet implemented.
- **AI Optimization Loop**: use CRM + pipeline outcomes to tune campaigns, responses, and sales coaching; planned but not yet built.

---

## 🔌 Core Integrations

### GoHighLevel (SMS)
- **Webhook:** `/api/webhooks/ghl/sms?locationId={GHL_LOCATION_ID}`
- **Features:** Inbound SMS processing, contact sync, conversation threading
- **Auth:** Private Integration API Key per workspace
- **Note:** Outbound SMS sent by GHL automations is not ingested yet, so any “Outbound leads contacted” KPI derived purely from our DB will be incomplete until outbound SMS webhooks or export syncing is added.

#### Always-on Contact Hydration (SMS Sync)
- Sync (single lead + Sync All) will **search/link** missing `Lead.ghlContactId` via GHL contact search by email (no contact creation), then hydrate missing lead fields from the GHL contact (notably `phone`).
- One-time repair for existing data (all clients/leads, including non-responders):
  - Dry run: `npx tsx scripts/backfill-ghl-lead-hydration.ts --dry-run`
  - Apply + resumable: `npx tsx scripts/backfill-ghl-lead-hydration.ts --apply --resume`

#### SMS Sub-clients (Attribution)
- Inbound SMS webhooks can include a sub-client/campaign label in `customData.Client` (stored per workspace as `SmsCampaign` and linked via `Lead.smsCampaignId`).
- Optional backfill for legacy leads (tags-based): `npx tsx scripts/backfill-sms-campaign.ts --dry-run`
  - Requires `DATABASE_URL`; uses each workspace’s `Client.ghlPrivateKey` to fetch contact tags.
  - Uses `gpt-5-nano` by default (requires `OPENAI_API_KEY`); pass `--no-llm` for deterministic-only mode (supports tags like `<name> sms <date>`).

### Email Providers (EmailBison / SmartLead / Instantly)
- **Single-select per workspace:** configure exactly one provider via `Client.emailProvider` (the server rejects multiple configured providers).
- **EmailBison (Inboxxia)**
  - **Webhook:** `/api/webhooks/email` (optionally `?clientId={ZRG_CLIENT_ID}`)
  - **Base URL:** `https://send.meetinboxxia.com`
  - **Auth (API):** Bearer token (API key per workspace)
- **SmartLead**
  - **Webhook:** `/api/webhooks/smartlead?clientId={ZRG_CLIENT_ID}`
  - **Auth (webhook):** per-workspace secret (`Client.smartLeadWebhookSecret`) via payload `secret_key` (or `Authorization: Bearer ...`)
  - **Auth (API):** API key per workspace (`Client.smartLeadApiKey`)
- **Instantly**
  - **Webhook:** `/api/webhooks/instantly?clientId={ZRG_CLIENT_ID}`
  - **Auth (webhook):** `Authorization: Bearer {Client.instantlyWebhookSecret}` (or `x-instantly-secret`)
  - **Auth (API):** API key per workspace (`Client.instantlyApiKey`)

### Unipile (LinkedIn)
- **Features:** Connection requests + DMs (used by follow-up sequences)
- **Auth:** `UNIPILE_DSN` + `UNIPILE_API_KEY` (global) + per-workspace `Client.unipileAccountId`

### OpenAI
- **Sentiment Classification (`gpt-5-mini`):** Deterministic guardrails + AI fallback classify the most recent lead reply (includes `Blacklist` opt-outs and `Automated Reply` auto-acknowledgements).
- **One-time sentiment re-run (all workspaces, resumable):** `npx tsx scripts/rerun-sentiment-neutral-or-new.ts --apply --resume` (targets leads currently tagged `Neutral` or `New` by default).
- **Auto-Reply Safety Gate (`gpt-5-mini`):** Decides if an auto-reply should be sent (blocks opt-outs, automated replies, and acknowledgement-only messages).
- **Draft Generation (`gpt-5.1`):** Generates contextual drafts with availability-aware scheduling rules and banned-words enforcement.
- **Timezone Inference (`gpt-5-nano`):** Infers lead IANA timezone when missing (persisted only when confidence ≥ 0.95).
- **AI Observability (Admin-only):** Settings → AI Personality includes an AI mini-dashboard showing prompt templates (system/assistant/user), usage (calls/tokens/errors/latency), and estimated cost (30-day retention).

---

## 📂 Project Structure

```
/app
  /api
    /webhooks
      /email/route.ts       # Inboxxia multi-event webhook handler
      /smartlead/route.ts   # SmartLead webhook handler
      /instantly/route.ts   # Instantly webhook handler
      /ghl/sms/route.ts     # GoHighLevel SMS webhook
      /ghl/test/route.ts    # Webhook testing endpoint
  /auth                     # Authentication pages (login, signup, callback)
  page.tsx                  # Main dashboard entry point

/components
  /dashboard
    /inbox                  # Inbox view components
    /crm                    # CRM drawer components
    /settings               # Settings page components
  /ui                       # Shadcn UI primitives

/actions
  client-actions.ts         # Workspace CRUD operations
  lead-actions.ts           # Lead management
  message-actions.ts        # Message operations, draft approval
  email-actions.ts          # Email replies via selected provider
  email-campaign-actions.ts # Campaign sync logic
  ai-observability-actions.ts # Admin-only AI prompts + usage dashboard data

/lib
  prisma.ts                 # Prisma client singleton
  supabase.ts               # Supabase client
  sentiment.ts              # Sentiment classification logic
  auto-reply-gate.ts        # Auto-send decision gate (should we auto-reply?)
  ai-drafts.ts              # AI draft generation
  /ai                       # AI observability + prompt templates
  availability-cache.ts     # Cached live availability refresh + filtering
  availability-format.ts    # Availability slot label formatting
  availability-distribution.ts # Slot selection distribution (5-day preference, morning/afternoon)
  slot-offer-ledger.ts      # WorkspaceOfferedSlot read/increment helpers
  snooze-detection.ts       # Deterministic deferral date detection ("after Jan 13")
  timezone-inference.ts     # Lead timezone inference (deterministic + AI)
  emailbison-api.ts         # Inboxxia API client
  smartlead-api.ts          # SmartLead API client
  instantly-api.ts          # Instantly API client
  email-integration.ts      # Provider resolution + single-select enforcement helpers
  email-reply-handle.ts     # Cross-provider thread handle encoding/decoding

/prisma
  schema.prisma             # Database schema
```

---

## 🗄️ Database Schema

### Core Models

| Model | Purpose |
|-------|---------|
| `Client` | Workspace/tenant with GHL + Inboxxia API keys |
| `Lead` | Contact record with sentiment, status, campaign links |
| `Message` | Conversation messages (SMS/Email, inbound/outbound) |
| `Campaign` | GHL SMS campaigns |
| `EmailCampaign` | Inboxxia email campaigns |
| `AIDraft` | Pending AI-generated response drafts |
| `AIInteraction` | AI usage telemetry (tokens/cost/latency/errors) |
| `FollowUpTask` | Scheduled follow-up tasks |
| `WorkspaceSettings` | AI personality, automation rules |
| `WorkspaceAvailabilityCache` | Cached calendar availability per workspace |
| `WorkspaceOfferedSlot` | Per-workspace offered-slot counts (soft distribution) |

### Key Message Fields

```prisma
model Message {
  channel                  String   @default("sms") // 'sms' | 'email' | 'linkedin'
  ghlId                    String?  @unique  // GHL message ID
  emailBisonReplyId        String?  @unique  // Inboxxia reply ID
  inboxxiaScheduledEmailId String?  @unique  // Inboxxia scheduled email ID
  source                   String   @default("zrg")  // 'zrg' | 'inboxxia_campaign'
  direction                String   // 'inbound' | 'outbound'
  subject                  String?  // Email subject line
  body                     String   // Cleaned message content
  rawHtml                  String?  // Original HTML (emails)
  rawText                  String?  // Original text
}
```

---

## 🚀 Deployment Guide (Vercel)

### Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_APP_URL` | Canonical public app URL (used for internal links + webhook callbacks) (e.g., `https://app.codex.ai`) |
| `SERVER_ACTIONS_ALLOWED_ORIGINS` | (Optional) Comma-separated hostnames (and `*.example.com` wildcards) allowed to call Next Server Actions when you have multiple domains (e.g., `app.codex.ai,cold2close.ai,zrg-dashboard.vercel.app`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (for webhooks) |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_DRAFT_TIMEOUT_MS` | (Optional) Max time for AI draft generation (default `120000`) |
| `OPENAI_DRAFT_WEBHOOK_TIMEOUT_MS` | (Optional) Max time for AI draft generation inside webhook/background-job contexts (default `30000`) |
| `AUTO_BOOK_SLOT_MATCH_WINDOW_MS` | (Optional) Max milliseconds for nearest-slot auto-book matching fallback when exact UTC slot match fails (default `1800000` = 30 minutes) |
| `OPENAI_DRAFT_TOKEN_BUDGET_MULTIPLIER` | (Optional) Output token budget multiplier for drafts (default `3`) |
| `OPENAI_DRAFT_MAX_OUTPUT_TOKENS_CAP` | (Optional) Hard cap for `max_output_tokens` on draft retries (default `12000`) |
| `OPENAI_DRAFT_PREFER_API_TOKEN_COUNT` | (Optional) Use OpenAI input-tokens count API for sizing draft budgets (default `false`) |
| `OPENAI_EMAIL_DRAFT_MIN_CHARS` | (Optional) Minimum characters for generated email drafts (default `220`) |
| `OPENAI_EMAIL_DRAFT_MAX_CHARS` | (Optional) Maximum characters for generated email drafts (default `1200`) |
| `OPENAI_EMAIL_GENERATION_MAX_ATTEMPTS` | (Optional) Max attempts for the email generation step when output is truncated (default `2`) |
| `OPENAI_EMAIL_GENERATION_TOKEN_INCREMENT` | (Optional) Output token increment per email generation retry (default `2000`) |
| `OPENAI_EMAIL_VERIFIER_TIMEOUT_MS_CAP` | (Optional) Cap for Step 3 email draft verification timeout slice (default `45000`) |
| `OPENAI_EMAIL_VERIFIER_TIMEOUT_MS_MIN` | (Optional) Min for Step 3 email draft verification timeout slice (default `8000`) |
| `OPENAI_EMAIL_VERIFIER_TIMEOUT_SHARE` | (Optional) Share of overall draft timeout used for Step 3 email verification (default `0.35`) |
| `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_MS_CAP` | (Optional) Cap for email signature-context extraction timeout slice (default `10000`) |
| `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_MS_MIN` | (Optional) Min for email signature-context extraction timeout slice (default `3000`) |
| `OPENAI_SIGNATURE_CONTEXT_TIMEOUT_SHARE` | (Optional) Share of overall draft timeout used for signature-context extraction (default `0.2`) |
| `OPENAI_LEAD_SCORING_MAX_RETRIES` | (Optional) OpenAI SDK request retries for lead scoring (default `2`) |
| `SUPABASE_KNOWLEDGE_ASSETS_BUCKET` | (Optional) Supabase Storage bucket name for Knowledge Asset uploads (default `knowledge-assets`) |
| `KNOWLEDGE_ASSET_MAX_BYTES` | (Optional) Max upload size for Knowledge Asset files (default `12582912` = 12MB) |
| `CRAWL4AI_SERVICE_URL` | (Optional) Crawl4AI HTTP service URL for best website extraction (recommended for prod) |
| `CRAWL4AI_SERVICE_SECRET` | (Optional) Bearer token for the Crawl4AI service |
| `CRAWL4AI_LOCAL_RUNNER` | (Optional) Enable local Crawl4AI python runner (`true` for dev) |
| `CRAWL4AI_PYTHON_BIN` | (Optional) Python binary for local runner (default `python3`) |
| `CRAWL4AI_SCRIPT_PATH` | (Optional) Path to crawl script (default `scripts/crawl4ai/extract_markdown.py`) |
| `KNOWLEDGE_WEBSITE_FETCH_MAX_BYTES` | (Optional) Max bytes fetched when Crawl4AI is not configured (default `2000000`) |
| `AI_MODEL_PRICING_JSON` | (Optional) Override per-model token pricing for cost estimates |
| `DATABASE_URL` | Transaction pooler connection (port 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | Direct DB connection (port 5432) used for Prisma CLI (`db push`, migrations) |
| `SLACK_WEBHOOK_URL` | (Optional) Slack notifications for meetings booked |
| `CRON_SECRET` | Secret for Vercel Cron authentication (generate with `openssl rand -hex 32`) |
| `INNGEST_EVENT_KEY` | Inngest event key (server-side) used when publishing events from API routes/cron triggers |
| `INNGEST_SIGNING_KEY` | Inngest signing key used by `/api/inngest` to verify incoming function execution requests |
| `INNGEST_APP_ID` | (Optional) Override Inngest app id (defaults to `zrg-dashboard`) |
| `BACKGROUND_JOBS_USE_INNGEST` | (Optional) When `true`, `/api/cron/background-jobs` only enqueues an Inngest event and returns `202` instead of processing inline (default `false`) |
| `CALENDLY_WEBHOOK_SIGNING_KEY` | (Optional) Global Calendly webhook signing key fallback. In production, a signing key is required for verification; per-workspace keys are stored in the DB when available. |
| `INBOXXIA_EMAIL_SENT_ASYNC` | (Optional) Enqueue Inboxxia `EMAIL_SENT` webhook events to the `WebhookEvent` queue for burst resilience (Phase 53) (default off) |
| `WEBHOOK_EVENT_CRON_LIMIT` | (Optional) Max `WebhookEvent` rows processed per cron tick (default `25`, max `200`) |
| `WEBHOOK_EVENT_CRON_TIME_BUDGET_MS` | (Optional) Time budget for `WebhookEvent` processing per cron tick (default `45000`) |
| `WEBHOOK_EVENT_STALE_LOCK_MS` | (Optional) Stale lock TTL for `WebhookEvent` rows (default `600000`) |
| `WORKSPACE_PROVISIONING_SECRET` | Secret for admin workspace provisioning endpoints (e.g. `/api/admin/workspaces`, `/api/admin/workspaces/bootstrap`) (generate with `openssl rand -hex 32`) |
| `ADMIN_ACTIONS_SECRET` | (Optional) Shared secret for admin endpoints (fallback if provisioning secret is unset) |
| `SUPABASE_MIDDLEWARE_TIMEOUT_MS` | (Optional) Abort timeout for Supabase auth refresh in middleware (default `8000`) |
| `UNIPILE_DSN` | Unipile base DSN (e.g. `https://apiXX.unipile.com:PORT`) |
| `UNIPILE_API_KEY` | Unipile API key |
| `UNIPILE_HEALTH_GATE` | (Optional) Enable Unipile health gating (auto-pauses LinkedIn follow-ups on disconnected accounts / unreachable recipients) (Phase 53) (default off) |
| `EMAIL_GUARD_API_KEY` | (Optional) EmailGuard API key for email validation before sending |
| `LOG_SLOW_PATHS` | (Optional) Enable extra slow-path logging for draft verification / AI flows (default off) |
| `AUTO_SEND_EVALUATOR_MODEL` | (Optional) Auto-send evaluator model override (fallback when workspace setting is unset) |
| `AUTO_SEND_EVALUATOR_REASONING_EFFORT` | (Optional) Auto-send evaluator reasoning effort override (fallback when workspace setting is unset) |
| `AUTO_SEND_REVISION_MODEL` | (Optional) Auto-send revision model override (fallback when workspace setting is unset) |
| `AUTO_SEND_REVISION_REASONING_EFFORT` | (Optional) Auto-send revision reasoning effort override (fallback when workspace setting is unset) |
| `AUTO_SEND_REVISION_LOOP_TIMEOUT_MS` | (Optional) Total wall-clock budget for the auto-send revision loop (default `60000`) |
| `DRAFT_PIPELINE_RUN_RETENTION_DAYS` | (Optional) Retention days for draft pipeline runs/artifacts pruned in `/api/cron/background-jobs` (default `30`) |
| `GHL_DEFAULT_COUNTRY_CALLING_CODE` | (Optional) Default calling code for phone normalization (commonly `1`) |
| `GHL_REQUESTS_PER_10S` | (Optional) Throttle cap for GHL API requests per 10s window (default `90`, documented burst is `100`) |
| `GHL_MAX_429_RETRIES` | (Optional) Max retries when GHL returns `429` with `Retry-After` (default `3`) |
| `GHL_FETCH_TIMEOUT_MS` | (Optional) Per-request timeout for GHL API calls (default `15000`) |
| `GHL_MAX_NETWORK_RETRIES` | (Optional) Extra retries for GET requests on network errors/timeouts (default `1`) |
| `GHL_EXPORT_MAX_PAGES` | (Optional) Max pages to fetch from `/conversations/messages/export` per lead during sync (default `5`) |
| `GHL_EXPORT_MAX_MESSAGES` | (Optional) Cap messages fetched via export per lead during sync (default `2000`) |
| `SYNC_ALL_CONCURRENCY` | (Optional) Concurrency for "Sync All" batches (default `3`) |
| `REGENERATE_ALL_DRAFTS_CONCURRENCY` | (Optional) Concurrency for bulk draft regeneration (default `1`) |
| `EMAILBISON_TIMEOUT_MS` | (Optional) Fetch timeout for EmailBison API calls (default `30000`) |
| `EMAILBISON_MAX_RETRIES` | (Optional) Max retries for EmailBison GET requests on network/timeout errors (default `2`) |
| `EMAILBISON_BASE_URL` | (Optional) Override EmailBison API base URL (default `https://send.meetinboxxia.com`) |
| `INSIGHTS_CONTEXT_PACK_CRON_LIMIT` | (Optional) Max context packs to process per cron tick (default `3`) |
| `INSIGHTS_CONTEXT_PACK_CRON_BATCH` | (Optional) Session batch size per context pack (default `15`) |

### AI Telemetry (Tokens + Cost)

- The Settings → **AI Dashboard** is powered by the `AIInteraction` table (30-day retention).
- Each interaction records tokens, latency, errors, `featureId`/`promptKey`, and a `source` attribution key (route/job/action), e.g.:
  - `/api/webhooks/email`
  - `/api/cron/followups`
  - `action:insights_chat.send_message`

### AI Pricing Overrides (`AI_MODEL_PRICING_JSON`)

Cost in the AI Dashboard is an estimate derived from token usage and the model pricing map. If a model isn’t configured, cost will show as partial.

Example shape:

```json
{
  "gpt-5.2": { "inputUsdPer1MTokens": 1.75, "outputUsdPer1MTokens": 14 },
  "gpt-5-mini": { "inputUsdPer1MTokens": 0.25, "outputUsdPer1MTokens": 2 }
}
```

### Prisma Schema Changes

- After pulling changes that modify `prisma/schema.prisma`, run `npm run db:push` to sync the database schema (creates tables like `WorkspaceOfferedSlot`).

### Optional Cron (AI Retention)

- **Endpoint:** `/api/cron/ai-retention`
- **Purpose:** Prunes `AIInteraction` records older than 30 days (also pruned opportunistically during normal app usage).
- **Auth:** `Authorization: Bearer ${CRON_SECRET}`

### Workspace Provisioning (monday.com)

- **Endpoint:** `/api/admin/workspaces`
- **Method:** `POST`
- **Auth:** `Authorization: Bearer ${WORKSPACE_PROVISIONING_SECRET}` (or `x-workspace-provisioning-secret: ${WORKSPACE_PROVISIONING_SECRET}`)
- **Purpose:** Creates a new `Client` (workspace) + default `WorkspaceSettings`, intended for external automation (e.g., monday.com).

**Request body (JSON)**

```json
{
  "name": "Acme Inc",
  "userEmail": "owner@acme.com",
  "ghlLocationId": "AbCdEf123",
  "ghlPrivateKey": "ghl_private_integration_key",
  "emailBisonApiKey": "optional_emailbison_api_key",
  "emailBisonWorkspaceId": "12345",
  "unipileAccountId": "optional_unipile_account_id",
  "upsert": true,
  "settings": {
    "timezone": "America/Los_Angeles",
    "companyName": "Acme Inc",
    "airtableMode": "false"
  }
}
```

**Response**
- `201` on create: `{ "success": true, "existed": false, "workspace": { ... } }`
- `200` if workspace already exists for the same `ghlLocationId`: `{ "success": true, "existed": true, ... }`

### Follow-Up Template Backfill (Re-engagement)

- **Endpoint:** `/api/admin/followup-sequences/reengagement/backfill`
- **Methods:** `GET` (dry-run), `POST` (apply)
- **Auth:** `Authorization: Bearer ${WORKSPACE_PROVISIONING_SECRET}` (or `ADMIN_ACTIONS_SECRET`)
- **Purpose:** Ensures every workspace has the `Re-engagement Follow-up` sequence template.
  - Workspaces without Unipile configured will be seeded without the LinkedIn step.
  - Workspaces with `WorkspaceSettings.airtableMode=true` will be seeded without the Email step.

**Dry-run (recommended first)**

```bash
curl -sS "http://localhost:3000/api/admin/followup-sequences/reengagement/backfill" \
  -H "Authorization: Bearer $WORKSPACE_PROVISIONING_SECRET"
```

**Apply to all workspaces**

```bash
curl -sS -X POST "http://localhost:3000/api/admin/followup-sequences/reengagement/backfill" \
  -H "Authorization: Bearer $WORKSPACE_PROVISIONING_SECRET" \
  -H "Content-Type: application/json" \
  -d '{ "apply": true, "allClients": true, "confirmAllClients": "YES" }'
```

### Workspace Bootstrap (White-Label / Empty Workspace)

- **Endpoint:** `/api/admin/workspaces/bootstrap`
- **Method:** `POST`
- **Auth:** `Authorization: Bearer ${WORKSPACE_PROVISIONING_SECRET}` (or `x-workspace-provisioning-secret: ${WORKSPACE_PROVISIONING_SECRET}`; fallback to `ADMIN_ACTIONS_SECRET` or `CRON_SECRET` if provisioning secret is unset)
- **Purpose:** Creates an “empty” workspace (no integrations connected yet) and (optionally) creates the initial Supabase Auth user.

This is the recommended path for white-label onboarding (e.g., creating a new workspace like **Founders Club**) because it does **not** require GHL/Email/LinkedIn integrations at creation time.

**Behavior**
- If `adminEmail` does not exist in Supabase Auth:
  - `adminPassword` is required and a new user is created (email is confirmed immediately).
- If `adminEmail` already exists:
  - Omitting `adminPassword` will **not** change the password.
  - Providing `adminPassword` requires `upsert=true` (prevents accidental password resets).
- Workspace is created with no integrations configured (`ghlLocationId=null`, `ghlPrivateKey=null`), and can be connected later in **Settings → Integrations**.
- Branding fields (optional):
  - `brandName` → stored on `WorkspaceSettings.brandName`
  - `brandLogoUrl` → stored on `WorkspaceSettings.brandLogoUrl` and rendered in the sidebar
    - If your filename contains spaces (e.g. `Founders Club Logo.svg`), prefer URL-encoding them (`%20`).

**Request body (JSON)**

```json
{
  "workspaceName": "Founders Club",
  "brandName": "Founders Club",
  "brandLogoUrl": "/images/Founders%20Club%20Logo.svg",
  "adminEmail": "<ADMIN_EMAIL>",
  "adminPassword": "<ADMIN_PASSWORD>",
  "upsert": true
}
```

**cURL (local dev)**

```bash
curl -sS -X POST "http://localhost:3000/api/admin/workspaces/bootstrap" \
  -H "Authorization: Bearer $WORKSPACE_PROVISIONING_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceName": "Founders Club",
    "brandName": "Founders Club",
    "brandLogoUrl": "/images/Founders%20Club%20Logo.svg",
    "adminEmail": "<ADMIN_EMAIL>",
    "adminPassword": "<ADMIN_PASSWORD>",
    "upsert": true
  }'
```

**cURL (live / production)**

Replace `http://localhost:3000` with your deployed dashboard URL (e.g. `https://your-app-domain.com`).

```bash
curl -sS -X POST "https://your-app-domain.com/api/admin/workspaces/bootstrap" \
  -H "Authorization: Bearer $WORKSPACE_PROVISIONING_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceName": "Founders Club",
    "brandName": "Founders Club",
    "brandLogoUrl": "/images/Founders%20Club%20Logo.svg",
    "adminEmail": "<ADMIN_EMAIL>",
    "adminPassword": "<ADMIN_PASSWORD>",
    "upsert": true
  }'
```

If the user already exists and you **do not** want to reset the password, omit `adminPassword`:

```bash
curl -sS -X POST "https://your-app-domain.com/api/admin/workspaces/bootstrap" \
  -H "Authorization: Bearer $WORKSPACE_PROVISIONING_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceName": "Founders Club",
    "brandName": "Founders Club",
    "brandLogoUrl": "/images/Founders%20Club%20Logo.svg",
    "adminEmail": "<ADMIN_EMAIL>",
    "upsert": true
  }'
```

**Response**
- `201` on create: `{ "success": true, "userId": "...", "workspaceId": "...", "existedUser": false, "existedWorkspace": false }`
- `200` if workspace already exists: `{ "success": true, "existedWorkspace": true, ... }`

### Workspace Member Bootstrap (Setters / Inbox Managers)

- **Endpoint:** `/api/admin/workspaces/members`
- **Method:** `POST`
- **Auth:** `Authorization: Bearer ${WORKSPACE_PROVISIONING_SECRET}` (or `x-workspace-provisioning-secret: ${WORKSPACE_PROVISIONING_SECRET}`; fallback to `ADMIN_ACTIONS_SECRET` or `CRON_SECRET` if provisioning secret is unset)
- **Purpose:** Creates (or updates) a Supabase Auth user and grants them access to an existing workspace via `ClientMember` (e.g., create a **Setter** login for the same workspace).

**Behavior**
- Workspace selector:
  - Prefer `workspaceId`
  - Or provide `workspaceName` + `workspaceOwnerEmail` (to disambiguate)
- If `memberEmail` does not exist in Supabase Auth:
  - `memberPassword` is required and a new user is created (email is confirmed immediately).
- If `memberEmail` already exists:
  - Omitting `memberPassword` will **not** change the password.
  - Providing `memberPassword` requires `upsert=true` (prevents accidental password resets).
- `role` defaults to `SETTER` (allowed: `SETTER`, `INBOX_MANAGER`, `ADMIN`).

**Request body (JSON)**

```json
{
  "workspaceId": "<WORKSPACE_ID>",
  "memberEmail": "<SETTER_EMAIL>",
  "memberPassword": "<SETTER_PASSWORD>",
  "role": "SETTER",
  "upsert": true
}
```

**cURL (local dev)**

```bash
curl -sS -X POST "http://localhost:3000/api/admin/workspaces/members" \
  -H "Authorization: Bearer $WORKSPACE_PROVISIONING_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "<WORKSPACE_ID>",
    "memberEmail": "<SETTER_EMAIL>",
    "memberPassword": "<SETTER_PASSWORD>",
    "role": "SETTER",
    "upsert": true
  }'
```

**cURL (live / production)**

Replace `http://localhost:3000` with your deployed dashboard URL (e.g. `https://your-app-domain.com`).

```bash
curl -sS -X POST "https://your-app-domain.com/api/admin/workspaces/members" \
  -H "Authorization: Bearer $WORKSPACE_PROVISIONING_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "<WORKSPACE_ID>",
    "memberEmail": "<SETTER_EMAIL>",
    "memberPassword": "<SETTER_PASSWORD>",
    "role": "SETTER",
    "upsert": true
  }'
```

**Response**
- `201` if a new membership was created
- `200` if the user already had that workspace role

### Vercel Cron Setup

Follow-up sequences are processed automatically via Vercel Cron. The cron job is configured in `vercel.json`:

```json
{
  "crons": [{
    "path": "/api/cron/followups",
    "schedule": "*/10 * * * *"
  }]
}
```

This runs every 10 minutes. To set up:

1. Generate a secure secret: `openssl rand -hex 32`
2. Add `CRON_SECRET` to your Vercel project environment variables
3. Vercel automatically calls `/api/cron/followups` with `Authorization: Bearer <CRON_SECRET>`

**Note:** Vercel Cron is available on Pro and Enterprise plans. On Hobby, use an external service like [cron-job.org](https://cron-job.org) with the same endpoint.

### Inngest Setup (Durable Background Jobs)

The app exposes Inngest at `/api/inngest` (App Router handler: `app/api/inngest/route.ts`).

Production checklist:
1. Add `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in Vercel project env vars.
2. Deploy to Vercel so `/api/inngest` is live on your production domain.
3. In Inngest Cloud, sync using your production app URL (for example `https://zrg-dashboard-zrg.vercel.app`).
4. If Vercel Deployment Protection is enabled, add a bypass for Inngest or disable protection for that endpoint.
5. Verify endpoint reachability: `https://<your-domain>/api/inngest` should return a non-404 response.

Optional:
- Set `BACKGROUND_JOBS_USE_INNGEST=true` to make `/api/cron/background-jobs` enqueue an Inngest event and return `202` instead of running inline.
- Local dev sync: run `npm run dev` and `npm run inngest:dev`.

### Calendar Availability + Booking Notes

- **Availability source-of-truth:** default `CalendarLink` (shown in follow-ups via `{availability}` and in the booking modal).
- **Booking calendar:** appointments are created on `WorkspaceSettings.ghlDefaultCalendarId` (warn-only if it differs from the Calendar Link’s inferred GHL calendar).
- **Meeting duration:** live availability + auto-booking currently requires `meetingDurationMinutes = 30` (UI will toast if changed).

### Database Migration

After schema changes, run locally:

```bash
# Install dependencies
npm install

# Push schema to Supabase
npx prisma db push

# Or create a migration
npx prisma migrate dev --name your_migration_name
```

### Deploy

1. Commit changes to `main` branch
2. Vercel auto-deploys via GitHub integration
3. `prisma generate` runs automatically via postinstall

---

## 🛠️ Local Development

```bash
# Install dependencies
npm install

# Create .env.local with required variables
cp .env.example .env.local

# Run development server
npm run dev

# Open http://localhost:3000
```

### AI Behavior Testing (Long-Term Regression Suite)

For prompt, AI drafting, pricing/cadence safety, and auto-send evaluator behavior changes, run:

```bash
npm run test:ai-drafts
```

Run a focused fixture suite:

```bash
npm run test:ai-drafts -- lib/ai-drafts/__tests__/pricing-safety-fixtures.test.ts
```

Fixture harness for production regressions:
- Fixture JSONs: `lib/ai-drafts/__fixtures__/pricing-safety/*.json`
- Fixture runner: `lib/ai-drafts/__tests__/pricing-safety-fixtures.test.ts`

When fixing AI behavior bugs, add/update a fixture with explicit invariants (for example: removed unsupported amounts, cadence mismatch handling, clarifier insertion, and must-include/must-exclude tokens).

### Live AI Replay Testing (Real End-to-End Generations)

Use this when you need actual model outputs on historical replies (batch + multi-case), not just deterministic fixtures.

```bash
# Run live replay against auto-selected historical inbound messages
npm run test:ai-replay -- --client-id <clientId> --limit 20 --concurrency 3

# Constrain to a specific channel (default selection uses any channel)
npm run test:ai-replay -- --client-id <clientId> --channel email --limit 20

# Selection-only preview (no live generation or judging)
npm run test:ai-replay -- --client-id <clientId> --dry-run

# Replay explicit historical inbound message IDs
npm run test:ai-replay -- --thread-ids <messageId1,messageId2>

# Compare against a previous run artifact (regression diff)
npm run test:ai-replay -- --client-id <clientId> --baseline .artifacts/ai-replay/<prior-run>.json
```

What it does:
- Uses real `generateResponseDraft` path for each selected case.
- Scores each generated draft with an LLM judge prompt (`ai.replay.judge.v1`).
- Judge input includes historical outbound examples and observed next real outbound reply (when available) for grounded evaluation.
- Writes a full-text JSON artifact to `.artifacts/ai-replay/*.json` (gitignored).
- Supports batch concurrency (`--concurrency`) and case retries (`--retries`).
- Fails fast when zero cases are selected (use `--allow-empty` only when intentionally bypassing this guard).
- Deletes replay-generated `AIDraft` rows by default after scoring (`--keep-drafts` to retain).

---

## 🔮 Roadmap

### ✅ Completed
- [x] Phase I: GHL SMS webhook ingestion & AI sentiment analysis
- [x] Phase II: Inboxxia email integration & multi-event webhook handling
- [x] AI draft generation with sentiment-aware responses
- [x] Auto-reply system for qualified leads
- [x] Unified inbox for SMS + Email with channel tabs and cross-channel dedup
- [x] Campaign sync and management
- [x] Follow-Up Sequences - Multi-step, multi-channel follow-up chains with Day 2/5/7 templates
- [x] Calendar Link Management - Multiple calendar links per workspace with availability fetching
- [x] Live availability cache + booking modal (lead timezone aware)
- [x] Auto-booking when a lead accepts offered times
- [x] LinkedIn follow-up steps (Unipile DMs + connection requests)
- [x] Template Variables - {senderName}, {companyName}, {result}, {calendarLink}, {qualificationQuestion1/2}
- [x] AI Persona Enhancements - Service description, qualification questions, knowledge assets for better AI context
- [x] EmailGuard Integration - Email validation before sending
- [x] **Notification Center** - Per-workspace realtime + daily digest alerts (Slack/email) on sentiment transitions with configurable per-sentiment rules
- [x] **Call Requested Tasks** - Auto-creates follow-up tasks when lead requests a call with phone number
- [x] **Lead Scheduler Link Capture** - Extracts and stores lead-provided Calendly/HubSpot/GHL links, creates manual review tasks with overlap suggestions
- [x] **Per-Workspace Integrations** - Slack bot token + Resend API key stored per workspace (not global env)

### 🚧 In Progress / Next Up
- [ ] **Channel-Aware Analytics** - Open/reply rates by channel, sentiment trends
- [ ] **Email Opens Persistence** - Store EMAIL_OPENED events for analytics
- [ ] **Lead Scoring** - AI-powered prioritization across channels
- [ ] **Per-Sentiment/Status Draft Prompts** - Create more specific prompt templates per sentiment/status for higher-quality draft generation
- [ ] **Multi-Channel Auto Follow-Ups + Auto-Booking** - Harden and expand automated follow-ups + booking flows across SMS/Email/LinkedIn to replace setters and increase booking rates
- [ ] **Third-Party Scheduler Booking Automation** - Playwright/Fly.io browser automation to book on lead-provided Calendly/HubSpot/GHL scheduler links (Phase 52 follow-on)
- [ ] **SMS Notification Delivery** - Wire actual SMS provider (Twilio/GHL) for Notification Center SMS alerts (currently config-only)
- [ ] **Notification Center Tests** - Unit tests for rules normalization, realtime dedupe, daily digest aggregation

### 📋 Future Phases (see `lib/future-integrations.ts` for detailed specs)
- [ ] **Phase V: AI Voice Caller** - Retell AI via SIP trunking for qualification calls and double-dial touchpoints
- [ ] **Phase VI: Advanced Analytics** - Funnel visualization, A/B testing
- [ ] **Phase VII: Team Features** - Multi-user access, assignment workflows
- [ ] **LinkedIn Inbound Sync** - Ingest inbound LinkedIn messages into the unified inbox
- [ ] **Calendar Reconciliation** - Cancellation/reschedule sync + stronger de-dupe across external bookings

---

## 🔮 Future Integration Notes

> **Detailed specifications for future integrations are documented in [`lib/future-integrations.ts`](lib/future-integrations.ts)**

### Calendar Automation (Phase IV - Mostly Complete)
**Status:** Availability caching + booking + auto-booking implemented

**What's working:**
- Multiple calendar links per workspace (`CalendarLink` model)
- Auto-detection of calendar type (Calendly, HubSpot, GoHighLevel)
- Real-time availability slot fetching via `lib/calendar-availability.ts` (cached in `WorkspaceAvailabilityCache`)
- `{availability}` and `{calendarLink}` template variables in follow-ups
- Booking appointments on GHL (`WorkspaceSettings.ghlDefaultCalendarId`)
- Auto-booking when a lead accepts one of the offered slots

**Still needed:**
- Cancellation/reschedule reconciliation (external bookings/cancellations)
- Optional per-lead calendar overrides (if/when enabled)

### AI Voice Caller (Phase V)
**Status:** Channel scaffolded, API integration pending
**Provider:** Retell AI via SIP trunking

**Use cases in follow-up sequences:**
- Post-booking qualification calls (ask qualification questions before meeting)
- Double-dial touchpoints (Day 2 if phone provided, immediate AI call)
- Fallback: If AI call not answered, system sends SMS instead

**Channel:** `ai_voice` in `FollowUpStep.channel`

### LinkedIn Integration (Phase III)
**Status:** Outbound integrated (Unipile); inbound ingestion pending
**Provider:** Unipile API

**Database fields ready:**
- `Lead.linkedinId` - LinkedIn member ID
- `Lead.linkedinUrl` - Profile URL
- `Message.channel = 'linkedin'` - Message channel support

**What's working:**
- Follow-up steps can send LinkedIn DMs if connected
- Follow-up steps send connection requests if not connected

**Still needed:**
- Ingest inbound LinkedIn messages into the inbox (webhook/polling)

---

## 🔧 Webhook Configuration

### EmailBison (Inboxxia) Webhook Setup

1. Go to Inboxxia Settings → Webhooks
2. Add webhook URL: `${NEXT_PUBLIC_APP_URL}/api/webhooks/email?clientId={YOUR_CLIENT_ID}` (e.g., `https://app.codex.ai/api/webhooks/email?clientId={YOUR_CLIENT_ID}`)
3. Enable events:
   - ✅ Lead Replied (LEAD_REPLIED)
   - ✅ Lead Interested (LEAD_INTERESTED)
   - ✅ Untracked Reply Received (UNTRACKED_REPLY_RECEIVED)
   - ✅ Email Sent (EMAIL_SENT)
   - ✅ Email Opened (EMAIL_OPENED)
   - ✅ Email Bounced (EMAIL_BOUNCED)
   - ✅ Lead Unsubscribed (LEAD_UNSUBSCRIBED)

### SmartLead Webhook Setup

1. Configure a webhook URL: `${NEXT_PUBLIC_APP_URL}/api/webhooks/smartlead?clientId={YOUR_CLIENT_ID}` (e.g., `https://app.codex.ai/api/webhooks/smartlead?clientId={YOUR_CLIENT_ID}`)
2. Set the webhook `secret_key` to match the workspace’s `Client.smartLeadWebhookSecret`
3. Enable events (recommended minimum):
   - ✅ Email Reply (EMAIL_REPLY)
   - ✅ Email Sent (EMAIL_SENT)
   - ✅ Lead Unsubscribed (LEAD_UNSUBSCRIBED)

### Instantly Webhook Setup

1. Configure a webhook URL: `${NEXT_PUBLIC_APP_URL}/api/webhooks/instantly?clientId={YOUR_CLIENT_ID}` (e.g., `https://app.codex.ai/api/webhooks/instantly?clientId={YOUR_CLIENT_ID}`)
2. Add a custom header:
   - `Authorization: Bearer {Client.instantlyWebhookSecret}` (or `x-instantly-secret`)
3. Enable events (recommended minimum):
   - ✅ Reply Received (reply_received)
   - ✅ Email Sent (email_sent)
   - ✅ Unsubscribed (unsubscribed)

### GoHighLevel Webhook Setup

1. Go to GHL Settings → Integrations → Webhooks
2. Add webhook URL: `${NEXT_PUBLIC_APP_URL}/api/webhooks/ghl/sms?locationId={GHL_LOCATION_ID}` (e.g., `https://app.codex.ai/api/webhooks/ghl/sms?locationId={GHL_LOCATION_ID}`)
3. Select "Inbound Message" trigger

---

## 📝 Notes

- **Deduplication:** The system prevents duplicate messages using unique IDs from external platforms
- **Sentiment Mapping:** Sentiments map to lead statuses (e.g., "Interested" → "qualified", "Blacklist" → "blacklisted")
- **Source Tracking:** Messages tagged with `source` field distinguish ZRG-sent vs campaign-sent emails
- **Blacklisting:** Bounced and unsubscribed leads are automatically blacklisted

---

## 🤝 Contributing

This is a private project. Contact the maintainer for access.

## 📄 License

Proprietary - All rights reserved.
