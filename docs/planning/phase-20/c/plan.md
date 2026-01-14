# Phase 20c — GHL Sync Rate-Limit + Concurrency Controls + Input Normalization

## Focus
Stop `Sync All` and other sync flows from causing bursts that trigger GHL 429/PIT errors and reduce 400-level errors by validating/normalizing inputs (test contact IDs, phone formats, country codes).

## Inputs
- Vercel logs showing 429/PIT errors during bulk sync.
- Sync code (`actions/message-actions.ts`, `lib/conversation-sync.ts`, `lib/ghl-api.ts`).

## Work
1. Add bounded concurrency to bulk sync (default low) so we never sync dozens of leads at once per workspace.
2. Treat PIT-context overload errors as rate limiting and back off.
3. Skip/soft-fail obviously invalid contact IDs (e.g., test IDs) to avoid noisy 400s.
4. Normalize/validate phone numbers before contact upserts to prevent “Invalid country calling code”.

## Output
- Reduced default `Sync All` concurrency to avoid bursty GHL traffic:
  - `actions/message-actions.ts` now defaults `SYNC_ALL_CONCURRENCY` to `3` (still overrideable via env).
- Improved 429 handling for PIT-context overload cases:
  - `lib/ghl-api.ts` detects PIT-context overload text on 429 and enforces a longer backoff (>= 30s).
- Skips invalid/test contact IDs to prevent noisy 400s during SMS sync:
  - `lib/conversation-sync.ts` validates `lead.ghlContactId` and short-circuits sync when invalid (success=true, 0 imported).
- Hardened GHL phone formatting to avoid “Invalid country calling code” on upserts:
  - `lib/phone-utils.ts` now rejects `+`-prefixed national-format numbers (<=10 digits) so callers fall back to best-effort formatting.

## Handoff
Proceed to Phase 20d to make webhook ingestion idempotent (P2002-safe), add strict webhook time budgets, and apply route-level maxDuration where supported.
