# ZRG AI Master Inbox & CRM Dashboard

A scalable, full-stack application designed to manage high-volume sales outreach. This system replaces legacy n8n/Airtable workflows by unifying Email, SMS (GoHighLevel), and LinkedIn conversations into a single "Master Inbox" with AI-driven sentiment analysis, automatic drafting, and campaign management.

**Current Status:** Phase II Complete (Email Integration via Inboxxia + SMS via GoHighLevel) with **Multi-Channel Lead Architecture** foundation (SMS + Email live, LinkedIn scaffolded).

**Live Demo:** [https://zrg-dashboard.vercel.app/](https://zrg-dashboard.vercel.app/)

---

## 🏗 Architecture

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 16 (App Router), Tailwind CSS, Shadcn UI, Lucide Icons |
| **Backend** | Next.js Server Actions & API Routes |
| **Database** | Supabase (PostgreSQL) with Prisma ORM |
| **AI Engine** | OpenAI (GPT-4o / GPT-4o-mini) |
| **Hosting** | Vercel (Serverless) |
| **Email Platform** | Inboxxia (EmailBison) - Cold email campaigns & replies |
| **SMS Platform** | GoHighLevel (GHL) - SMS messaging & CRM sync |

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
- [x] **Email Body Sanitization** - Strips quoted text, signatures, HTML boilerplate
- [x] **Deduplication** - Prevents duplicate messages via `emailBisonReplyId` and `inboxxiaScheduledEmailId`
- [x] **Campaign Sync** - Syncs Inboxxia campaigns to dashboard
- [x] **Unified Inbox** - SMS and Email in single conversation view with platform/channel badges

### Multi-Channel Lead Architecture (New)
- [x] **Single Lead, Multiple Channels** — Leads can own SMS + Email now; LinkedIn fields are present for next phase.
- [x] **`Message.channel`** — Explicit channel field (`sms` | `email` | `linkedin`) on all messages.
- [x] **Cross-Channel Dedup** — `findOrCreateLead` utility matches by email **or** normalized phone to prevent duplicate leads across webhooks.
- [x] **GHL SMS Webhook** — Uses unified lead-matching, captures email when present, saves `channel: "sms"`.
- [x] **Inboxxia Email Webhook** — Uses unified lead-matching, saves `channel: "email"`.
- [x] **Inbox UI** — Conversation cards show all active channels; Action Station has channel tabs (SMS/Email; LinkedIn placeholder).

### Dashboard Features
- [x] **Inbox View** - Filterable conversation list with search
- [x] **Action Station** - AI draft review, edit, approve/reject workflow
- [x] **Channel Tabs** - Switch per-lead between SMS/Email (LinkedIn coming soon) with per-channel message counts
- [x] **CRM Drawer** - Lead details, status management, sentiment tags
- [x] **Settings Page** - Workspace management, API key configuration
- [x] **Email Credential Management** - Inboxxia API key input per workspace

---

## 🔌 Core Integrations

### GoHighLevel (SMS)
- **Webhook:** `/api/webhooks/ghl/sms?locationId={GHL_LOCATION_ID}`
- **Features:** Inbound SMS processing, contact sync, conversation threading
- **Auth:** Private Integration API Key per workspace

### Inboxxia / EmailBison (Email)
- **Webhook:** `/api/webhooks/email?clientId={ZRG_CLIENT_ID}`
- **Base URL:** `https://send.meetinboxxia.com`
- **Features:** Campaign management, reply tracking, send via API
- **Auth:** Bearer token (API Key per workspace)

### OpenAI
- **Sentiment Classification:** Analyzes message content → tags like "Interested", "Meeting Requested", "Not Interested", "Out of Office", etc.
- **Draft Generation:** Creates contextual response drafts based on sentiment and conversation history

---

## 📂 Project Structure

```
/app
  /api
    /webhooks
      /email/route.ts       # Inboxxia multi-event webhook handler
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
  email-actions.ts          # Email sending via Inboxxia
  email-campaign-actions.ts # Campaign sync logic

/lib
  prisma.ts                 # Prisma client singleton
  supabase.ts               # Supabase client
  sentiment.ts              # Sentiment classification logic
  ai-drafts.ts              # AI draft generation
  emailbison-api.ts         # Inboxxia API client

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
| `FollowUpTask` | Scheduled follow-up tasks |
| `WorkspaceSettings` | AI personality, automation rules |

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
| `NEXT_PUBLIC_APP_URL` | Production URL (e.g., `https://zrg-dashboard.vercel.app/`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (for webhooks) |
| `OPENAI_API_KEY` | OpenAI API key |
| `DATABASE_URL` | Transaction pooler connection (port 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | Session pooler connection (port 5432) |
| `SLACK_WEBHOOK_URL` | (Optional) Slack notifications for meetings booked |
| `CRON_SECRET` | Secret for Vercel Cron authentication (generate with `openssl rand -hex 32`) |

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
- [x] Template Variables - {senderName}, {companyName}, {result}, {calendarLink}, {qualificationQuestion1/2}

### 🚧 In Progress / Next Up
- [ ] **AI Persona Enhancements** - Service description, qualification questions, knowledge assets for better AI context
- [ ] **Channel-Aware Analytics** - Open/reply rates by channel, sentiment trends
- [ ] **Email Opens Persistence** - Store EMAIL_OPENED events for analytics
- [ ] **Lead Scoring** - AI-powered prioritization across channels

### 📋 Future Phases (see `lib/future-integrations.ts` for detailed specs)
- [ ] **Phase III: LinkedIn Integration** - Unipile API for LinkedIn messaging (channel = `linkedin`)
- [ ] **Phase IV: Calendar Automation** - Automated meeting booking when lead selects a time
- [ ] **Phase V: AI Voice Caller** - Retell AI via SIP trunking for qualification calls and double-dial touchpoints
- [ ] **Phase VI: Advanced Analytics** - Funnel visualization, A/B testing
- [ ] **Phase VII: Team Features** - Multi-user access, assignment workflows
- [ ] **EmailGuard Integration** - Email validation before sending

---

## 🔮 Future Integration Notes

> **Detailed specifications for future integrations are documented in [`lib/future-integrations.ts`](lib/future-integrations.ts)**

### Calendar Availability (Phase IV - Partially Complete)
**Status:** Availability fetching implemented, automated booking pending

**What's working:**
- Multiple calendar links per workspace (`CalendarLink` model)
- Auto-detection of calendar type (Calendly, HubSpot, GoHighLevel)
- Real-time availability slot fetching via `lib/calendar-availability.ts`
- `{availability}` and `{calendarLink}` template variables in follow-ups

**Still needed:**
- Automated booking when lead selects a time
- Meeting confirmation sync back to dashboard

### AI Voice Caller (Phase V)
**Status:** Channel scaffolded, API integration pending
**Provider:** Retell AI via SIP trunking

**Use cases in follow-up sequences:**
- Post-booking qualification calls (ask qualification questions before meeting)
- Double-dial touchpoints (Day 2 if phone provided, immediate AI call)
- Fallback: If AI call not answered, system sends SMS instead

**Channel:** `ai_voice` in `FollowUpStep.channel`

### LinkedIn Integration (Phase III)
**Status:** Schema scaffolded, API integration pending
**Provider:** Unipile API

**Database fields ready:**
- `Lead.linkedinId` - LinkedIn member ID
- `Lead.linkedinUrl` - Profile URL
- `Message.channel = 'linkedin'` - Message channel support

**Planned integration:**
- Check if lead has connected on LinkedIn (`linkedin_connected` condition)
- Send follow-up messages via LinkedIn if connected
- Connection request automation

---

## 🔧 Webhook Configuration

### Inboxxia Webhook Setup

1. Go to Inboxxia Settings → Webhooks
2. Add webhook URL: `https://zrg-dashboard.vercel.app/api/webhooks/email?clientId={YOUR_CLIENT_ID}`
3. Enable events:
   - ✅ Lead Replied (LEAD_REPLIED)
   - ✅ Lead Interested (LEAD_INTERESTED)
   - ✅ Untracked Reply Received (UNTRACKED_REPLY_RECEIVED)
   - ✅ Email Sent (EMAIL_SENT)
   - ✅ Email Opened (EMAIL_OPENED)
   - ✅ Email Bounced (EMAIL_BOUNCED)
   - ✅ Lead Unsubscribed (LEAD_UNSUBSCRIBED)

### GoHighLevel Webhook Setup

1. Go to GHL Settings → Integrations → Webhooks
2. Add webhook URL: `https://zrg-dashboard.vercel.app/api/webhooks/ghl/sms?locationId={GHL_LOCATION_ID}`
3. Select "Inbound Message" trigger

---

## 📝 Notes

- **Deduplication:** The system prevents duplicate messages using unique IDs from external platforms
- **Sentiment Mapping:** Sentiments automatically map to lead statuses (e.g., "Interested" → "engaged")
- **Source Tracking:** Messages tagged with `source` field distinguish ZRG-sent vs campaign-sent emails
- **Blacklisting:** Bounced and unsubscribed leads are automatically blacklisted

---

## 🤝 Contributing

This is a private project. Contact the maintainer for access.

## 📄 License

Proprietary - All rights reserved.
