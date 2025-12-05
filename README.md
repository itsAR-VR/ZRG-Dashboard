# ZRG AI Master Inbox & CRM Dashboard

A scalable, full-stack custom application designed to replace legacy n8n/Airtable workflows. This system manages high-volume sales outreach by unifying Email, SMS (GoHighLevel), and LinkedIn conversations into a single "Master Inbox" with AI-driven sentiment analysis and drafting capabilities.

## 🏗 Architecture

- **Frontend:** Next.js 14 (App Router), Tailwind CSS, Shadcn UI, Lucide Icons.
- **Backend:** Next.js Server Actions & API Routes.
- **Database:** Supabase (PostgreSQL) with Prisma ORM.
- **AI Engine:** OpenAI (GPT-5.1 / GPT-5-mini).
- **Infrastructure:** Vercel (Hosting & Cron Jobs).

## 🔌 Core Integrations

- **GoHighLevel (GHL):** SMS messaging via Private Integrations (v2 API).
- **EmailBison:** Outbound email infrastructure.
- **Unipile:** LinkedIn message syncing (Planned).
- **Slack:** High-priority notifications (e.g., "Meeting Booked").

## 🚀 Key Features

1.  **Master Inbox:** A 3-pane dashboard (Folders -> Feed -> Conversation) to manage multi-channel communications.
2.  **AI Automation:**
    * **Classification:** Automatically tags incoming messages (e.g., "Meeting Requested", "Not Interested", "Blacklist").
    * **Drafting:** Generates context-aware reply drafts for human approval.
3.  **Dynamic Multi-Tenancy:**
    * Manage multiple client workspaces on the fly by inputting API keys in the settings (no code deployment required).
4.  **Real-Time Sync:** Uses Supabase Realtime to update the inbox instantly when new webhooks arrive.

## 🛠️ Getting Started

### Prerequisites
- Node.js 18+
- Supabase Project
- OpenAI API Key
- GoHighLevel Account (for testing webhooks)

### Environment Setup

1. Copy the example environment file:
   ```bash
   cp .env.example .env.local