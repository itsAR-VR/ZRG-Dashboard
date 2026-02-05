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
2. **Update analytics query**
   - Replace `d."updatedAt"` window filter with a per-draft send timestamp derived from `Message.sentAt`.
   - Suggested SQL shape (CTE/subquery):
     - Derive per-draft `sentAt` via `min(m."sentAt")` where `m.direction='outbound'`.
     - Filter by that derived `sentAt` in the window.
     - Continue to group by `d.channel, d."responseDisposition"` and count `distinct d.id`.
   - Decide behavior for drafts with disposition but **no messages**:
     - Default: exclude (cannot confirm send-time; often corresponds to “uncertain send”).
     - If product wants them counted: add a fallback bucket or introduce a dedicated timestamp field (schema change).
3. **Performance check**
   - Ensure the query uses existing indexes: `Message(aiDraftId)`, `Message(sentAt)`, `AIDraft(responseDisposition)`.
   - If needed, add a Postgres partial index (only if this query becomes hot).
4. **Update any plan/docs references**
   - Phase 101c plan uses `updatedAt`; add an addendum note (no behavior change required there, but prevent future drift).

## Output
- `actions/ai-draft-response-analytics-actions.ts` no longer filters by `AIDraft.updatedAt`.
- Windowing is stable across subsequent draft updates (counts don’t “move” between time windows).

## Handoff
Proceed to Phase 110d to add regression coverage and run validation commands (tests/lint/build). If a schema change becomes necessary, include `npm run db:push` in the checklist.

