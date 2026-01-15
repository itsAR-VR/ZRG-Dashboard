# Phase 24c — Parallelization + context optimization (map-reduce, caching, partial packs)

## Focus
Reduce end-to-end build time without overloading OpenAI or exceeding platform constraints, while keeping the context pack high-signal and compact.

## Inputs
- Phase 24a/24b findings and updated worker constraints
- Existing per-thread extractor + chunk compression map-reduce
- Stored `LeadConversationInsight` summaries (reusable memory)

## Work
- Parallelization:
  - Introduce global (per-invocation) concurrency limits across both lead-level extraction and chunk-level compression.
  - Consider running selection across multiple campaigns concurrently with bounded DB concurrency.
  - Tune cron cadence/batch sizing defaults based on measured limits.
- Context optimization:
  - Reduce chunk count/overlap where safe; cap or adapt chunking based on transcript size.
  - Prefer cached `LeadConversationInsight` whenever available; add background computation for newly booked meetings (cron-driven).
  - Consider a “fast seed answer” mode:
    - generate an initial synthesis/answer once a minimum representative subset is processed (e.g., balanced across campaigns),
    - continue enriching the pack for follow-ups without changing the original seed answer (regenerate remains explicit).
- Memory systems:
  - Store per-lead thread summaries with sufficient metadata to reuse across sessions/windows; add invalidation/recompute strategy.

## Output
- Throughput improvements (measured), plus a context-pack design that stays within token budgets while retaining high-signal examples.

## Handoff
- Phase 24d can surface the new controls/expectations and admin tools in the UI.

