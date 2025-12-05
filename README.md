# ZRG AI Master Inbox & CRM Dashboard

A scalable, full-stack custom application designed to manage high-volume sales outreach. This system replaces legacy n8n/Airtable workflows by unifying Email, SMS (GoHighLevel), and LinkedIn conversations into a single "Master Inbox" with AI-driven sentiment analysis and drafting capabilities.

**Current Status:** Phase I MVP (GoHighLevel SMS Integration & AI Classification).

**Live Demo:** [https://zrg-dashboard.vercel.app/](https://zrg-dashboard.vercel.app/)

## 🏗 Architecture

- **Frontend:** Next.js 14 (App Router), Tailwind CSS, Shadcn UI, Lucide Icons.
- **Backend:** Next.js Server Actions & API Routes.
- **Database:** Supabase (PostgreSQL) with Prisma ORM.
- **AI Engine:** OpenAI (GPT-4o / GPT-4o-mini).
- **Hosting:** Vercel (Serverless).

## 🔌 Core Integrations (Phase I)

- **GoHighLevel (GHL):** SMS messaging via Private Integrations (v2 API).
- **OpenAI:** Automatic sentiment classification of incoming messages (e.g., "Meeting Requested", "Not Interested").
- **Dynamic Multi-Tenancy:** Manage multiple GHL client workspaces by inputting API keys directly in the UI (stored securely in the DB).

---

## 🚀 Deployment Guide (Vercel)

This project is designed to be deployed directly to Vercel. We avoid maintaining a local `localhost` server for production logic, but you will need a local environment to sync database changes.

### 1. Vercel Environment Variables

| Variable | Description |
| :--- | :--- |
| `NEXT_PUBLIC_APP_URL` | Your production URL (e.g., `https://zrg-dashboard.vercel.app/`) |
| `NEXT_PUBLIC_SUPABASE_URL` | From Supabase Settings -> API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Supabase Settings -> API |
| `SUPABASE_SERVICE_ROLE_KEY` | From Supabase Settings -> API (Required for Webhooks) |
| `OPENAI_API_KEY` | Your OpenAI API Key |
| `DATABASE_URL` | **Transaction Pooler** connection string (Port 6543, ends with `?pgbouncer=true`) |
| `DIRECT_URL` | **Session Pooler** connection string (Port 5432) |


### 2. Database Management (Prisma)

Although the app runs on Vercel, you must run schema updates from your local machine.

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Create a local `.env.local` file:** Create a file named `.env.local` in the root directory and paste your `DATABASE_URL` and `DIRECT_URL` there. (This file is ignored by Git and used only for running the command below).

3. **Push Schema to Supabase:** Run this command whenever you change `prisma/schema.prisma` to update the actual database tables:
   ```bash
   npx prisma db push
   ```

### 3. Deploying Updates

The project is connected to GitHub. To deploy changes:

1. Commit your code.
2. Push to the `main` branch.
3. Vercel will automatically detect the commit, run `prisma generate` (via the postinstall script), and build the application.

---

## 🛠️ Local Development (Optional)

If you need to work on the UI locally:

1. **Configure Environment:** Ensure your `.env.local` file has the necessary keys (see above).

2. **Run Server:**
   ```bash
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000).

---

## 📂 Project Structure

```
/app              # Next.js App Router pages and API routes
  /api/webhooks   # Endpoints for GHL and other external triggers
/components       # Reusable UI components (Shadcn)
  /dashboard      # Main dashboard views (Inbox, CRM, Settings)
/lib              # Utility functions and the global Prisma client instance
/prisma           # Database schema definition (schema.prisma)
/actions          # Server actions for secure data mutations (Client creation, etc.)
```

---

## 🔮 Roadmap

- [x] Phase I: GHL SMS Webhook ingestion & AI Sentiment Analysis.
- [ ] Phase II: Email Integration (Gmail/Outlook) & Threading.
- [ ] Phase III: LinkedIn Integration (Unipile).
- [ ] Phase IV: "Click-to-Send" Approval Workflow & Analytics.
