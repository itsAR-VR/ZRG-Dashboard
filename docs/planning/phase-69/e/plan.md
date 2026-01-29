# Phase 69e — Backfill Safety + Context Alignment (RED TEAM Addendum)

## Focus

Harden the backfill plan so draft generation + auto-send exactly mirrors the email inbound post-process safety gates, builds a correct `AutoSendContext`, and is resumable/idempotent with safe logging.

## Inputs

- `lib/background-jobs/email-inbound-post-process.ts` — reference implementation for transcript building + auto-send context
- `lib/auto-send/types.ts` — required `AutoSendContext` fields
- `lib/sentiment.ts` — `buildSentimentTranscriptFromMessages`, `shouldGenerateDraft`, `isOptOutText`, `detectBounce`
- `actions/message-actions.ts` — `regenerateAllDrafts` concurrency pattern (`REGENERATE_ALL_DRAFTS_CONCURRENCY`)
- `scripts/backfill-lead-scoring.ts` — resumable backfill + state file pattern
- `README.md` — `OPENAI_DRAFT_TIMEOUT_MS` defaults and env table

## Work

1. **Target snapshot + idempotency**
   - Query inbound messages tied to `EmailCampaign.responseMode = 'AI_AUTO_SEND'` and snapshot the message IDs at start.
   - Default behavior: **regenerate drafts for all** matching responses (not just missing drafts).
   - Add `--missing-only` and `--resume` flags; store cursor + counts in a state file (e.g., `.backfill-ai-auto-send.state.json`).

2. **Safety gates (match inbound email job)**
   - Build transcript via `buildSentimentTranscriptFromMessages(messagesAsc)` using the last ~80 messages.
   - Skip drafts when `shouldGenerateDraft` is false.
   - Hard skip when `isOptOutText(...)` or `detectBounce(...)` would flag the inbound content.

3. **Draft generation defaults**
   - In **missing-only** mode, call `generateResponseDraft(...)` with `triggerMessageId` set to the inbound message ID.
   - In **regenerate-all** mode (default), omit `triggerMessageId` to avoid unique-constraint collisions and force a fresh draft.
   - Do **not** override timeouts unless a flag is provided; rely on `OPENAI_DRAFT_TIMEOUT_MS`.
   - Concurrency defaults to safe low value; allow overrides via CLI or `REGENERATE_ALL_DRAFTS_CONCURRENCY`.

4. **Auto-send context alignment**
   - Populate all required `AutoSendContext` fields using the same values as `lib/background-jobs/email-inbound-post-process.ts` (subject, latestInbound, messageSentAt, etc.).
   - Use `validateImmediateSend: true`; expose `--include-draft-preview-in-slack` flag to match current job defaults.
   - Respect `AUTO_SEND_DISABLED` by default; require explicit override to send when disabled.
   - Bypass campaign delay settings so backfill sends immediately.

5. **Rate limiting + pacing**
   - Add optional `--sleep-ms` between auto-send attempts to avoid Slack/OpenAI rate limits.
   - Log per-draft Slack DM status (sent/skipped/error).

6. **Logging + full identifiers**
   - Log summaries + identifiers; include full lead names + emails (per requirement).
   - Avoid full message bodies unless required for debugging.
   - Ensure log files are under `scripts/logs/` and `.gitignore` excludes `*.log`.

## Output

- Implemented safety gates + context alignment in `scripts/backfill-ai-auto-send.ts`.
- CLI flags added: `--missing-only`, `--resume`, `--sleep-ms`, `--force-auto-send`, `--no-draft-preview`.
- Logging includes lead names + emails; `.gitignore` excludes log files and state file.

## Handoff

After this addendum is implemented, complete Phase 69 wrap-up in the root plan once dry-run/apply steps are executed.
