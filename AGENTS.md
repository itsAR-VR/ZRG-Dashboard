# AGENTS.md — ZRG Dashboard Path Guide

Scope: This file governs the ZRG-Dashboard repository (Next.js App Router + Prisma/Supabase + Vercel Cron + multi-channel inbox integrations).

Read this first if you’re contributing, reviewing, or acting as an automated coding agent.

---

## Reading Order (Golden Path)

1. `README.md` — product overview, integrations, env vars, deployment notes, roadmap
2. `prisma/schema.prisma` — canonical data model
3. `app/api/**` — endpoints you are touching (webhooks, cron, admin automation)
4. `lib/**` — core domain logic (AI, availability/booking, follow-ups, integration clients)
5. `actions/**` — Server Actions (write paths for the UI)
6. This file (`AGENTS.md`) — conventions + workflows

---

## What This Repo Is

ZRG Dashboard unifies **SMS (GoHighLevel)**, **Email (Inboxxia/EmailBison)**, and **LinkedIn outbound (Unipile)** into a single “Master Inbox” with:

- AI sentiment classification
- AI draft generation (human-approve workflow)
- optional auto-replies (with safety gating)
- follow-up sequences (cron-driven)
- calendar availability + booking automation

---

## Quick Commands (Run These)

From repo root:

- Install: `npm install`
- Dev server: `npm run dev`
- Lint: `npm run lint`
- Build (Vercel parity-ish): `npm run build`
- Prisma schema sync: `npm run db:push`
- Prisma UI: `npm run db:studio`

If you change `prisma/schema.prisma`, you **must** run `npm run db:push` against the correct database before considering the task done.

---

## Environment & Secrets (Non-Negotiable)

- **Never** commit secrets, tokens, cookies, or personal data.
- Prefer `.env.local` for local work; use Vercel Environment Variables for deployments.
- Database:
  - `DATABASE_URL` = pooled/transaction connection (pgbouncer)
  - `DIRECT_URL` = non-pooled/session connection (Prisma CLI commands)

---

## Vercel CLI Workflow (Recommended)

Use this when you need “real” Vercel parity or want to pull env vars quickly.

- Link project: `vercel link`
- Pull env vars to local file:
  - `vercel env pull .env.local` (or omit filename to write `.env`)
- If using `vercel dev` / `vercel build`:
  - `vercel pull` (caches settings/envs under `.vercel/`)
- Optional local parity:
  - `vercel dev` (often you can just run `npm run dev` for Next.js)
- Deploy:
  - Preview: `vercel`
  - Prod: `vercel --prod`

---

## Repo Map (Where Things Live)

### App Router
- `app/` — UI routes + API routes
  - `app/api/webhooks/` — external ingestion
    - `email/route.ts` (Inboxxia multi-event webhook)
    - `ghl/sms/route.ts` (GoHighLevel SMS webhook)
  - `app/api/cron/followups/route.ts` — cron processor endpoint
  - `app/api/admin/workspaces/route.ts` — automation provisioning endpoint

### Server Actions
- `actions/` — DB writes used by the UI (create/update workspaces, leads, messages, settings, follow-ups, etc.)
- Rule: keep actions small; validate inputs; return `{ success, data?, error? }` consistently.

### Core Domain Logic
- `lib/`
  - `prisma.ts` — Prisma singleton
  - `supabase.ts` + `lib/supabase/*` — auth/session + admin lookups (service role only server-side)
  - `sentiment.ts` — sentiment classification
  - `ai-drafts.ts` — draft generation
  - `auto-reply-gate.ts` — “should we auto-send?” decision gate
  - `availability-cache.ts` / `availability-format.ts` — calendar availability
  - `availability-distribution.ts` / `slot-offer-ledger.ts` — slot selection + offered-slot counting
  - `snooze-detection.ts` — “after Jan 13” style deferrals
  - `timezone-inference.ts` — lead TZ inference (deterministic + AI fallback)
  - integration clients: `emailbison-api.ts`, `ghl-*`, `unipile-*`, etc.

