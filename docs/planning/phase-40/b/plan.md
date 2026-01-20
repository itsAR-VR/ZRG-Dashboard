# Phase 40b — Create Dockerfile with Playwright Dependencies

## Focus

Create a Dockerfile that builds a container image with Python 3.12, Playwright/Chromium browser dependencies, and the Crawl4AI FastAPI service.

## Inputs

- `scripts/crawl4ai/service.py` (with `/health` endpoint from 40a)
- `scripts/crawl4ai/requirements.txt` (crawl4ai, fastapi, uvicorn)
- Crawl4AI uses Playwright internally, which requires browser binaries and system libraries

## Work

1. Create `scripts/crawl4ai/Dockerfile`
2. Base image: `python:3.12-slim` (smaller than full python image)
3. Install system dependencies required by Playwright/Chromium:
   - fonts-liberation, libasound2, libatk*, libcups2, libdbus-1-3
   - libdrm2, libgbm1, libgtk-3-0, libnss3, libxcomposite1, etc.
4. Install Python dependencies from requirements.txt
5. Run `crawl4ai-setup` to install Playwright browsers
6. Copy service code and expose port 4891
7. Start uvicorn server

### Dockerfile Content

```dockerfile
FROM python:3.12-slim

# Install Playwright/Chromium system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates fonts-liberation libasound2 \
    libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcups2 \
    libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 \
    libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 \
    libxrandr2 xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browsers (Crawl4AI uses Playwright internally)
RUN crawl4ai-setup

# Copy service code
COPY service.py .

EXPOSE 4891
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "4891"]
```

## Output

**Completed 2026-01-19**

- Created `scripts/crawl4ai/Dockerfile` with:
  - `python:3.12-slim` base image for smaller footprint
  - All Playwright/Chromium system dependencies
  - Python dependency installation from requirements.txt
  - `crawl4ai-setup` to install browser binaries at build time
  - Uvicorn server on port 4891

**Files created:** `scripts/crawl4ai/Dockerfile`

## Handoff

Subphase c will create `fly.toml` which references this Dockerfile and configures Fly.io deployment settings including:
- Auto-stop/start for cost optimization
- Memory allocation (1GB for Playwright/Chromium)
- HTTP routing and health checks
- Concurrency limits
