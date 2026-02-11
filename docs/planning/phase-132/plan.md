# Phase 132 — Setter vs AI Response Time Tracking + Booking Correlation

## Purpose
Add durable time tracking so we can measure, per lead and in analytics:
- How long it takes a **setter** to respond after an inbound message
- How long it takes the **AI** to respond after an inbound message (auto-sent only), including whether the configured 3–7 minute window landed closer to 3 minutes or 7 minutes, and whether timing impacts booking outcomes.

## Context
- The system already stores the canonical timestamps needed for response timing:
  - `Message.sentAt`, `Message.direction`, `Message.sentBy`, `Message.sentByUserId`, `Message.channel`
  - `AIDraft.triggerMessageId` (inbound anchor) and outbound `Message.aiDraftId`
  - Delayed auto-send uses `BackgroundJob.type=AI_AUTO_SEND_DELAYED` with `BackgroundJob.runAt` and a deterministic delay selection in `lib/background-jobs/delayed-auto-send.ts`.
- Existing analytics compute setter response time averages, but do not:
  - compute response timing per lead/inbound anchor
  - attribute AI auto-send delay selection (chosen seconds within min/max)
  - correlate timing buckets to booking outcomes

## Concurrent Phases
Overlap scan performed against the last 10 phases and current repo state (`git status --porcelain` shows a dirty working tree).

| Phase | Status | Overlap | Coordination |
|-------|--------|---------|--------------|
| Phase 131 | Active (untracked planning artifacts) | Domain: Analytics/CRM attribution (“setter vs AI booking rates”) | Reuse the same windowing conventions and avoid duplicating CRM attribution logic. If Phase 131 is implemented concurrently, coordinate changes to `actions/analytics-actions.ts` and `components/dashboard/analytics-view.tsx`. |
| Phase 127 | Active (uncommitted changes) | File adjacency: `app/api/cron/background-jobs/route.ts` referenced by Phase 127 | If Phase 132 needs to hook the cron route, re-read current state before editing to avoid overwriting memory-governance work. |
| Phase 126 | Complete | Files: `actions/analytics-actions.ts`, `components/dashboard/analytics-view.tsx` | Preserve existing analytics windowing + serialization constraints; keep new payloads Date-serializable. |
| Phase 130 | Complete | Domain: Auto-send (campaign controls) | Phase 132 must not change auto-send behavior; only instrument timing and correlate outcomes. |
| Working tree | Dirty | Modified files unrelated to response timing (memory governance) | Keep Phase 132 changes scoped to response timing + analytics; do not bundle unrelated edits. |

## Objectives
* [x] Persist response-timing events for inbound messages (setter + AI auto-send) with deterministic AI delay attribution.
* [x] Backfill historical timing events and keep them up to date via cron-safe batching.
* [x] Surface timing on a per-lead basis (Lead detail / Master Inbox context).
* [x] Add analytics to bucket timing and correlate with booking outcomes (setter vs AI, and AI delay chosen seconds).
* [x] Add tests for deterministic delay attribution and core streak/anchor invariants; pass quality gates.
* [x] Ensure Analytics custom date windows apply correctly (local-day boundaries; CRM uses exclusive `windowTo` semantics).

## Constraints
- Never commit secrets/tokens/PII.
- AI response definition (locked): **AI auto-sent only** (`Message.sentBy='ai'` + `aiDraftId` present). Human-sent messages that used an AI draft stay human for response-time attribution.
- Anchor definition (locked): compute timing **per inbound message** in a `(leadId, channel)` thread, but only for inbounds that are the last inbound before an outbound response.
- Response times are measured in wall-clock seconds; keep existing “business-hours filtering” available for setter comparisons by using the same strategy as current analytics (both timestamps within business hours).
- Analytics windowing: `windowTo` is exclusive; custom date inputs are interpreted as local-midnight day boundaries and then serialized as ISO timestamps.
- Prisma schema changes require `npm run db:push` before calling the phase complete.
- Cron safety: processing must be idempotent and safe under retries; work must be bounded per run.

## Success Criteria
1. For any lead, the UI shows recent inbound anchors with:
   - setter response time (if any) and responder identity
   - AI auto-send response time (if any) and the deterministic chosen delay seconds + scheduled `runAt`
