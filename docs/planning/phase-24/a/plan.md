# Phase 24a — Diagnose stalls and quantify bottlenecks

## Focus
Determine whether “no answer after ~1 hour” is primarily caused by (a) large thread counts (e.g., 300 threads), (b) platform timeouts, (c) OpenAI 5xx/429 churn, or (d) build-loop orchestration issues.

## Inputs
- Existing Insights Console UI + context pack worker + cron worker
- `AIInteraction` telemetry and context-pack status fields (processed/target threads, lastError)
- Recent user reports: OpenAI `500` with request IDs; long waits without answers

## Work
- Reproduce locally or in staging with a representative multi-campaign selection (cap=10) and verify:
  - `targetThreadsTotal` aligns with expected counts
  - `processedThreads` advances steadily
  - pack transitions: `PENDING` → `RUNNING` → `COMPLETE`/`FAILED`
  - answer generation behavior when pack completes
- Inspect error surfaces:
  - Are failures coming from extraction vs synthesis vs final answer generation?
  - Do failures stop the worker loop or only mark per-thread errors?
- Quantify:
  - median/95p thread-extraction latency (and chunk-compression latency when triggered)
  - OpenAI error rates by model/effort
  - estimated end-to-end time per pack size (75 vs 300 threads)
- Confirm deployment constraints:
  - serverless max duration for server actions + cron route handlers
  - OpenAI rate limits for the API key in use

## Output
- A short diagnostic report: root cause ranking + which knobs to tune first (batch size, concurrency, retries, cron cadence).

## Handoff
- Feed measured latency/error data into Phase 24b to choose safe time budgets and concurrency/backoff defaults.

