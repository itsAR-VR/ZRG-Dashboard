# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Reading Order (Golden Path)

1. This file (`CLAUDE.md`) - conventions + quick reference
2. `README.md` - product overview, integrations, env vars, deployment notes
3. `prisma/schema.prisma` - canonical data model
4. `app/api/**` - endpoints you're touching (webhooks, cron, admin)
5. `lib/**` - core domain logic
6. `actions/**` - Server Actions (write paths for the UI)

## What This Repo Is

ZRG Dashboard is a multi-channel sales inbox and CRM that unifies SMS (GoHighLevel), Email (Inboxxia/SmartLead/Instantly), and LinkedIn (Unipile) into a single interface with AI-driven sentiment analysis, draft generation, and follow-up automation.

**Tech Stack:** Next.js 16 (App Router), Prisma ORM, Supabase (PostgreSQL + Auth), OpenAI, Vercel

## Commands

```bash
npm run dev          # Start development server (localhost:3000)
npm run build        # Build for production (runs prisma generate first)
npm run lint         # ESLint
npm run db:push      # Push Prisma schema changes to database
npm run db:studio    # Open Prisma Studio GUI
```

After modifying `prisma/schema.prisma`, always run `npm run db:push` before considering work complete.

### Vercel CLI Workflow

```bash
vercel link                    # Link project
vercel env pull .env.local     # Pull env vars to local file
vercel dev                     # Local dev with Vercel parity (optional, npm run dev usually works)
vercel                         # Deploy preview
vercel --prod                  # Deploy production
```

## Environment & Secrets

- **Never** commit secrets, tokens, cookies, or personal data
- Use `.env.local` for local development; Vercel Environment Variables for deployments
- Database connections:
  - `DATABASE_URL` = pooled/transaction connection (pgbouncer, port 6543)
  - `DIRECT_URL` = non-pooled/session connection (port 5432, for Prisma CLI)

## Architecture

### Directory Layout

```
app/
  api/
    webhooks/       # External ingestion (email, ghl/sms, smartlead, instantly)
    cron/           # Vercel cron jobs (followups, ai-retention, availability, background-jobs)
    admin/          # Workspace provisioning endpoints
  auth/             # Supabase auth pages
  page.tsx          # Main dashboard entry

actions/            # Server Actions - all DB writes from UI go through here
                    # Pattern: return { success, data?, error? }

lib/                # Core domain logic
  prisma.ts         # Prisma client singleton
  supabase.ts       # Supabase client + auth helpers
  sentiment.ts      # AI sentiment classification
  ai-drafts.ts      # AI draft generation with availability-aware rules
  auto-reply-gate.ts # Safety gate for auto-sends
  followup-engine.ts # Multi-step sequence execution (cron-driven)
  availability-*.ts  # Calendar availability caching, formatting, distribution
  ghl-api.ts        # GoHighLevel API client with rate limiting
  emailbison-api.ts # Inboxxia/EmailBison API client
  unipile-api.ts    # LinkedIn/Unipile API client
  lead-matching.ts  # Cross-channel lead deduplication (email OR phone)
  ai/               # AI observability, prompt templates

components/
  dashboard/        # Feature components (inbox, crm, settings)
  ui/               # Shadcn primitives

prisma/
  schema.prisma     # Database schema (source of truth for all models)
```

### Key Data Models

- **Client** - Workspace/tenant with API keys for each integration
- **Lead** - Contact unified across channels (ghlContactId, emailBisonLeadId, linkedinId)
- **Message** - Conversation messages with `channel` field (sms/email/linkedin)
- **FollowUpSequence/FollowUpStep/FollowUpInstance** - Multi-step automation system
- **WorkspaceSettings** - AI personality, automation toggles, calendar config
- **AIInteraction** - Telemetry for token usage/cost tracking

### Key Flows

1. **Webhook Ingestion** (Async Pattern - Phase 35): External platforms POST to `/api/webhooks/*` → validate auth → normalize payload → dedupe via platform IDs → create/update Lead → insert Message → **enqueue BackgroundJob** → return 200 OK (< 2s). AI processing happens asynchronously via cron.

2. **AI Pipeline** (Background Jobs): Sentiment classification → status update → AIDraft creation (if enabled) → auto-reply gate check → optional auto-send → lead scoring. Runs via `/api/cron/background-jobs` every 1-5 min.

