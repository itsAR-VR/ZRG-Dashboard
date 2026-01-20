# Phase 40c — Create fly.toml Deployment Configuration

## Focus

Create the Fly.io configuration file that defines the app name, region, VM resources, auto-stop behavior, and HTTP routing.

## Inputs

- `scripts/crawl4ai/Dockerfile` (from 40b)
- `scripts/crawl4ai/service.py` with `/health` endpoint (from 40a)
- Service runs on port 4891
- Cost optimization requirement: auto-stop when idle
- RED TEAM finding: need explicit HTTP check configuration

## Work

1. Create `scripts/crawl4ai/fly.toml`
2. Configure app name: `zrg-crawl4ai`
3. Set primary region: `iad` (US East, close to Vercel/Supabase)
4. Reference Dockerfile for builds
5. Configure HTTP service:
   - Internal port 4891
   - Force HTTPS
   - Auto-stop machines when idle
   - Auto-start on incoming request
   - Min machines = 0 (no always-on cost)
   - Concurrency limits (soft: 3, hard: 5)
6. Add explicit HTTP health check for `/health` endpoint
7. Configure VM:
   - 1GB memory (Playwright/Chromium needs ~1GB)
   - Shared CPU, 1 vCPU

### fly.toml Content

```toml
app = "zrg-crawl4ai"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "4891"

[http_service]
  internal_port = 4891
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

  [http_service.concurrency]
    type = "requests"
    hard_limit = 5
    soft_limit = 3

# Health check configuration - validates /health endpoint
[[http_service.checks]]
  grace_period = "10s"
  interval = "30s"
  method = "GET"
  path = "/health"
  timeout = "5s"

[[vm]]
  memory = "1gb"
  cpu_kind = "shared"
  cpus = 1
```

### Key Configuration Explained

| Setting | Value | Purpose |
|---------|-------|---------|
| `auto_stop_machines` | `"stop"` | Stops VM when idle (cost savings) |
| `auto_start_machines` | `true` | Wakes on incoming request |
| `min_machines_running` | `0` | No always-on instances |
| `memory` | `"1gb"` | Playwright/Chromium needs ~1GB RAM |
| `hard_limit` | `5` | Max concurrent requests before queuing |
| `[[http_service.checks]]` | `/health` | Explicit health check for Fly.io probes |

## Output

**Completed 2026-01-19**

- Created `scripts/crawl4ai/fly.toml` with:
  - App name: `zrg-crawl4ai`
  - Region: `iad` (US East)
  - Auto-stop/start enabled for cost optimization
  - Explicit HTTP health check on `/health` endpoint
  - 1GB memory, shared CPU
  - Concurrency limits (soft: 3, hard: 5)

**Files created:** `scripts/crawl4ai/fly.toml`

## Handoff

Subphase d will create a hardening + validation runbook to:
- Document local Docker build/run smoke test
- Add deployment validation steps (verify secret exists)
- Provide verification commands for health/extract endpoints
- Document dashboard end-to-end flow testing
