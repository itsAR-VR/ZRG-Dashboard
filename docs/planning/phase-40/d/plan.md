# Phase 40d — Hardening + Validation Runbook

## Focus

Harden the Fly.io deployment for reliability and safety, and add concrete validation steps (local Docker smoke test + post-deploy checks) so Phase 40 can be executed without guesswork.

## Inputs

- `scripts/crawl4ai/service.py` (from 40a; must include unauthenticated `GET /health`)
- `scripts/crawl4ai/Dockerfile` (from 40b; baseline container build)
- `scripts/crawl4ai/fly.toml` (from 40c; baseline Fly config)
- Existing runtime client + usage:
  - `lib/crawl4ai.ts` (`CRAWL4AI_SERVICE_URL`, optional `CRAWL4AI_SERVICE_SECRET`)
  - `actions/settings-actions.ts` website ingestion + "Retry website scrape"

## Work

1. **Health checks (Fly.io)** ✓
   - HTTP health check added in 40c (`[[http_service.checks]]` on `GET /health`)
   - Validation: `fly status` shows checks passing after deploy

2. **Concurrency + resources** ✓
   - Updated to conservative concurrency:
     - `soft_limit = 1`, `hard_limit = 2`
   - Kept `min_machines_running = 0` and `auto_start_machines = true`
   - Added inline comment about scaling memory

3. **Secrets + auth hardening (deployment validation)** ✓
   - Added validation steps in README runbook:
     - Confirm `CRAWL4AI_SERVICE_SECRET` exists via `fly secrets list`
     - Confirm `/extract` returns 401 without auth header
   - Decision maintained: missing secret in Fly = deployment misconfiguration (no code change)

4. **Local container smoke test** ✓
   - Added to `scripts/crawl4ai/README.md`:
     - `docker build -t zrg-crawl4ai .`
     - `docker run --rm -p 4891:4891 -e CRAWL4AI_SERVICE_SECRET=devsecret zrg-crawl4ai`
     - Test commands for health, auth rejection, and successful extraction

5. **Post-deploy end-to-end validation** ✓
   - Added to `scripts/crawl4ai/README.md`:
     - `fly status`, `fly logs`, health endpoint test
     - Auth verification (401 without, success with)
     - Dashboard flow: Knowledge Asset creation + retry scrape

## Output

**Completed 2026-01-19**

- Updated `scripts/crawl4ai/fly.toml`:
  - Conservative concurrency: `soft_limit = 1`, `hard_limit = 2`
  - Added inline comment about memory scaling

- Updated `scripts/crawl4ai/README.md` with comprehensive validation runbook:
  - Option C: Deploy to Fly.io (production) section
  - Local Docker smoke test steps
  - Post-deploy validation commands
  - Dashboard end-to-end test instructions
  - Scaling & troubleshooting guide

**Files modified:**
- `scripts/crawl4ai/fly.toml` (concurrency hardening)
- `scripts/crawl4ai/README.md` (validation runbook)

## Handoff

Phase 40 implementation complete. All artifacts are ready for deployment:

**Files created/modified:**
- `scripts/crawl4ai/service.py` — `/health` endpoint added
- `scripts/crawl4ai/Dockerfile` — Container build with Playwright deps
- `scripts/crawl4ai/fly.toml` — Fly.io config with auto-stop + health checks
- `scripts/crawl4ai/README.md` — Deployment + validation documentation

**Next steps for user:**
1. Run local Docker smoke test (optional but recommended)
2. `fly auth login && fly apps create zrg-crawl4ai`
3. `fly secrets set CRAWL4AI_SERVICE_SECRET="$(openssl rand -hex 32)"`
4. `fly deploy`
5. Run post-deploy validation
6. Configure Vercel env vars
7. Test dashboard Knowledge Asset flow
