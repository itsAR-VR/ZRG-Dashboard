# Phase 141c — Runtime Checks in ai-drafts.ts

## Focus

Add conditional checks in `lib/ai-drafts.ts` that read workspace settings and skip corresponding AI routes when disabled, while preserving idempotent existing-draft behavior.

## Inputs

- Phase 141a schema fields available via `settings` object
- `lib/ai-drafts.ts` — `generateResponseDraft()` function
  - `settings` assignment around `const settings = lead?.client?.settings;`
  - Step 3 verifier block (email path)
  - Meeting Overseer gate block (draft path)
  - Existing-draft idempotency block (`triggerMessageId` lookup path)

## Work

1. **Draft generation gate** — after settings load and after existing-draft idempotency lookup:
   ```typescript
   if (!(settings?.draftGenerationEnabled ?? true)) {
     console.log("[AI Drafts] Draft generation disabled for workspace", lead.clientId);
     return { success: true, draftId: null, content: null, runId: null };
   }
   ```
   Keep idempotent return behavior for existing drafts keyed by `triggerMessageId`.

2. **Step 3 verification gate** — conditionally run Step 3 only when enabled:
   ```typescript
   if (channel === "email" && draftContent && (settings?.draftVerificationStep3Enabled ?? true)) {
   ```
   When disabled, log/persist explicit skip reason for observability.

3. **Meeting Overseer gate (draft path)** — conditionally run only when enabled:
   ```typescript
   if (draftContent && triggerMessageId && (settings?.meetingOverseerEnabled ?? true)) {
   ```
   When disabled, log/persist explicit skip reason.

4. Add/update structured skip artifacts/metadata for disabled routes:
   - `draft_generation`
   - `draft_verification_step3`
   - `meeting_overseer_draft_path`

5. Run `npm run lint` and `npm run build`.

## Output

- ai-drafts runtime gates active with structured skip visibility
- Each defaults to enabled (`?? true`) when settings are null
- Existing-draft idempotent return behavior preserved when generation is disabled
- Deterministic post-processing still runs for drafts that are produced

## Handoff

Phase 141d extends `meetingOverseerEnabled` to follow-up engine overseer paths and wires manual toasts + admin settings visibility.
