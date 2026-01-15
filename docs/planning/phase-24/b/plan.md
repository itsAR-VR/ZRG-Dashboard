# Phase 24b — Harden workers (retries/backoff, isolation, time budgets)

## Focus
Make pack-building robust against OpenAI transient failures and platform timeouts, ensuring work continues and the system surfaces actionable status/errors.

## Inputs
- Phase 24a diagnostics (latency/error distribution; platform limits)
- Current worker architecture (UI-driven step loop + cron worker)

## Work
- Reliability improvements:
  - Add exponential backoff (with jitter) for 429/5xx for Insights-specific calls.
  - Ensure cron processing is per-pack/per-step isolated (one pack failing does not break processing of others).
  - Persist richer error details (`lastError`, attempt count, last attempt time, request IDs when available).
- Time-budgeted processing:
  - Limit “work per invocation” so single server actions / cron runs do not exceed platform max duration.
  - Prefer processing fewer leads per invocation when transcripts are large (adaptive batch sizing).
- Safety:
  - Ensure failures cannot cause infinite loops (stuck RUNNING with no progress).
  - Ensure seed-answer generation can retry later without blocking other packs.

## Output
- Worker changes that prevent stalls and reduce the frequency of user-visible failures.

## Handoff
- With a stable worker, Phase 24c can safely increase parallelism and add context-optimization without compromising reliability.

