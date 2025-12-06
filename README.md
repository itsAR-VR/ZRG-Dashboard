# ZRG AI Master Inbox & CRM Dashboard

A scalable, full-stack application designed to manage high-volume sales outreach. This system replaces legacy n8n/Airtable workflows by unifying Email, SMS (GoHighLevel), and LinkedIn conversations into a single "Master Inbox" with AI-driven sentiment analysis, automatic drafting, and campaign management.

**Current Status:** Phase II Complete (Email Integration via Inboxxia + SMS via GoHighLevel)

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
- [x] **Unified Inbox** - SMS and Email in single conversation view with platform badges

### Dashboard Features
- [x] **Inbox View** - Filterable conversation list with search
- [x] **Action Station** - AI draft review, edit, approve/reject workflow
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
- [x] Unified inbox for SMS + Email
- [x] Campaign sync and management

### 🚧 In Progress / Next Up
- [ ] **Analytics Dashboard** - Email open rates, reply rates, campaign performance
- [ ] **Auto-Follow-Up Logic** - Scheduled follow-ups based on lead status
- [ ] **Email Opens Tracking** - Persist EMAIL_OPENED events for analytics
- [ ] **Lead Scoring** - AI-powered lead prioritization

### 📋 Future Phases
- [ ] **Phase III: LinkedIn Integration** - Unipile API for LinkedIn messaging
- [ ] **Phase IV: Advanced Analytics** - Funnel visualization, A/B testing
- [ ] **Phase V: Team Features** - Multi-user access, assignment workflows
- [ ] **EmailGuard Integration** - Email validation before sending

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
