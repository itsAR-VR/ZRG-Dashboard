# Phase 24 — Insights Console: Latency + Reliability (Context Pack Build)

## Purpose
Reduce “no answer after ~1 hour” incidents by making context-pack creation faster, more reliable (OpenAI 5xx-safe), and resilient to tab closes, while keeping context efficient.

## Context
The Insights Console builds a **session-level context pack** from representative lead threads (EmailBison campaigns, multi-campaign supported). The pack build can be large:
- Single campaign/workspace scope targets **~75 threads**
- Multi-campaign scope targets **~30 threads per campaign** (20 positive / 10 negative); with cap=10 this can reach **~300 threads**

Each thread can require multiple LLM calls (chunk compression + full extraction), so end-to-end build time can exceed an hour depending on transcript sizes, retries, and rate limits. Users are seeing OpenAI `500` errors during extraction/answer generation, and some sessions appear to stall.

We need: (1) better observability and (2) controlled parallelism + backoff, plus (3) context-efficient summarization and caching to minimize repeated work.

## Objectives
* [ ] Identify why packs stall or take >1h (thread count vs. timeouts vs. OpenAI errors)
* [ ] Improve build throughput with bounded parallelism and robust retry/backoff
* [ ] Ensure failures are isolated (per-thread) and do not halt the entire session/cron worker
* [ ] Make the UX set expectations (thread count, progress, ETA) and provide admin recovery (recompute/regenerate/restore)

## Constraints
- Context pack selection rules:
  - Single campaign: 75-thread target split (booked/requested + high score + negatives)
  - Multi-campaign: 30 threads per campaign minimum (20 positive / 10 negative), balanced per campaign
  - Campaign cap default is 10 (configurable)
- Session memory is per workspace; history persists indefinitely; only admins can soft-delete/restore sessions and recompute packs (audit logged).
- Model defaults: `gpt-5-mini` with Medium reasoning; allow other GPT-5.x models and effort selection.
- Do not require a logged-in user inside cron/webhook workers (system-safe execution).
- Keep old seed answer on recompute; only follow-ups use the newly recomputed pack; add explicit regenerate option.

## Success Criteria
- Pack progress reliably advances over time (no silent stalls) and errors surface as actionable diagnostics.
- OpenAI transient failures (5xx/429) are retried with bounded backoff; per-thread failures are recorded without stopping the entire pack.
- Users can understand expected build time before starting (thread count per scope) and can see progress/ETA while waiting.
- Initial answers appear reliably once the pack is ready (or an explicitly chosen “fast mode” threshold), even if the user closes the tab.

## Subphase Index
* a — Diagnose stalls and quantify bottlenecks
* b — Harden workers (retries/backoff, isolation, time budgets)
* c — Parallelization + context optimization (map-reduce, caching, partial packs)
* d — UX + admin recovery (ETA, warnings, tooling)

