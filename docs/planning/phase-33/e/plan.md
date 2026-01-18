# Phase 33e — Hardening & Repo Reality Fixes (RED TEAM)

## Focus

Close the gaps surfaced in the RED TEAM review: make lead scoring reliable (enforceable structured output with `gpt-5-nano`), safe for serverless latency (run via background jobs), and wired into the real Inbox/CRM data paths.

## Inputs

- Root plan for Phase 33 (see Repo Reality Check + RED TEAM Findings)
- Existing AI patterns + helpers:
  - `lib/ai/prompt-registry.ts`
  - `lib/sentiment.ts` (strict `json_schema` output + `runResponseWithInteraction`)
- Email post-process execution path:
  - `lib/background-jobs/email-inbound-post-process.ts`
  - `app/api/cron/background-jobs/route.ts` (scheduled in `vercel.json`)
- Inbox/CRM data + UI touch points:
  - `actions/lead-actions.ts` (`getConversationsCursor`, `ConversationData`)
  - `components/dashboard/inbox-view.tsx`
  - `actions/crm-actions.ts`, `components/dashboard/crm-view.tsx`

## Work

1. **Make scoring output enforceable + stable**
   - Add a prompt template key like `lead_scoring.score.v1` in `lib/ai/prompt-registry.ts` with a stable `featureId`.
   - In `lib/lead-scoring.ts`, call OpenAI via `runResponseWithInteraction` using strict `json_schema` output with integer enums `{1,2,3,4}`.
   - Allow the model to output `overallScore` (still strictly validate 1-4).
   - If the model output is invalid/unparseable, do not write scores (leave null) and record telemetry.

2. **Prevent cost/timeout failures**
   - Add a strict timeout env var (e.g., `OPENAI_LEAD_SCORING_TIMEOUT_MS`) with a safe default.
   - Cap transcript size (reuse transcript building patterns from `lib/sentiment.ts` and apply truncation).
   - Use `gpt-5-nano` for scoring to keep costs down.
   - Re-score on every inbound message (no debounce); keep debounce as a future escape hatch only if costs spike.

3. **Handle disqualified leads deterministically**
   - If lead is Blacklist / opt-out (or last inbound is opt-out), do not call AI.
   - Set `overallScore=1` and update `scoredAt` (fit/intent can be `1` for consistency, but UI is overall-only).

4. **Wire scoring into the real execution paths**
   - Prefer a dedicated background job type for scoring across all channels (align with Phase 35’s webhook→job refactor).
   - Email: enqueue scoring from `lib/background-jobs/email-inbound-post-process.ts` (not in `app/api/webhooks/email/route.ts`) and ensure scoring failure does not fail the whole post-process job (wrap in try/catch).
   - SMS + LinkedIn: enqueue scoring from their inbound post-process job handlers (Phase 35), not inline webhooks.
   - Ensure lead scoring runs as its *own* job invocation (not embedded into a single “do everything” post-process) so timeouts/costs are isolated.

5. **Make filtering performant**
   - Add DB indexes needed for filtering/sorting by score (e.g., `@@index([clientId, overallScore, updatedAt(sort: Desc)])` and score-specific indexes as needed).
   - Ensure `scoreReasoning` is stored as `@db.Text` if it can exceed typical varchar limits.

6. **Ensure UI/data shapes actually expose scores**
   - Extend `ConversationData` in `actions/lead-actions.ts` to include score fields, and select them in Prisma queries.
   - Update `components/dashboard/inbox-view.tsx` mapping (replace placeholder `leadScore: 50`) to display `overallScore` via the new badge.
   - Add/extend score filters in the server query (cursor options), not only client-side filtering.

## Validation (RED TEAM)

- `npm run lint`
- `npm run build`
- Trigger at least one inbound message per channel (Email/SMS/LinkedIn) and verify:
  - Lead rows get `fitScore`, `intentScore`, `overallScore`, and `scoredAt`
  - Failures/timeouts do not break webhooks/background jobs
  - Inbox displays and filters by score

## Output

**Completed 2026-01-17:**

Most hardening work was implemented in subphases a-d. The remaining work for subphase e was:

1. **Score filtering UI:**
   - Added `SCORE_FILTER_OPTIONS` constant with filter options: All, 4 only, 3+, 2+, 1+, Unscored, Disqualified
   - Exported `ScoreFilter` type from `conversation-feed.tsx`
   - Added `activeScoreFilter` / `onScoreFilterChange` props to ConversationFeed
   - Added score filter Select dropdown in the filter section
   - Wired up state in `inbox-view.tsx` with `activeScoreFilter` state
   - Added `scoreFilter` to `baseQueryOptions` and comparison function
   - Filter resets when workspace changes
   - Filter clears with "Clear all filters" button

2. **Server-side filtering:**
   - Added `scoreFilter` to `ConversationsCursorOptions` interface (already done in d)
   - Added switch statement in `getConversationsCursor` to handle all filter cases
   - Filtering is server-side via Prisma `whereConditions` for performance

- Lead scoring is safe to run in production (timeouts, budgets, telemetry, correct integration points)
- UI and server actions expose scores for filtering/sorting

## Handoff

Phase 33 can proceed to a follow-on analytics phase (e.g., meeting outcome segmentation by lead score) once score fields are populated and stable.
