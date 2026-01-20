# Phase 40 — Deploy Crawl4AI to Fly.io

## Purpose

Deploy the existing Crawl4AI FastAPI service (`scripts/crawl4ai/service.py`) to Fly.io so the ZRG Dashboard can use it for Knowledge Assets website scraping in production.

## Context

**Why Fly.io?** Vercel/Supabase cannot run Crawl4AI because it requires Python + Playwright browser automation. Fly.io offers the cheapest option with auto-stop capability (~$0.25-1/month for occasional use).

**Current State:**
- `scripts/crawl4ai/service.py` — FastAPI service with `/extract` endpoint (exists)
- `scripts/crawl4ai/requirements.txt` — Python dependencies: crawl4ai, fastapi, uvicorn (exists)
- `lib/crawl4ai.ts` — TypeScript client already supports remote service via `CRAWL4AI_SERVICE_URL` env var

**Key insight:** The TypeScript client (`lib/crawl4ai.ts`) already:
1. Checks for `CRAWL4AI_SERVICE_URL` environment variable
2. Calls `POST /extract` with `{ url }` payload
3. Sends `Authorization: Bearer {secret}` header
4. Expects `{ markdown }` response

No TypeScript changes are needed — only deployment infrastructure files.

## Repo Reality Check (RED TEAM)

- What exists today:
  - `scripts/crawl4ai/service.py` exposes `POST /extract` and enforces `Authorization: Bearer ...` **only if** `CRAWL4AI_SERVICE_SECRET` is set.
  - `lib/crawl4ai.ts` supports:
    - remote service via `CRAWL4AI_SERVICE_URL` (+ optional `CRAWL4AI_SERVICE_SECRET`)
    - local runner via `CRAWL4AI_LOCAL_RUNNER=true`
    - fallback HTML fetch+strip when neither is configured
  - `scripts/crawl4ai/README.md` already documents `crawl4ai-setup` and port `4891`.
- What the plan assumes:
  - Fly.io deployment will set `CRAWL4AI_SERVICE_SECRET` so `/extract` is not publicly usable.
  - `crawl4ai-setup` in the container will install Playwright browsers successfully at build time.
- Verified touch points:
  - `scripts/crawl4ai/service.py`: `@app.post("/extract")`, `CRAWL4AI_SERVICE_SECRET`
  - `scripts/crawl4ai/requirements.txt`: `crawl4ai>=0.7.0`, `fastapi`, `uvicorn`
  - `lib/crawl4ai.ts`: `crawl4aiExtractMarkdown()`, `CRAWL4AI_SERVICE_URL`, `CRAWL4AI_SERVICE_SECRET`

## Concurrent Phases

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 39 | Complete | None | AI Personas; no overlap with Crawl4AI |
| Phase 38 | Complete | None | JSON parsing; no overlap with Crawl4AI |

## Pre-Flight Conflict Check

- [x] Ran `git status` — no unexpected modifications to `scripts/crawl4ai/*`
- [x] Scanned last 10 phases — no overlapping Crawl4AI or deployment changes
- [x] Read current state of `scripts/crawl4ai/service.py` and `lib/crawl4ai.ts`

## Objectives

* [x] Add `/health` endpoint to `scripts/crawl4ai/service.py` for Fly.io health checks
* [x] Create `scripts/crawl4ai/Dockerfile` with Playwright dependencies
* [x] Create `scripts/crawl4ai/fly.toml` with auto-stop configuration
* [x] Document deployment commands and environment variables

## Constraints

- Must not modify existing `/extract` endpoint behavior
- Dockerfile must include all Playwright/Chromium dependencies
- fly.toml must use auto-stop for cost optimization (min_machines_running = 0)
- Service port must be 4891 (matching existing local dev configuration)
- Health endpoint must be unauthenticated for Fly.io probes

## Success Criteria

- [ ] `fly deploy` succeeds from `scripts/crawl4ai/` directory *(requires manual deployment)*
- [ ] `curl https://zrg-crawl4ai.fly.dev/health` returns `{"status":"ok"}` *(requires manual deployment)*
- [ ] Extract endpoint returns markdown for test URL with valid auth *(requires manual deployment)*
- [ ] When `CRAWL4AI_SERVICE_SECRET` is set, unauthorized requests return 401 *(requires manual deployment)*
- [ ] Machine auto-stops after idle period (~5 min) *(requires manual deployment)*
- [x] `npm run lint` and `npm run build` pass (no TypeScript changes, but verify no regressions)

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes
- Docker image fails to build or Chromium fails at runtime (missing deps) → include a local `docker build` + `docker run` smoke test; keep a fallback plan to switch to an official Playwright base image if needed.
- Service accidentally deployed without `CRAWL4AI_SERVICE_SECRET` (public unauthenticated scrape endpoint) → add an explicit deploy validation step to confirm the secret exists before “done”.
- Cold starts + crawl latency exceed upstream timeouts → set conservative concurrency defaults and validate the end-to-end scrape workflow (create + retry scrape) in the dashboard.