3. **Follow-Up Cron** (`/api/cron/followups`): Runs every 10 min, processes due FollowUpInstances, sends via appropriate channel, advances sequence state

4. **Booking**: Default CalendarLink provides availability → slots cached in WorkspaceAvailabilityCache → AI drafts include `{availability}` → auto-booking on clear acceptance

### Background Job Architecture

**Phase 35 Refactor:** Webhooks (GHL SMS, LinkedIn, SmartLead, Instantly) use async background jobs for AI processing to avoid Vercel timeout issues.

**How It Works:**

1. **Webhook receives event** → validates auth/secret → creates Message record → enqueues BackgroundJob → returns 200 OK (< 2s)
2. **Cron processes jobs** (`/api/cron/background-jobs`, every 1-5 min) → runs sentiment analysis, draft generation, enrichment, auto-send evaluation → updates Lead/Message/AIDraft
3. **Retry isolation:** Failed jobs retry with exponential backoff (independent of webhook timeout budget)

**Job Types:**

- `SMS_INBOUND_POST_PROCESS` — `lib/background-jobs/sms-inbound-post-process.ts`
  - Sentiment classification, draft generation, auto-reply evaluation
- `LINKEDIN_INBOUND_POST_PROCESS` — `lib/background-jobs/linkedin-inbound-post-process.ts`
  - Sentiment, draft, contact extraction, Clay enrichment, GHL sync
- `SMARTLEAD_INBOUND_POST_PROCESS` — `lib/background-jobs/smartlead-inbound-post-process.ts`
  - Sentiment, draft, auto-send (EmailCampaign mode), snooze detection, auto-booking
- `INSTANTLY_INBOUND_POST_PROCESS` — `lib/background-jobs/instantly-inbound-post-process.ts`
  - Sentiment, draft, auto-send (EmailCampaign mode), snooze detection, auto-booking
- `EMAIL_INBOUND_POST_PROCESS` — `lib/background-jobs/email-inbound-post-process.ts` (legacy email webhook)

**Key Utilities:**

- `lib/background-jobs/enqueue.ts` — Job enqueueing with deduplication (`dedupeKey = {clientId}:{messageId}:{jobType}`)
- `lib/background-jobs/runner.ts` — Job dispatcher, retry logic, exponential backoff

**Benefits:**

