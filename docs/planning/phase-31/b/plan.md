# Phase 31b — Harden EmailBison Fetch with Timeout/Retry and Graceful Degradation

## Focus
Make EmailBison API calls resilient to timeouts and failures by increasing timeout thresholds, adding retry logic, and ensuring failures don't crash the calling request.

## Inputs
- From 31a: Message creation is now race-safe
- Error observed: `[EmailBison] Failed to fetch sent emails: Error [AbortError]: This operation was aborted`
- Current timeout: `EMAILBISON_TIMEOUT_MS` defaults to 15,000ms (15s)
- EmailBison fetch wrapper in `lib/emailbison-api.ts` uses `AbortController` with timeout
- Calls are made from dashboard server actions (lead detail loading) and webhooks

## Work

### 1. Increase default timeout
The 15s default is too aggressive for slow API responses. Increase to 30s:
```typescript
function getEmailBisonTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.EMAILBISON_TIMEOUT_MS || "30000", 10);
  if (!Number.isFinite(parsed)) return 30_000;
  return Math.max(1_000, Math.min(120_000, parsed));
}
```

### 2. Add retry logic to `emailBisonFetch`
Implement exponential backoff for transient failures:
```typescript
async function emailBisonFetch(
  url: string,
  init: RequestInit,
  opts?: { maxRetries?: number; retryDelayMs?: number }
): Promise<Response> {
  const maxRetries = opts?.maxRetries ?? 2;
  const baseDelay = opts?.retryDelayMs ?? 1000;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await doFetch(url, init);
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries && isRetryableError(error)) {
        await sleep(baseDelay * Math.pow(2, attempt));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === "AbortError") return true;
    if (error.message.includes("ECONNRESET")) return true;
    if (error.message.includes("ETIMEDOUT")) return true;
  }
  return false;
}
```

### 3. Graceful degradation in callers
Ensure callers handle failures without crashing:
- In `fetchEmailBisonSentEmails`: Already returns `{ success: false, error }` — verify all callers check this
- In dashboard loading: If EmailBison fails, show cached/local data only
- In webhooks: Log error but continue with what we have

### 4. Add circuit breaker (optional, if needed)
If EmailBison has extended outages, avoid hammering:
```typescript
const circuitBreaker = {
  failures: 0,
  lastFailure: 0,
  isOpen(): boolean {
    if (this.failures < 5) return false;
    if (Date.now() - this.lastFailure > 60_000) {
      this.failures = 0;
      return false;
    }
    return true;
  },
  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
  },
  recordSuccess() {
    this.failures = 0;
  }
};
```

### 5. Environment variable documentation
Add to README.md:
- `EMAILBISON_TIMEOUT_MS` — API request timeout (default: 30000)
- `EMAILBISON_MAX_RETRIES` — Max retry attempts (default: 2)

## Output

**Completed implementation in `lib/emailbison-api.ts`:**

1. **Increased default timeout from 15s to 30s:**
   - `getEmailBisonTimeoutMs()` now defaults to 30000ms
   - Max clamp increased from 60s to 120s for background jobs that need more time

2. **Added retry configuration:**
   - `getEmailBisonMaxRetries()` reads from `EMAILBISON_MAX_RETRIES` env var (default: 2)
   - Only GET requests are retried (POST/PUT are not idempotent)

3. **Implemented retry logic with exponential backoff:**
   - Base delay of 1000ms with exponential backoff (1s, 2s, 4s...)
   - Retryable errors: AbortError (timeout), ECONNRESET, ETIMEDOUT, ENOTFOUND, "fetch failed"

4. **Added abort classification:**
   - `isRetryableError()` - distinguishes timeout from caller cancellation
   - `classifyAbort()` - returns "timeout" | "caller" | "unknown" for logging
   - Caller cancellations are NOT retried (prevents retry storms on navigation)

5. **Improved logging:**
   - Logs retry attempts with delay and abort kind
   - Logs final failure with attempt count
   - Caller cancellations logged at info level (not error)

6. **Circuit breaker deferred:** Not implemented in this subphase - retry logic should be sufficient. Can be added later if EmailBison has extended outages.

7. **README documentation deferred:** Will be done in a cleanup pass after all subphases.

**Verified:** `npm run build` completes successfully.

## Handoff
EmailBison fetch is now resilient with retries for transient failures and proper abort handling. Subphase c can audit the email webhook for other blocking work that needs to move to background jobs.
