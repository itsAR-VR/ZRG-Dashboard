# Phase 109c — Backend Hardening: Meeting Overseer Non-Fatal

## Focus
Ensure auxiliary gating logic cannot prevent draft creation via uncaught exceptions. Specifically, make the meeting-overseer gate best-effort so `generateResponseDraft` still persists a draft even if overseer fails.

## Inputs
- Current call site in `lib/ai-drafts.ts`:
  - `shouldRunMeetingOverseer(...)` → `runMeetingOverseerGate(...)` (lines 2545-2576)
  - Wrapped in `try/catch` to ensure non-fatal behavior
- Meeting overseer implementation: `lib/meeting-overseer.ts`.

## Work
1. Wrap the meeting overseer block in `generateResponseDraft` (lines 2545-2576) with `try/catch`:
   ```typescript
   try {
     const shouldGate = shouldRunMeetingOverseer({ ... });
     if (shouldGate) {
       // ... existing gate logic ...
       if (gateDraft) {
         draftContent = gateDraft;
       }
     }
   } catch (overseerError) {
     console.warn("[AI Drafts] Meeting overseer failed; continuing with pre-gate draft", {
       leadId,
       triggerMessageId,
       channel,
       errorType: overseerError instanceof Error ? overseerError.name : 'unknown',
       errorMessage: overseerError instanceof Error ? overseerError.message : String(overseerError),
     });
     // Continue with pre-overseer draftContent
   }
   ```
2. **Log at WARN level** (not error) to avoid noise in error aggregation, but include sufficient context for debugging:
   - `leadId`
   - `triggerMessageId`
   - `channel`
   - `errorType` (for categorization)
   - `errorMessage` (truncated if needed)
3. Keep semantics:
   - Do not change when overseer runs.
   - Do not change acceptance/booking logic.
   - Only prevent overseer errors from aborting draft generation.

## Validation (RED TEAM)
- [ ] Unit test: mock `runMeetingOverseerGate` to throw → verify draft is still created with pre-gate content
- [ ] Unit test: verify warning is logged with expected fields
- [ ] Manual test: trigger overseer timeout → verify draft creation succeeds

## Output
- Draft creation is resilient: overseer is best-effort, not a hard dependency.
- Code changes: `lib/ai-drafts.ts` (meeting overseer block wrapped; warnings include leadId + triggerMessageId + channel)

## Handoff
Proceed to Phase 109d to fix `/api/webhooks/email` null-byte ingestion failures.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Wrapped meeting overseer gate inside `generateResponseDraft` with `try/catch`, logging a warning and continuing with the pre-gate draft.
- Commands run:
  - `npm test` — pass
  - `npm run build` — pass
- Blockers:
  - Unit test coverage for the overseer-throw path is still TODO; would require mocking `runMeetingOverseerGate`/DB calls.
- Next concrete steps:
  - Strip null bytes in email cleaning + sanitize webhook strings (109d).
