# Phase 46c — Booking-Context Fidelity in AI Drafts (Create/Regenerate + Setter Workflows)

## Focus
Ensure that whenever a setter creates or regenerates a draft, the model receives consistent “booking process” context (stage/wave rules, booking link behavior, suggested times, qualifying questions, timezone ask), and that the transcript/context passed into draft generation is complete enough for high-quality outputs.

## Inputs
- Booking process semantics and implementation:
  - `lib/booking-process-instructions.ts`
  - `lib/booking-progress.ts`
  - `lib/ai-drafts.ts:generateResponseDraft(...)`
- Setter-facing draft flows:
  - `actions/message-actions.ts:getPendingDrafts`, `regenerateDraft`, `approveAndSendDraft`
  - UI: `components/dashboard/action-station.tsx` (draft fetch + regenerate/approve/send)

## Work
1) Validate booking instructions are always present when expected:
   - Confirm lead has `emailCampaignId` and the campaign has a booking process (or progress “freeze” is set) → instructions should be injected.
   - Confirm `availableSlots` is populated only when scheduling should be considered; ensure the same availability is passed into booking instructions builder.
2) Improve regeneration transcript quality (if needed):
   - Align `actions/message-actions.ts:regenerateDraft(...)` transcript construction with the rest of the system:
     - use `buildSentimentTranscriptFromMessages(...)` style formatting (timestamps, channel cues)
     - increase context window beyond last 10 messages where safe (match other draft generation paths that use up to ~80)
     - for email, include `subject` lines and prefer cleaned text over raw HTML where possible
3) Ensure “setter manage” flows reuse the same generator:
   - Identify any alternate draft generator(s) outside `generateResponseDraft(...)` used by setter tooling and route them through the same booking-aware draft pipeline.
4) Add a small deterministic verification fixture:
   - Given a lead with a booking process stage that includes booking link + questions, confirm generated draft prompt includes those booking instructions (no placeholders, correct link behavior).

## Output
- A consistent contract for “draft generation inputs” across create/regenerate pathways (same booking context, adequate transcript).

## Handoff
Proceed to **46d** to add guardrails/observability that make it obvious in the UI/logs which system produced an outbound message and why.

## Output (Filled)
### Regeneration now uses the same transcript format + window as other draft paths

- Updated `actions/message-actions.ts:regenerateDraft(...)` (setter ActionStation regenerate):
  - builds transcript via `buildSentimentTranscriptFromMessages(...)` (timestamps + channel cues + email subjects)
  - pulls the most recent ~80 messages (by `sentAt desc`, then reversed) instead of the (buggy) first 10 oldest messages
  - gates email drafts with `shouldGenerateDraft(sentimentTag, lead.email)` so bounce addresses never get drafts
- Updated bulk regeneration helper `actions/message-actions.ts:regenerateDraftSystem(...)` to use the same transcript builder + recent-message window.

### Booking process context remains centralized in `generateResponseDraft(...)`
- Confirmed `lib/ai-drafts.ts:generateResponseDraft(...)` always calls `getBookingProcessInstructions({ leadId, channel, workspaceSettings, clientId, availableSlots })`.
- By routing regenerate flows through `generateResponseDraft(...)` with a consistent transcript, setters get the same booking-process stage/wave rules (link behavior, suggested times, questions, timezone ask) as automated draft generation.

## Handoff (Filled)
Proceed to **46d** to make outbound message attribution clearer in the UI (`actions/lead-actions.ts` sender/source mapping) so any remaining “double” perceptions are diagnosable quickly.