2. Analytics exposes:
   - setter response-time buckets vs booking rate
   - AI chosen-delay buckets (e.g., 180s..420s) vs booking rate
   - AI scheduled-vs-actual drift buckets (cron lag) vs booking rate
3. Timing attribution is correct for inbound streaks (only the last inbound before an outbound response is used).
4. Quality gates pass: `npm test`, `npm run lint`, `npm run build` (and `npm run db:push` if schema changed).

Status: Met (2026-02-10).

## Subphase Index
* a — Data model + deterministic AI delay attribution helper
* b — Event processor + cron hook + backfill script (idempotent + bounded)
* c — Per-lead UI surfacing (Lead detail + optional Inbox panel)
* d — Analytics correlation (timing buckets → booking outcomes) + dashboards
* e — Tests + QA + rollout notes (db push + backfill + monitoring)
* f — Analytics window correctness (custom date parsing + CRM window end semantics)

---

## Repo Reality Check (RED TEAM)

- What exists today:
  - `computeDeterministicDelay()` is a **private** (non-exported) function in `lib/background-jobs/delayed-auto-send.ts:32`. Only `computeDelayedAutoSendRunAt()` (line 53) is exported. The plan says to "export a pure function `chosenDelaySeconds()`" but the real refactor is: either export the existing private `computeDeterministicDelay` or wrap it in a new exported function.
  - `BackgroundJob.messageId` exists (schema line 1299) and references the inbound `Message.id` — confirmed usable for joining timing events.
  - `BackgroundJob.draftId` exists (schema line 1302) — confirmed usable for linking to `AIDraft`.
  - `Lead.appointmentBookedAt` exists (line 521) AND `Lead.appointmentCanceledAt` exists (line 526) — the plan's booking outcome logic (132d) must account for cancellations using `appointmentCanceledAt`, not just checking if `appointmentBookedAt` exists.
  - `AIDraft` has a unique constraint on `(triggerMessageId, channel)` (line 1238) — important for deduplication but means the processor must handle the possibility of multiple drafts per trigger (different channels) or no draft at all.
  - `actions/ai-draft-response-analytics-actions.ts` exists and already defines `AiDraftBookingConversionBucket` with `booked/notBooked/pending/bookedNoTimestamp/eligible/bookingRate` — Phase 132d should reuse this exact shape rather than inventing a new one.
  - `components/dashboard/crm-view.tsx` exists (confirmed). `components/dashboard/action-station.tsx` exists (confirmed). Both are valid UI entry points for 132c.
  - Phase 131 defines `deriveCrmResponseMode()` in `lib/crm-sheet-utils.ts` — Phase 132d should import this for setter/AI attribution consistency.
  - The cron route (`app/api/cron/background-jobs/route.ts`) does NOT use advisory locks (explicitly commented out at line 86-88); it relies on per-job row locking. The plan says "under the same advisory lock" — this is WRONG. The processor hook must use its own idempotency mechanism (e.g., `ON CONFLICT DO NOTHING` on `inboundMessageId` unique key).

- Verified touch points:
  - `lib/background-jobs/delayed-auto-send.ts` — `computeDeterministicDelay` (private, line 32), `computeDelayedAutoSendRunAt` (exported, line 53), `scheduleAutoSendAt` (exported, line 66)
  - `prisma/schema.prisma` — Message (line 1039), Lead (line 459), AIDraft (line 1197), BackgroundJob (line 1289)
  - `app/api/cron/background-jobs/route.ts` — GET handler with `processBackgroundJobs()` call + pruning hooks
  - `actions/analytics-actions.ts` — `getAnalytics()` at line 777, uses `AnalyticsWindow`, caching, windowed queries
  - `actions/ai-draft-response-analytics-actions.ts` — booking conversion bucket types + attribution window + maturity buffer patterns
  - `components/dashboard/analytics-view.tsx` — tab-based analytics dashboard
  - `lib/crm-sheet-utils.ts` — `deriveCrmResponseMode()` (Phase 131)
  - `BackgroundJobType.AI_AUTO_SEND_DELAYED` — enum value at schema line 165

## RED TEAM Findings (Gaps / Weak Spots)

### Highest-risk failure modes

