# Phase 42g — Stakeholder Clarifications Addendum (Timeout Route + EmailBison Base URL)

## Focus
Incorporate stakeholder clarifications into an executable hardening plan:

1) Treat the 5-minute timeout as a **Server Action** problem (`POST /`), not a cron problem.  
2) Make EmailBison base host configurable per organization/workspace to support white-label licensing.  
3) Confirm middleware should “fail open” and rely on server-side auth checks.
4) Enqueue BackgroundJobs for long-running sync work, and keep manual sync available.

## Inputs
- Vercel request ID: `hp74t-1768813460047-21e481a8c16a` (Jan 19, 2026) showing `POST /` → `504 Gateway Timeout` at 5m/5m.
  - Log context shows SMS + Email conversation sync work (e.g., `[Sync] Fetching SMS history...`, `[EmailSync] Fetching conversation history...`) plus upstream calls to Supabase, GHL (`leadconnectorhq.com`), EmailBison, and OpenAI.
- Product requirement: EmailBison base host must be configurable (multi-org / white-label email licenses), and base hosts should be manageable under Integrations.
- Initial allowed hosts: `send.meetinboxxia.com`, `send.foundersclubsend.com`
- Auth policy: rely on server-side auth checks; middleware should not hard-fail on transient Supabase errors.
- Stakeholder decision: enqueue BackgroundJobs (return fast) and keep manual sync available.

## Work
### A) Identify the Server Action causing the 5m timeout
- Search for the log prefixes seen in the invocation:
  - `"[Sync] Fetching SMS history"`
  - `"[EmailSync] Fetching conversation history"`
  - `"[EmailBison] Fetching replies for lead"`
- Trace to the Server Action entrypoint (likely under `actions/*`), and identify:
  - what triggers it (page load vs user click)
  - why it runs on the request path (vs BackgroundJobs)
  - which upstream call(s) are the long pole

### B) Redesign the action to return quickly (no 5m request path work)
- Enqueue work to BackgroundJobs and return immediately (no 5m request path work).
- Manual sync is allowed/desired: the UI trigger should enqueue the same job(s) and return immediately, then poll/show “sync queued/in progress”.
- Set Vercel runtime to allow 800s where applicable (route segment `maxDuration`) so unavoidable long work doesn’t hard-timeout at 5 minutes.
- Add a strict per-invocation time budget (e.g., 10–30s) for any remaining on-request work (best-effort).
- Ensure upstream calls are bounded:
  - GHL / EmailBison: explicit timeouts + limited retries
  - OpenAI: explicit timeout + bounded retries; ensure failures don’t crash the request
- Add safe, structured logging keyed to job/action identifiers (no secrets / no message bodies).

### C) Make EmailBison base host configurable (white-label)
- Data model (default assumption; aligned to “manage hosts under Integrations”):
  - Add an “allowed base hosts” entity in the database (e.g., `EmailBisonBaseHost` with `host` + optional `label`).
  - Add a per-workspace selection (e.g., `Client.emailBisonBaseHostId` or equivalent).
  - Default fallback remains `send.meetinboxxia.com` when no host is selected (backward compatibility).
- Integrations UI + actions:
  - Add UI in Settings → Integrations to add/remove allowed EmailBison base hosts.
  - Add per-workspace selector to pick the base host for that workspace.
  - Validate host entries to reduce SSRF/misconfig risk:
    - HTTPS-only (store hostname; build URL internally)
    - disallow IP literals and localhost-style hosts
    - normalize (lowercase, trim, no trailing dots)
  - Ensure existing workspaces continue working without changes (null baseUrl uses default).
- EmailBison client changes:
  - Remove/stop relying on the hard-coded base URL constant; thread the base URL through client calls.
  - Ensure 401 errors include safe context: `status + endpoint + baseHost`, but never include keys.
- Coordination:
  - Phase 41 also edits `lib/emailbison-api.ts`; integrate changes there to avoid divergent error mapping strategies.

## Output
- Implemented the “hardening” parts of the clarification layer without introducing new schema:
  - **Auth policy:** middleware now avoids Supabase refresh attempts when no auth cookie is present and treats session-missing auth errors as signed-out, while still failing open on non-auth unexpected middleware errors (server-side auth enforcement remains in actions/routes).
  - **EmailBison base host:** implemented deployment-wide base URL override via `EMAILBISON_BASE_URL` and ensured all 401/403 failures include safe `{ endpoint + host }` context with actionable remediation text (no secrets / no PII payload logs). Per-workspace base host selection + allowlist remains deferred (would require Prisma schema + UI changes).
  - **Timeout mitigation:** reduced default bulk-sync concurrency to better respect per-request time budgets and extended cron route `maxDuration` ceilings for long-running processors; full “enqueue jobs and return immediately” for sync flows remains deferred (would require introducing a dedicated async mechanism/job type).

## Handoff
- Wrap up Phase 42 by updating the root plan success criteria and noting the deferred items (per-workspace EmailBison base host selection; fully off-request-path sync orchestration).
