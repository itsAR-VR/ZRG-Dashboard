# Phase 110c — Stabilize Outcome Analytics Windowing (No `updatedAt` Drift)

## Focus
Make AI draft outcome analytics windowing stable by anchoring the date filter to an immutable send-time signal (per-draft) instead of `AIDraft.updatedAt`, which can change for unrelated updates.

## Inputs
- Current action (drift-prone):
  - `actions/ai-draft-response-analytics-actions.ts` uses `d."updatedAt" >= from AND d."updatedAt" < to`.
- Available stable timestamp:
  - `Message.sentAt` for outbound messages linked to drafts (`Message.aiDraftId`).
- Channel-specific constraints:
  - Email counts only when `EmailCampaign.responseMode = 'AI_AUTO_SEND'` (Phase 101 decision).
  - SMS multipart must count **distinct drafts**, not messages.

## Work
1. **Decide the per-draft “send time” anchor**
   - Recommended: `min(Message.sentAt)` across outbound messages for a draft.
   - Rationale: a draft should be counted once; multipart retries should not shift it across windows.
2. **Update analytics query** (`actions/ai-draft-response-analytics-actions.ts:62-78`)
   - Replace `d."updatedAt" >= ${from} and d."updatedAt" < ${to}` with a CTE:
     ```sql
     with draft_send_time as (
       select m."aiDraftId", min(m."sentAt") as "sentAt"
       from "Message" m
       where m.direction = 'outbound' and m."aiDraftId" is not null
       group by m."aiDraftId"
     )
     select
       d.channel, d."responseDisposition",
       count(distinct d.id)::int as "count"
     from "AIDraft" d
     join "Lead" l on l.id = d."leadId"
     join draft_send_time dst on dst."aiDraftId" = d.id
     left join "EmailCampaign" ec on ec.id = l."emailCampaignId"
     where l."clientId" in (...)
       and d."responseDisposition" is not null
       and dst."sentAt" >= ${from}
       and dst."sentAt" < ${to}
       and (d.channel != 'email' or ec."responseMode" = 'AI_AUTO_SEND')
     group by d.channel, d."responseDisposition"
     ```
   - Note: `JOIN` (not LEFT JOIN) on `draft_send_time` intentionally EXCLUDES drafts with no outbound messages. These drafts cannot be reliably time-anchored. Add a SQL comment explaining why.
   - Existing indexes used: `Message(aiDraftId)` (schema:938), `Message(sentAt DESC)` (schema:934).

   **Edge cases:**
   - Drafts with `responseDisposition IS NOT NULL` but no outbound `Message` → EXCLUDED (cannot determine send time)
   - Multipart SMS drafts with multiple outbound messages → `min(sentAt)` anchors to first part (correct: counts draft once in the window when first part was sent)
   - Draft updated after send (e.g., content refresh) → no longer shifts window (that's the fix)
3. **Performance check**
   - Ensure the query uses existing indexes: `Message(aiDraftId)`, `Message(sentAt)`, `AIDraft(responseDisposition)`.
   - If needed, add a Postgres partial index (only if this query becomes hot).
4. **Update any plan/docs references**
   - Phase 101c plan uses `updatedAt`; add an addendum note (no behavior change required there, but prevent future drift).

## Validation (RED TEAM)
- Run the updated query with `EXPLAIN ANALYZE` on a representative dataset (if accessible via Supabase MCP)
- Verify the query completes within the 10s statement_timeout
- If query time > 5s, consider adding composite index: `Message(aiDraftId, sentAt)`
- `npm run build` succeeds
- Manual spot-check: compare old vs new counts for a known time window to verify stability

## Exit Criteria
- `actions/ai-draft-response-analytics-actions.ts` no longer filters by `AIDraft.updatedAt`.
- Windowing is stable across subsequent draft updates (counts don’t “move” between time windows).
- Validation steps above pass.
- Next: proceed to Phase 110d (regression coverage + quality gates).

## Output
- Updated outcome analytics windowing to anchor counts to the draft’s first outbound `Message.sentAt` (CTE) instead of `AIDraft.updatedAt` (`actions/ai-draft-response-analytics-actions.ts`).
- Added a static regression test to ensure the query does not regress back to `updatedAt` filtering (`lib/__tests__/analytics-windowing-stable.test.ts`, `scripts/test-orchestrator.ts`).

## Handoff
Proceed to Phase 110d to run quality gates (`npm test`, `npm run lint`, `npm run build`) and write `docs/planning/phase-110/review.md`.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Replaced the drift-prone `AIDraft.updatedAt` window filter with a derived send-time anchor based on `min(Message.sentAt)` per draft.
  - Added a regression test that fails if the analytics action reintroduces `updatedAt` windowing.
- Commands run:
  - `nl -ba actions/ai-draft-response-analytics-actions.ts | sed -n '1,200p'` — pass (located query)
  - `rg -n \"d.\\\"updatedAt\\\"\" actions/ai-draft-response-analytics-actions.ts` — pass (removed from window filter)
- Blockers:
  - No `EXPLAIN ANALYZE` performed yet (deferred to Phase 110d or a Supabase-backed check if needed).
- Next concrete steps:
  - Execute Phase 110d: run `npm test`, `npm run lint`, `npm run build`, and capture results in `docs/planning/phase-110/review.md`.
