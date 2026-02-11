# Phase 132d — Analytics: Timing Buckets → Booking Outcomes

## Focus
Add analytics that correlate response time to booking outcomes:
- Setter response time buckets vs booking rate
- AI auto-send chosen delay seconds vs booking rate
- AI scheduled-vs-actual drift vs booking rate

## Inputs
- Phase 132b: populated `ResponseTimingEvent` rows
- Existing analytics patterns:
  - `actions/analytics-actions.ts:getAnalytics()` (line 777) — windowed analytics with caching
  - `components/dashboard/analytics-view.tsx` — tab-based dashboard renderer
- Existing booking attribution patterns:
  - `actions/ai-draft-response-analytics-actions.ts` — `AiDraftBookingConversionBucket` type (booked/notBooked/pending/bookedNoTimestamp/eligible/bookingRate), `resolveWindow()`, attribution window + maturity buffer
- Phase 131 (if complete): `lib/crm-sheet-utils.ts:deriveCrmResponseMode()` for consistent setter/AI attribution

## Work
1. Add new server action at `actions/response-timing-analytics-actions.ts`:
   - `getResponseTimingAnalytics(clientId: string, opts?: { from?: string; to?: string })` → returns timing impact data
   - Enforce workspace access via `resolveClientScope()`
   - Reuse `AiDraftBookingConversionBucket` shape from `ai-draft-response-analytics-actions.ts` for booking outcome buckets (don't reinvent)

2. Implement bucketing queries:
   - **Setter response-time buckets (wall-clock):**
     - Buckets: `<1min`, `1-5min`, `5-15min`, `15-60min`, `1-4hr`, `4-24hr`, `>24hr`
     - Source: `ResponseTimingEvent.setterResponseMs` (non-null rows only)
   - **AI chosen-delay buckets:**
     - Buckets: `180-210s`, `210-270s`, `270-330s`, `330-390s`, `390-420s` (matching the 3-7 min window)
     - Source: `ResponseTimingEvent.aiChosenDelaySeconds` (non-null rows only)
   - **AI drift buckets (scheduled vs actual):**
     - Buckets: `<10s early`, `on-time (±10s)`, `10-60s late`, `1-5min late`, `>5min late`
     - Source: `aiResponseSentAt - aiScheduledRunAt` (non-null rows only)

3. Define booking outcomes (MUST use `appointmentCanceledAt` — confirmed field exists at schema line 526):
   - `BOOKED`: `appointmentBookedAt IS NOT NULL` AND `appointmentBookedAt > response sentAt` AND within attribution window AND `appointmentCanceledAt IS NULL`
   - `PENDING`: response is too recent (maturity buffer, e.g., 14 days)
   - `NOT_BOOKED`: not booked and past maturity buffer
   - `BOOKED_NO_TIMESTAMP`: `appointmentBookedAt IS NULL` but booking indicators exist (separate from denominators)

4. Handle dual-responder attribution:
   - When BOTH setter and AI responded to the same inbound, attribute the booking to the **first responder** (lower `sentAt`)
   - Include both timing values in the per-event data for complete visibility

5. If Phase 131 is complete, import `deriveCrmResponseMode()` from `lib/crm-sheet-utils.ts`. If not, inline a temporary equivalent with `// TODO: import from crm-sheet-utils after Phase 131`.

6. Update `components/dashboard/analytics-view.tsx`:
   - Add a "Response Timing" tab alongside existing tabs
   - Render three chart/table sections: setter timing, AI delay, AI drift
   - Each section shows bucket name, sample count, booking rate, and a simple bar/table visualization
   - Respect existing `AnalyticsWindow` controls (pass `from/to` through)

## Validation (RED TEAM)
- Verify booking outcome uses `appointmentCanceledAt` (not just `appointmentBookedAt`)
- Verify bucket boundaries don't have gaps or overlaps
- Verify analytics respects window filtering (timing events outside the window excluded)
- Verify empty states render cleanly when no timing data exists for the window

## Output
- Added server action `actions/response-timing-analytics-actions.ts:getResponseTimingAnalytics()`:
  - Windowed by `ResponseTimingEvent.inboundSentAt` for cohort inclusion.
  - Computes booking outcomes using the same rules as AI-draft analytics (excludes canceled via `appointmentCanceledAt` and `appointmentStatus != 'canceled'`).
  - Buckets:
    - Setter response time (ms) for setter-first responses (ties → setter).
    - AI chosen delay seconds (3–7 min) for AI-first responses.
    - AI drift (scheduled runAt → actual send) for AI-first responses with a schedule.
  - Lead-level de-dup: uses earliest qualifying response per lead for each section.
- Updated `components/dashboard/analytics-view.tsx`:
  - Added a new "Response Timing" tab.
  - Fetches and renders the bucket tables for Setter, AI Delay, and AI Drift.

## Handoff
Subphase 132e should add/extend tests for deterministic delay attribution + analytics invariants, then run quality gates (`npm test`, `npm run lint`, `npm run build`).

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented response timing → booking conversion bucket analytics.
  - Added Analytics UI tab for response timing.
- Commands run:
  - `rg` / `sed` — confirmed analytics view integration points
- Blockers:
  - None
- Next concrete steps:
  - Add unit tests + run quality gates; document rollout/backfill notes (Phase 132e).

## Assumptions / Open Questions (RED TEAM)
- Attribution window for booking outcomes (default 14 or 30 days?) should match what `ai-draft-response-analytics-actions.ts` uses. Read the existing default before implementing. (confidence: 90%)
- Maturity buffer (how recent is "too recent to judge"?) should also match. (confidence: 90%)
- If Phase 131 is NOT yet implemented, the temporary `deriveCrmResponseMode` should produce identical results. (confidence: 75%)
