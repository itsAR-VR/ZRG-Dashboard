# Phase 18a — Data Contracts + Thread Selection Rules

## Focus
Define the “tool contract” for the chatbot: what data we fetch, how windows/campaign scopes are represented, and how we deterministically select the threads that become the session context pack.

## Inputs
- Existing analytics actions (campaign KPIs, weekly report, sentiment segmentation)
- Provider-aware booking rules (GHL vs Calendly)

## Work
- Define the request/response contract for:
  - Starting a seeded chat session (first question)
  - Creating/recomputing a session “context pack” keyed by window + campaign scope
  - Polling progress / status for long-running seed computation
  - Sending follow-up questions using the stored pack
- Implement deterministic thread selection rules:
  - Single scope: 75 total (50 positive / 25 negative)
  - Multi-campaign: 30 per campaign (20 positive / 10 negative), balanced per campaign
  - “All campaigns”: enforce cap (default 10; configurable)
  - No-response definition: no inbound ever (outbound-only threads)
- Define a normalized thread transcript contract for per-thread extraction:
  - messages ordered by timestamp
  - include direction, timestamp, channel, `sentBy`, and message ids

## Output
- Implemented the tool/action contract as server actions + internal libs:
  - Window selection + preset mapping: `lib/insights-chat/window.ts` (24h|7d|30d|custom → `InsightsWindowPreset`)
  - Campaign scope type: `lib/insights-chat/thread-selection.ts` (workspace|selected|all(cap))
  - Thread selection rules: `lib/insights-chat/thread-selection.ts:selectThreadsForInsightPack()`
    - Single scope: 75 threads (50 positive / 25 negative)
    - Multi-campaign: 30 per campaign (20 positive / 10 negative)
    - “All campaigns”: selects top campaigns by booked-in-window, fallback by positive replies; cap is clamped (default 10)
    - No-response bucket: `Lead.lastInboundAt == null` (no inbound ever)
  - Normalized transcript format: `lib/insights-chat/transcript.ts` (ordered by `sentAt`, includes `[msg:<id>]` + `sentBy`)
  - Per-thread extractor contract: `lib/insights-chat/thread-extractor.ts` (full thread in → compact JSON out)
  - Session pack orchestration contract: `actions/insights-chat-actions.ts`
    - `createInsightsChatSession`, `startInsightsChatSeedQuestion`
    - `createOrResetInsightContextPack`, `runInsightContextPackStep`, `getInsightContextPack`
    - `sendInsightsChatMessage` (follow-ups; pack must be COMPLETE)

## Handoff
Phase 18b applies these contracts to persistence + permissions by wiring Prisma models for sessions/messages/packs, and ensures we store compact artifacts (lead-level insights + pack synthesis) instead of re-sending raw threads on every question.