### Missing or ambiguous requirements
- Fly health checks: adding `/health` alone may be insufficient if `fly.toml` does not configure a check path → add an explicit HTTP check configuration and validate via `fly status`.
- Concurrency/memory defaults are guesses → start low (1–2 concurrent requests) and scale based on logs and observed OOMs.

### Repo mismatches (fix the plan)
- `/extract` only returns 401 when `CRAWL4AI_SERVICE_SECRET` is configured; otherwise it allows unauthenticated requests (useful for local dev, risky in prod).

### Performance / timeouts
- Scrapes can be slow and memory-heavy → plan for a “first request is slow” user experience and document recommended Fly scaling knobs (`fly scale memory`).

### Security / permissions
- SSRF defense-in-depth exists in the Next.js server action, but the service itself only validates scheme → consider adding private-network blocking in `scripts/crawl4ai/service.py` (decision required).

### Testing / validation
- Add explicit verification commands for:
  - `/health`
  - `/extract` with auth + without auth (expect 401 when secret set)
  - dashboard flow: create website Knowledge Asset → successful ingestion, and “Retry website scrape” path

## Subphase Index

* a — Add health endpoint to service.py
* b — Create Dockerfile with Playwright dependencies
* c — Create fly.toml deployment configuration
* d — Hardening + validation runbook (Dockerfile/fly.toml, checks, concurrency)

## Deployment Commands (Post-Implementation)

### First-Time Setup

```bash
cd scripts/crawl4ai

# Authenticate with Fly.io
fly auth login

# Create the app
fly apps create zrg-crawl4ai

# Generate and set the secret (save this value for Vercel!)
fly secrets set CRAWL4AI_SERVICE_SECRET="$(openssl rand -hex 32)"
```

### Deploy

```bash
cd scripts/crawl4ai
fly deploy
```

### Verify

```bash
fly status
fly logs -a zrg-crawl4ai
curl https://zrg-crawl4ai.fly.dev/health
```

## Environment Variables

### Fly.io Secrets (set via CLI)

| Secret | How to Generate |
|--------|-----------------|
| `CRAWL4AI_SERVICE_SECRET` | `openssl rand -hex 32` |

### Vercel Environment Variables (after deployment)

| Variable | Value |
|----------|-------|
| `CRAWL4AI_SERVICE_URL` | `https://zrg-crawl4ai.fly.dev` |
| `CRAWL4AI_SERVICE_SECRET` | Same value as Fly.io secret |

## Cost Estimate

| Usage Pattern | Monthly Cost |
|---------------|--------------|
| Occasional (few times/week) | ~$0.25-1.00 |
| Moderate (daily use) | ~$2-3 |
| Heavy (continuous) | ~$5.70 |

Auto-stop means you only pay when the service is actually running.

## Troubleshooting

| Issue | Resolution |
|-------|------------|
| Build fails | Check Dockerfile syntax; ensure `crawl4ai-setup` completes |
| 401 Unauthorized | Verify `CRAWL4AI_SERVICE_SECRET` matches between Fly.io and Vercel |
| Timeout on first request | Expected: cold start takes 10-30s; subsequent requests are 2-5s |
| Out of memory | Scale up: `fly scale memory 2048` |

## Decisions (Locked)

- `CRAWL4AI_SERVICE_SECRET` is required for the Fly.io production deployment (secret is always set in Fly.io; `/extract` must return 401 without a valid `Authorization: Bearer ...` header).
  - Keep `scripts/crawl4ai/service.py` behavior (secret is optional for local/dev), but treat a missing secret in Fly as a deployment misconfiguration caught by validation.
- No additional SSRF defense-in-depth inside the Python service (continue relying on upstream guards in the Next.js server action + scheme validation in `service.py`).

## Phase Summary

**Status: Ready for Deployment (2026-01-19)**

All implementation artifacts have been created and are ready for manual deployment to Fly.io.

### Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `scripts/crawl4ai/service.py` | Modified | Added `/health` GET endpoint (unauthenticated) |
| `scripts/crawl4ai/Dockerfile` | Created | Container build with Python 3.12 + Playwright deps |
| `scripts/crawl4ai/fly.toml` | Created | Fly.io config with auto-stop, health checks, conservative concurrency |
| `scripts/crawl4ai/README.md` | Updated | Added Fly.io deployment docs + validation runbook |

### Key Decisions

1. **Conservative concurrency** — `soft_limit = 1`, `hard_limit = 2` to prevent OOM with Playwright/Chromium
2. **Explicit health check** — `[[http_service.checks]]` configured for `/health` endpoint
3. **No SSRF hardening in Python service** — rely on upstream guards in Next.js server action

### Validation

- `npm run lint`: pass (warnings only)
- `npm run build`: pass

### Next Steps (Manual)

1. `fly auth login && fly apps create zrg-crawl4ai`
2. `fly secrets set CRAWL4AI_SERVICE_SECRET="$(openssl rand -hex 32)"` — **save this value!**
3. `fly deploy`
4. Run post-deploy validation (see `scripts/crawl4ai/README.md`)
5. Add to Vercel: `CRAWL4AI_SERVICE_URL=https://zrg-crawl4ai.fly.dev` + secret
6. Test dashboard Knowledge Asset flow