1. **Cron processor adds unbounded latency to background-jobs route** → The cron route already runs `processBackgroundJobs()` + pruning + stale draft recovery. Adding a response-timing processor without a per-run time budget risks exceeding Vercel's 800s `maxDuration`. **Mitigation:** Add a `RESPONSE_TIMING_BATCH_SIZE` env (default 200) and `RESPONSE_TIMING_MAX_MS` env (default 15000). Exit early if time budget exhausted. Log `{processed, skipped, durationMs}`.

2. **Backfill script on 365 days of data may lock/bloat the DB** → Large `INSERT ... ON CONFLICT` batches over a year of messages can spike WAL and connection pool. **Mitigation:** Backfill script must use cursor-based pagination (not OFFSET), commit per batch (not one giant transaction), use `statement_timeout` per batch (e.g., 30s), and print progress. Add a `--dry-run` flag.

3. **`computeDeterministicDelay` relies on messageId hash for determinism, but historical messages may have been processed with different min/max configs** → Campaign delay configs can change over time. If the processor snapshots current config, historical timing events will show the delay the system *would have* chosen with *today's* config, not what it *actually* chose. **Mitigation:** For historical backfill, prefer reading `BackgroundJob.runAt - Message.sentAt` as the actual delay (ground truth). Only use the deterministic helper for validation/comparison. Add a `aiActualDelaySeconds` field computed from timestamps, separate from `aiChosenDelaySeconds`.

4. **Phase 131 not yet implemented; 132d depends on shared patterns** → If 132d is implemented before 131, the `deriveCrmResponseMode()` function and windowing patterns may not exist yet. **Mitigation:** 132d must check if `lib/crm-sheet-utils.ts:deriveCrmResponseMode` exists. If not, inline a temporary equivalent with a `// TODO: import from crm-sheet-utils after Phase 131` comment. Ensure the logic is identical.

### Missing or ambiguous requirements

5. **"Last inbound before outbound" anchor definition is ambiguous for multi-channel leads** → A lead can have concurrent SMS and email threads. An inbound SMS followed by an outbound email is cross-channel. **Mitigation (clarify):** Anchor definition should be scoped to `(leadId, channel)` — only same-channel outbound counts as a response. This is implied by the plan but never stated explicitly as a constraint. Add to Constraints.

6. **No definition of "response" for setter** → The plan says `sentByUserId IS NOT NULL` for setter attribution, but this includes system-generated messages forwarded by setters. **Mitigation:** Tighten to: setter response requires `direction='outbound'` AND `sentBy='setter'` AND `sentByUserId IS NOT NULL`. Add this to Constraints.

7. **Missing: what happens when both setter AND AI respond to the same inbound?** → The `ResponseTimingEvent` has separate setter/AI fields, implying both can be filled. But booking attribution for "which response caused the booking" is undefined. **Mitigation:** For timing analysis, keep both fields independently. For booking correlation, attribute to the *first* responder (lower `sentAt`). Document this in 132d.

### Repo mismatches (fix the plan)

8. **132b says "under the same advisory lock"** → The cron route explicitly avoids advisory locks (line 86-88 comment). **Fix:** Change to "after `processBackgroundJobs()` completes, using `inboundMessageId` uniqueness for idempotency (ON CONFLICT DO NOTHING)."

9. **132a says export `chosenDelaySeconds(triggerMessageId, minSeconds, maxSeconds)`** → The existing function is named `computeDeterministicDelay(messageId, minSeconds, maxSeconds)`. **Fix:** Export the existing function under its current name, or create a thin wrapper named `computeChosenDelaySeconds` that delegates. Don't rename the internal function (callers exist).

10. **132c references `components/dashboard/crm-view.tsx` as "Lead detail sheet"** → The actual lead detail is rendered via `crm-drawer.tsx` (confirmed via glob). **Fix:** Update reference to `components/dashboard/crm-drawer.tsx`.

### Performance / timeouts

11. **Window-function query over Message table for setter response attribution** → The Message table is large. Partitioning by `(leadId, channel)` with `ORDER BY sentAt` requires a composite index `(leadId, channel, sentAt)`. **Mitigation:** Verify this index exists or add it to the schema in 132a. Check: `Message` model currently has `@@index([leadId])` but NOT `@@index([leadId, channel, sentAt])`. This index is needed.

