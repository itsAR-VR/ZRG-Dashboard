# Phase 70f — Backfill + Slack Review Flow Hardening

## Focus

Make Phase 70 usable on existing data and close the “review loop” reliability gaps:

- backfill persisted auto-send fields for historical drafts/messages (so filters/counts work retroactively)
- make Slack “needs_review” messages safe + actionable (deep-link to the exact draft; approve/send without double-sends)
- investigate “skips” vs “errors” from backfill runs and ensure the remaining outcomes are expected + debuggable

## Inputs

- Phase 70a–70e outputs (schema + orchestrator persistence + filters + ActionStation UI)
- `prisma/schema.prisma` (AIDraft auto-send fields, slack notification metadata fields)
- `lib/auto-send/orchestrator.ts` (Slack DM block composition; outcome persistence calls)
- `lib/auto-send/record-auto-send-decision.ts` (no-downgrade persistence behavior)
- `actions/message-actions.ts` (`approveAndSendDraftSystem` behavior and any Next.js cache revalidation)
- Existing backfill entrypoint (Phase 69): `scripts/backfill-ai-auto-send.ts`
- Phase 70 backfill: `scripts/backfill-ai-auto-send-evaluation-fields.ts`
- Slack messaging utilities: `lib/slack-dm.ts`
- (If implementing interactive approvals) Slack interactions route: `app/api/webhooks/slack/interactions/route.ts`
- Dashboard draft UX: `components/dashboard/action-station.tsx`

## Work

### 1) Backfill the new auto-send fields (historical coverage)

- Confirm the definition:
  - **AI Sent** = there exists an outbound `Message` with `sentBy='ai'` and `source='zrg'` tied to an `AIDraft` that was in AI_AUTO_SEND.
- Backfill strategy (idempotent):
  - For drafts that already have an AI-sent outbound message:
    - set `autoSendAction` to `send_immediate` (or `send_delayed` only if there is a reliable “delayed send job exists” signal)
    - set `autoSendEvaluatedAt` if missing (use message timestamp or “now” if unknown)
    - leave `autoSendConfidence/Reason` null unless we can safely infer them
  - For drafts that are `status='pending'` in AI_AUTO_SEND:
    - run the evaluator to populate `autoSendConfidence/Threshold/Reason`
    - set `autoSendAction='needs_review'` when below threshold / unsafe, otherwise leave to normal orchestrator path (don’t send from this script unless explicitly intended)
- Ensure logs are written to `scripts/logs/` and do not include full message bodies.
- Add/confirm DRY_RUN vs APPLY modes.

### 2) Triage “skips” vs “errors” from backfill runs

- Produce a small “top reasons” breakdown from the log file(s):
  - `skip:*` reasons that are expected safety gates (e.g. newer inbound exists, already booked, outbound-after-trigger)
  - `error:*` reasons that indicate real bugs/regressions
- For any errors caused by calling Next.js cache APIs from scripts (e.g. `revalidatePath(...)` invariant):
  - refactor to call a lower-level “send draft” function that does not require a Next request context
  - keep `approveAndSendDraftSystem()` for UI/server-action usage only

### 3) Slack review message hardening (deep-links + interactive approval)

- Deep-link correctness:
  - Include `draftId` in the Slack “View in Dashboard” URL (not just `leadId`) to avoid mismatches when multiple drafts exist.
  - Update ActionStation to prefer the draft referenced by `draftId` when present.
- Interactive approval (if shipping):
  - Implement `POST /api/webhooks/slack/interactions` with:
    - Slack signature verification (`SLACK_SIGNING_SECRET`)
    - action handler for `approve_send` that:
      - is idempotent (if already sent/approved, return success and update the Slack message)
      - sends the draft and records the action (ideally `autoSendAction='send_immediate'` and a Message row with `sentBy='ai'`)
    - update the Slack message (disable buttons; show status) using `chat.update`
    - respond fast enough to avoid Slack retries/timeouts (Slack expects a quick 200; longer work may need a background job + message update via `chat.update` or `response_url`)
  - Ensure buttons cannot be abused (at minimum: signature verify; optionally restrict to Jon’s Slack user id/email).

## Output

- Historical AIDrafts have consistent `autoSendAction` values where provable, enabling `ai_sent`/`ai_review` filters retroactively.
- Backfill log output is actionable: expected skips are distinguished from real errors.
- Slack review messages deep-link to the exact draft, and approvals are safe + idempotent (if implemented).

## Handoff

- If Slack approval UX needs broader product decisions (who can approve, “sentBy” attribution, audit trails), spin a follow-up planning phase focused on review workflow + permissions.
