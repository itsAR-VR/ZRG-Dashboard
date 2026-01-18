# Phase 29e — Backfill + Rollout Gating (Cached Insights Upgrade Path)

## Focus
Ensure Phase 29 actually takes effect in production by upgrading already-cached `LeadConversationInsight` rows (the pack worker/actions/cron currently skip extraction when an insight row exists).

## Problem
Today, for a given `leadId`:
- If `LeadConversationInsight` exists, extraction is skipped (context pack worker + server actions).
- The booked summaries cron only processes leads where `conversationInsight` is `null`.

If we ship a new insight schema (follow-up fields) without a backfill strategy, most leads will keep old insight JSON forever and Phase 29 will appear “not working”.

## Strategy (Recommended)
Use a **schema-version marker** inside the extracted JSON and recompute on mismatch.

### Step 1: Add `schema_version` to extracted JSON
- Extend the extraction output schema to include:
  - `schema_version: "v2_followup_weighting"` (string literal)
- Keep it stable for this phase; bump only when the JSON shape meaningfully changes.

### Step 2: Recompute rules
Update “skip if existing” logic in:
- `lib/insights-chat/context-pack-worker.ts`
- `actions/insights-chat-actions.ts`
- `app/api/cron/insights/booked-summaries/route.ts`

Rule:
- If no existing insight row → extract (current behavior).
- If existing insight exists:
  - If `insight.schema_version !== "v2_followup_weighting"` → re-extract and overwrite.
  - Else skip.

### Step 3: Cost control + safety
- Add an env gate:
  - `INSIGHTS_ALLOW_SCHEMA_UPGRADE_REEXTRACT=true|false` (default false in prod until approved)
- Add a hard cap per run (pack worker already batches; cron already has a limit).
- Log only lead IDs + counts (no transcript/body logging).

### Step 4: One-time backfill runner (optional but useful)
If we want to upgrade the backlog proactively:
- Add an admin-only route or cron endpoint that:
  - queries `LeadConversationInsight` rows where `insight.schema_version` is missing/old
  - processes in bounded batches with sleeps/retries
  - updates `computedAt`, `source` (e.g. `schema_upgrade`), and overwrites `insight`

## Output

**Changes in `lib/insights-chat/context-pack-worker.ts`:**
- Updated `findUnique` to select `insight` field (for schema version check)
- Added schema upgrade logic:
  - Checks `insight.schema_version !== "v2_followup_weighting"`
  - Only re-extracts if `INSIGHTS_ALLOW_SCHEMA_UPGRADE_REEXTRACT=true`
  - Without env flag, existing insights are reused (safe default)

**Changes in `actions/insights-chat-actions.ts`:**
- Same schema upgrade logic added to `runInsightContextPackStep()`

**Changes in `app/api/cron/insights/booked-summaries/route.ts`:**
- Default behavior unchanged (still computes insights only for booked leads with no cached insight).
- When `INSIGHTS_ALLOW_SCHEMA_UPGRADE_REEXTRACT=true`, also upgrades booked leads with cached insights on older schemas by re-extracting and overwriting.

**Environment variable:**
- `INSIGHTS_ALLOW_SCHEMA_UPGRADE_REEXTRACT=true` — enables re-extraction of old schema insights
- Default: `false` (disabled) — no cost impact until explicitly enabled

**Rollout strategy:**
1. Deploy with flag disabled → verify no regressions
2. Enable flag in dev/staging → verify follow-up fields appear in new insights
3. Enable in production → monitor OpenAI costs
4. Once satisfied, can optionally run a backfill script to re-extract all old insights

**Build verification:** `npm run build` passes.

## Handoff
Phase 29 fully complete. Monitor after deployment:
1. OpenAI cost dashboards for the first week with reextract enabled
2. Pack synthesis token usage (follow-up fields add ~20–30% more payload)
3. User feedback on whether insights answers foreground follow-up patterns
4. Verify `schema_version: "v2_followup_weighting"` appears in new LeadConversationInsight rows
