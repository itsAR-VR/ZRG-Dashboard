# Phase 40a — Add Health Endpoint to service.py

## Focus

Add a `/health` endpoint to the Crawl4AI FastAPI service for Fly.io health checks. This endpoint must be unauthenticated so Fly.io can probe the service status.

## Inputs

- Existing `scripts/crawl4ai/service.py` with `/extract` POST endpoint
- Fly.io requires a health check endpoint for auto-start/stop functionality

## Work

1. Read current `scripts/crawl4ai/service.py` to understand structure
2. Add a simple GET `/health` endpoint that returns `{"status": "ok"}`
3. Ensure the endpoint is unauthenticated (no Authorization header check)
4. Verify no syntax errors

### Code Added

```python
@app.get("/health")
async def health():
    """Health check endpoint for Fly.io (unauthenticated)."""
    return {"status": "ok"}
```

### Placement

Added after the `ExtractRequest` class and before the `/extract` endpoint (line 15-18).

## Output

**Completed 2026-01-19**

- Modified `scripts/crawl4ai/service.py` with `/health` GET endpoint at line 15-18
- Endpoint returns `{"status": "ok"}` without authentication
- Includes docstring explaining its purpose for Fly.io

**Files modified:** `scripts/crawl4ai/service.py`

## Handoff

Subphase b will create the Dockerfile that runs this service. The health endpoint enables Fly.io to determine when the container is ready to receive traffic. The service now has two endpoints:
- `GET /health` — unauthenticated, for health probes
- `POST /extract` — authenticated (when `CRAWL4AI_SERVICE_SECRET` is set)