- **Eliminates timeouts:** Webhooks respond < 2s (vs 15-30s pre-refactor with inline AI processing)
- **Improves reliability:** Retry isolation (job failures don't affect webhook response)
- **Enables observability:** BackgroundJob table tracks status, attempts, errors, processing times

**Monitoring:**

- Check `BackgroundJob` table for job status (`PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`)
- Query `AIInteraction` table for token usage and costs
- Set alerts for failure rate > 10%, p95 processing time > 60s

### Multi-Tenancy

- Each workspace is a `Client` record tied to a Supabase Auth user
- `ClientMember` allows additional users (roles: ADMIN, SETTER, INBOX_MANAGER)
- Webhooks identify workspace via `ghlLocationId`, `emailBisonWorkspaceId`, or `clientId` query param
- Session/auth verified in middleware.ts and server actions

## Conventions

- Server Actions live in `actions/` and always return `{ success, data?, error? }`
- Use existing utilities in `lib/` rather than creating new patterns
- TypeScript strict mode; avoid `any`
- Webhooks validate secrets before processing request bodies
- AI interactions are logged to `AIInteraction` table with source attribution

## Quality Checklist

1. `npm run lint` - no errors
2. `npm run build` - succeeds
3. If schema changed: `npm run db:push` and verify in Studio
4. Test affected webhook endpoints with sample payloads

## Debugging

- Cron 401: Check `Authorization: Bearer ${CRON_SECRET}`
- Duplicate messages: Verify unique ID fields (`ghlId`, `emailBisonReplyId`, `inboxxiaScheduledEmailId`)
- Prisma deploy errors: Ensure `DIRECT_URL` is set correctly for CLI

## Workstreams

Use these labels when planning or scoping changes:

1. **Inbox & CRM** - Lead lifecycle, message threading, channel tabs
2. **AI Engine** - Sentiment, drafts, auto-reply gate, observability
3. **Follow-Ups** - Sequence editor, cron processing, pause/resume
4. **Calendar & Booking** - Availability cache, slot selection, booking
5. **Integrations** - GHL, Inboxxia, SmartLead, Instantly, Unipile, EmailGuard, Slack
6. **Admin Automation** - Workspace provisioning, admin endpoints
7. **Analytics** - Channel-aware KPIs, open/reply rates, trends

## MCP Tooling

Configured MCP servers (tokens in env, not repo):

- **context7** - Fast docs lookups (framework/libs)
- **GitHub** - Repo navigation, diffs, PR context
- **playwright** - Reproduce UI flows, integration testing
- **supabase** - Inspect tables/policies/data (careful with prod)
- **jam** - Capture/share repros with context

Supabase project: `ZRG Dashboard` (ref: `pzaptpgrcezknnsfytob`)

## Design Context

### Users
**Primary Audience:** Sales setters, solo sales professionals, customer success teams, marketing/growth teams, and marketing agencies managing high-volume multi-channel outreach (SMS, Email, LinkedIn).

**Context of Use:** Users are managing hundreds of active conversations simultaneously, qualifying leads under time pressure, and booking meetings across multiple clients/workspaces. They need to quickly triage incoming messages, send AI-assisted replies, and ensure no opportunities fall through the cracks.

**Job to be Done:** Transform overwhelming message volume across disparate channels into actionable, organized workflows with AI assistance—without sacrificing speed or control.

### Brand Personality
**Three Words:** Professional, Efficient, Intelligent

**Voice & Tone:** Enterprise-grade SaaS tool that's powerful yet approachable. The interface should feel like a trusted operations center—reliable, fast, and capable of handling scale without overwhelming the user.

**Emotional Goals:**
1. **Confidence & Control** - Users feel empowered to manage high volumes efficiently without missing opportunities
2. **Speed & Efficiency** - Interface feels fast, responsive, and doesn't slow users down
3. **Calm & Organization** - Despite high message volume, the interface feels organized and stress-reducing
4. **Intelligence & Insight** - AI assistance feels smart and helpful, not intrusive

### Aesthetic Direction
**Visual Tone:** Clean, conversation-first interface inspired by **Intercom / Front**—prioritizing message content, conversation threading, and quick actions over decorative elements.

**Key Characteristics:**
- Information-dense without feeling cluttered
- Conversation cards with clear visual hierarchy
- Strong use of color for status/sentiment badges (already implemented with ZRG green primary)
- Sidebar navigation with clear iconography
- Subtle animations for state transitions (not decorative)

**Theme:** Both light and dark mode supported (already implemented with OKLCH color tokens)

**Color Strategy:**
- **Primary (ZRG Green):** `oklch(0.696 0.17 162.48)` - Used sparingly for primary actions, active states, and brand moments
- **Semantic Colors:** Rich color palette for sentiment badges (green/interested, amber/out-of-office, red/blacklist, etc.)
- **Neutral Base:** High contrast text on background for readability during long sessions

**Anti-References:**
- ❌ Consumer-grade "delightful" micro-interactions that slow down power users
- ❌ Excessive gradients or glow effects (purple/multicolor AI aesthetic)
- ❌ Overly minimal designs that sacrifice information density
- ❌ Cluttered dashboards with competing visual hierarchies

### Design Principles

1. **Speed Over Delight**
   - Keyboard shortcuts and instant feedback take priority over decorative animations
   - Information density enables quick scanning—every pixel earns its place
   - Actions respond immediately; loading states are structural (skeletons) not spinners

2. **AI as Copilot, Not Autopilot**
   - AI-generated content (drafts, sentiment tags) is always visible and editable
   - Users maintain control—auto-reply gates, manual approval workflows, clear attribution
   - Intelligence should reduce cognitive load, not replace human judgment

3. **Multi-Channel Clarity**
   - Every conversation clearly indicates active channels (SMS/Email/LinkedIn badges)
   - Channel-switching is instant and obvious
   - No guessing which platform a message came from or where a reply will go

4. **Calm Under Volume**
   - Attention filters and inbox counts help users prioritize without panic
   - Subtle color coding (sentiment badges) provides at-a-glance triage
   - Whitespace and visual grouping prevent "wall of text" overwhelm

5. **Enterprise-Ready Polish**
   - Multi-workspace switching for agencies managing multiple clients
   - Role-based access (Admin/Setter/Inbox Manager) reflected in UI permissions
   - White-label branding support (brandName, brandLogoUrl) for agency deployments