12. **Processor lookback of 90 days re-scans recent messages on every cron run** → If timing rows already exist for most messages, the processor wastes time re-evaluating them. **Mitigation:** Use a high-water-mark pattern: track the latest `inboundSentAt` processed, and only scan messages newer than that. Fall back to 90d lookback on first run or when the high-water-mark is stale.

### Security / permissions

13. **New server action `actions/response-timing-actions.ts` must enforce workspace access** → Use `resolveClientScope()` or `accessibleClientWhere(user.id)` pattern consistent with other actions. Ensure non-admin users cannot see timing data from other workspaces.

14. **Backfill script must not run in production without auth** → The script should validate that it's being run locally (check for `DIRECT_URL` env) and require explicit confirmation for large lookback windows.

### Testing / validation

15. **No integration test for the processor** → The plan only mentions unit tests for the delay helper and streak invariant. **Mitigation:** Add a processor integration test using a fixture dataset (create messages in test DB, run processor, assert timing rows). This can be a test helper or a smoke-test script.

16. **Missing: validate that `computeDeterministicDelay` produces the same result as `BackgroundJob.runAt - inboundSentAt`** → For existing delayed sends, the deterministic helper should reproduce the actual delay. Add a validation step in 132e that samples N historical jobs and compares.

## Open Questions (Resolved)

- [x] **Should timing analytics in 132d be a new tab in Analytics, or a sub-section within the existing Analytics tabs?**
  - **Decision: New "Response Timing" tab** in `analytics-view.tsx`. Isolated, easy to ship and iterate.

- [x] **Should the processor run on every cron invocation, or only when explicitly triggered?**
  - **Decision: Dedicated cron endpoint** at `app/api/cron/response-timing/route.ts`. Requires adding to `vercel.json` cron schedule. Cleaner separation; own 800s budget; no latency impact on background-jobs cron.

- [x] **Should `aiActualDelaySeconds` (from timestamps) be stored alongside `aiChosenDelaySeconds` (from deterministic helper)?**
  - **Decision: Store both.** Captures "what actually happened" vs "what the system intended." Accounts for config drift on historical data.

## Assumptions (Agent)

- `BackgroundJob.messageId` always references the inbound trigger message for `AI_AUTO_SEND_DELAYED` jobs. (confidence: 95%)
  - Mitigation: Verify by sampling 5 recent `AI_AUTO_SEND_DELAYED` jobs in production.
- Phase 131 will define `deriveCrmResponseMode()` before Phase 132d is implemented. (confidence: 75%)
  - Mitigation: If not, inline a temporary equivalent.
- No other phase is modifying `lib/background-jobs/delayed-auto-send.ts` concurrently. (confidence: 95%)
  - Mitigation: Check `git status` before editing.

## Phase Summary (running)
- 2026-02-10 — Added `ResponseTimingEvent` Prisma model + Message composite index and exported `computeChosenDelaySeconds()`; applied schema via `npm run db:push`. (files: `prisma/schema.prisma`, `lib/background-jobs/delayed-auto-send.ts`)
- 2026-02-10 — Implemented response timing processor + cron endpoint + backfill script, surfaced per-lead UI in CRM drawer, and added analytics buckets + dashboard tab. (files: `lib/response-timing/processor.ts`, `app/api/cron/response-timing/route.ts`, `scripts/backfill-response-timing.ts`, `actions/response-timing-actions.ts`, `components/dashboard/crm-drawer.tsx`, `actions/response-timing-analytics-actions.ts`, `components/dashboard/analytics-view.tsx`)
- 2026-02-10 — Fixed Analytics custom date parsing (local-midnight windows) and aligned CRM date range filtering to exclusive `windowTo` semantics. (files: `components/dashboard/analytics-view.tsx`, `actions/analytics-actions.ts`)

## Phase Summary
- Shipped:
  - `ResponseTimingEvent` storage + processor + cron schedule + backfill script.
  - Per-lead "Response Timing" section in the CRM drawer.
  - Analytics "Response Timing" tab with booking conversion buckets.
- Verified:
  - `npm test`: pass
  - `npm run lint`: pass (warnings only)
  - `npm run build`: pass
  - `npm run db:push`: pass
- Notes:
  - Analytics buckets are lead-level (earliest qualifying response per lead per section).
