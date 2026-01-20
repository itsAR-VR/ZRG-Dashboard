# Phase 46d — Guardrails + Observability (Reduce Operator Confusion)

## Focus
Make “who/what sent this message?” and “why did we send this?” obvious, so future issues don’t look like mysterious double-sends.

## Inputs
- Current message rendering model: `actions/lead-actions.ts` maps all outbound messages to `sender: "ai"`.
- Message metadata available in DB:
  - `Message.source` (`zrg` vs `inboxxia_campaign`)
  - `Message.sentBy` (`ai` vs `setter`)
  - `Message.sentByUserId`
  - `Message.aiDraftId`

## Work
1) Update server-to-UI message mapping to preserve sender/source attribution:
   - Derive a UI-safe `sender` that distinguishes at least:
     - inbound lead (`direction="inbound"`)
     - outbound setter/manual (`sentBy="setter"`)
     - outbound AI/automation (`sentBy="ai"`)
     - outbound campaign (`source="inboxxia_campaign"`)
2) Add light logging/telemetry at the send boundaries:
   - When sending EmailBison replies, log whether we successfully captured/persisted `emailBisonReplyId`.
   - When sync “heals” vs “inserts” outbound replies, log a compact signal to detect regressions.
3) Add an admin-only debug view (optional if cheap):
   - Surface the raw `source/sentBy/aiDraftId` metadata in the UI for quick diagnosis.

## Output
- Clear attribution in UI and logs that reduces the chance operators interpret data duplication as double sending.

## Handoff
Proceed to **46e** for verification and rollout steps focused on Founders Club.

## Output (Filled)
### UI attribution: distinguish human vs AI outbound

- Updated `actions/lead-actions.ts:getConversation(...)` message mapping so outbound messages are no longer always `sender: "ai"`:
  - inbound → `sender: "lead"`
  - outbound with `sentBy="setter"` or `sentByUserId` → `sender: "human"`
  - outbound campaigns (`source="inboxxia_campaign"`) and other automation → `sender: "ai"`
- Updated `components/dashboard/chat-message.tsx` to render AI outbound messages differently:
  - AI messages show a Bot icon + “AI” label and a distinct bubble style
  - human messages keep the existing “You” label + avatar behavior

### Logging/observability
- `lib/conversation-sync.ts` now logs a compact signal when an outbound EmailBison reply is healed onto an existing message row (vs inserted), making future regressions diagnosable from Vercel logs without exposing message bodies.

## Handoff (Filled)
Proceed to **46e** to run lint/build and validate in FC that (1) outbound EmailBison sends no longer create duplicate `Message` rows after sync and (2) regenerated drafts still include booking-process instructions end-to-end.
