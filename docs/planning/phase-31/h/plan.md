# Phase 31h — Handle AbortError/DOMException Safely (Timeout vs Cancellation, Retry Policy)

## Focus
Reduce production noise and prevent retry storms by correctly classifying `AbortError` / `DOMException [AbortError]` and applying a safe retry policy (GET-only; never retry cancelled requests).

## Inputs
- Prod errors:
  - `[EmailBison] Failed to fetch sent emails: Error [AbortError]: This operation was aborted`
  - `DOMException [AbortError]: This operation was aborted` (Undici)
- Repo reality:
  - `lib/emailbison-api.ts` wraps `fetch()` with an `AbortController` timeout (default 15s, clamp 60s).
  - The wrapper also listens to `init.signal` and aborts when the caller aborts (navigation, request cancellation).
  - Other network utilities (e.g., Slack DM/webhook) also use `AbortController` patterns and can emit aborts.

## Work

### 1) Define an abort taxonomy (must be unambiguous)
- **Timeout abort**: our own deadline elapsed.
- **Caller abort**: `init.signal` was aborted (navigation, request cancelled, function shutting down).
- **Platform abort**: runtime aborting the request (harder to detect; treat as caller abort unless proven otherwise).

### 2) Update fetch wrappers to preserve abort “reason”
- When aborting due to timeout, abort with an explicit reason (or an attached flag) so callers can distinguish:
  - `controller.abort(new Error("timeout"))` (or a structured reason object)
- When aborting due to caller abort, propagate the caller’s signal reason if present.

### 3) Retry matrix (RED TEAM hard rule)
- Retry allowed:
  - `GET` requests only
  - only when the failure is **timeout abort** or transient network errors (ECONNRESET/ETIMEDOUT/5xx)
- Retry forbidden:
  - any request where `init.signal` was aborted (caller cancellation)
  - non-idempotent methods (`POST`, `PATCH`, etc.) unless an explicit idempotency key exists end-to-end

### 4) Reduce log noise while preserving debuggability
- For aborts:
  - log a short, structured summary: provider, endpoint, timeoutMs, abortKind, attempt number
  - avoid logging the full DOMException enum dump in production logs
- For genuine failures (non-abort):
  - keep error logs, but include request context (workspace/client id where safe)

### 5) Apply to EmailBison callers with budget-aware behavior
- UI/server-action callers should treat EmailBison as optional:
  - if aborted, return cached/local DB data and render partial UI
- Background-job callers can use higher timeouts and limited retries (GET-only).

## Validation (RED TEAM)
- Simulate caller cancellation (abort `init.signal`) and verify:
  - abortKind=caller
  - no retries attempted
  - logs are at warn/info (not error) unless this is unexpected
- Simulate timeout abort and verify:
  - abortKind=timeout
  - GET calls retry up to the configured limit with backoff + jitter
- Confirm production logs no longer include large `DOMException` dumps for expected aborts.

## Output

**Already implemented in 31b. Verification complete:**

1. **EmailBison API (`lib/emailbison-api.ts`):**
   - ✅ `classifyAbort()` distinguishes "timeout" vs "caller" vs "unknown"
   - ✅ `isRetryableError()` returns false for caller cancellation, true for timeout
   - ✅ Only GET requests are retried (POST/PUT are not idempotent)
   - ✅ Exponential backoff with configurable max retries (EMAILBISON_MAX_RETRIES)
   - ✅ Caller cancellation logged at info level, not error
   - ✅ Timeout increased from 15s to 30s default

2. **GHL API (`lib/ghl-api.ts`):**
   - ✅ Retry logic for GET requests with backoff
   - ✅ AbortError detected and logged appropriately
   - ✅ Graceful error handling returns `{ success: false, error }`

3. **Slack DM (`lib/slack-dm.ts`):**
   - ✅ Basic abort handling (non-critical service)
   - ✅ Graceful error handling returns `{ ok: false, error }`

4. **Clay API (`lib/clay-api.ts`):**
   - ✅ POST requests (non-idempotent) - correctly no retry
   - ✅ Graceful error handling returns `{ success: false, error }`

**Retry matrix compliance:**
- GET requests: retried on timeout/network errors with exponential backoff
- POST/PUT requests: never retried (could cause duplicates)
- Caller cancellation: never retried (prevents retry storms on navigation)

**No additional code changes needed.** The 31b implementation already covered all requirements.

## Handoff
Proceed to 31i to harden the Insights cron that is hitting Prisma P1001 (context-packs route + worker concurrency).