### Middleware
- `middleware.ts` — session refresh + route protection (don’t break auth redirects)

---

## Key Flows (How the System Works)

### 1) Webhook Ingestion → DB
- Webhooks normalize payloads, de-dupe using platform IDs, map to a single Lead across channels, and insert Message rows.
- Always treat webhooks as untrusted input: validate + sanitize.

### 2) AI Pipeline
- Sentiment tags update Lead status and drive follow-up logic.
- Draft generation writes an `AIDraft` that the UI can approve/edit/discard.
- Auto-replies must pass the safety gate (opt-outs, automated replies, “ack-only” responses, etc).

### 3) Follow-Up Automation (Cron)
- `vercel.json` schedules `/api/cron/followups` every 10 minutes.
- The endpoint requires `Authorization: Bearer <CRON_SECRET>`.

### 4) Booking & Availability
- Default `CalendarLink` is source-of-truth for `{availability}`.
- Availability caches refresh periodically; booking logic only books on clear acceptance.

### 5) Workspace Provisioning (Automation)
- `POST /api/admin/workspaces`
- Auth via `Authorization: Bearer <WORKSPACE_PROVISIONING_SECRET>` (header fallback supported)
- Creates/updates a `Client` workspace plus default `WorkspaceSettings`.

---

## Patterns & Rules (Keep Codebase Consistent)

- Prefer existing utilities in `lib/` over inventing new patterns.
- TypeScript everywhere; avoid `any` unless you must, then narrow ASAP.
- Keep UI components small and co-located by feature.
- Prisma:
  - Use the existing Prisma client singleton.
  - If schema changes: `npm run db:push`, then verify (Studio or SQL) before finishing.
- API routes:
  - Use explicit status codes, and return structured JSON errors.
  - Validate secrets (cron/admin) before reading request bodies.

---

## Quality Checklist (Before You Say “Done”)

1. `npm run lint`
2. `npm run build`
3. If Prisma schema changed:
   - `npm run db:push`
   - confirm tables/columns exist
   - update README/env var docs if required
4. Smoke test (minimum):
   - Login works
   - webhook endpoint accepts a sample payload (or test route)
   - cron endpoint returns success with CRON_SECRET
   - sending a message creates a Message row

---

## Common Debugging Notes

- Cron returns 401: check `Authorization: Bearer ${CRON_SECRET}`.
- Webhook duplicates: confirm unique IDs are stored (`ghlId`, `emailBisonReplyId`, `inboxxiaScheduledEmailId`).
- Prisma errors on deploy: verify `DIRECT_URL` is set correctly for CLI usage and `DATABASE_URL` is correct for runtime.

---

## Workstreams (“Projects”) Inside This Repo

Use these labels when planning or scoping changes:

1. Inbox & CRM (Lead lifecycle, message threading, channel tabs)
2. AI Engine (sentiment, drafts, auto-reply gate, observability)
3. Follow-Ups (sequence editor, cron processing, pause/resume)
4. Calendar & Booking (availability cache, slot selection, booking)
5. Integrations (GHL, Inboxxia, Unipile, EmailGuard, Slack)
6. Admin Automation (workspace provisioning, admin endpoints)
7. Analytics (next up: channel-aware KPIs, open/reply rates, trends)

---

## MCP Tooling (From Your config.toml)

Configured MCP servers (no tokens in repo — keep them in env):

- context7 — fast docs lookups (framework/libs)
- GitHub — repo navigation, diffs, PR context
- playwright — reproduce UI flows, integration testing
- supabase — inspect tables/policies/data (be careful with prod)
- jam — capture/share repros with context

Supabase project for this repo: `ZRG Dashboard` (project ref: `pzaptpgrcezknnsfytob`).



If a task needs cross-repo work, explicitly state which repo(s) are in scope before editing.
