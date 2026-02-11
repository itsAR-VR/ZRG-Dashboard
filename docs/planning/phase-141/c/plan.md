# Phase 141c — Runtime Checks in ai-drafts.ts

## Focus

Add 3 conditional checks in `lib/ai-drafts.ts` that read the workspace settings and skip the corresponding AI route when disabled.

## Inputs

- Phase 141a schema fields available via `settings` object
- `lib/ai-drafts.ts` — `generateResponseDraft()` function
  - `settings` loaded at line 1521: `const settings = lead?.client?.settings;`
  - Step 3 block at lines 2938-2983
  - Meeting Overseer block at lines 2985-3100

## Work

1. **Draft generation gate** — after line 1521:
   ```typescript
   if (!(settings?.draftGenerationEnabled ?? true)) {
     console.log("[AI Drafts] Draft generation disabled for workspace", lead.clientId);
     return { success: true, draftId: null, content: null, runId: null };
   }
   ```
   This covers ALL callers (pipeline, SMS, LinkedIn, email background jobs).

2. **Step 3 verification gate** — change line 2938 condition:
   ```typescript
   if (channel === "email" && draftContent && (settings?.draftVerificationStep3Enabled ?? true)) {
   ```

3. **Meeting Overseer gate** — change line 2985 condition:
   ```typescript
   if (draftContent && triggerMessageId && (settings?.meetingOverseerEnabled ?? true)) {
   ```

4. Run `npm run lint` and `npm run build`.

## Output

- 3 runtime gates active
- Each defaults to enabled (`?? true`) when settings are null
- Deterministic post-processing (Step 4) always runs regardless of toggles

## Handoff

Phase 141 complete. Verify all success criteria from root plan.
