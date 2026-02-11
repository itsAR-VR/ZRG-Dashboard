# Phase 141b — Settings UI Switches

## Focus

Add 3 Switch toggles to the Settings UI in the Email Draft Generation section.

## Inputs

- Phase 141a server action fields (load + save wired)
- `components/dashboard/settings-view.tsx` — existing Switch pattern, `handleChange()`, admin gating

## Work

1. Add state for the 3 toggles:
   ```typescript
   const [aiPipelineToggles, setAiPipelineToggles] = useState({
     draftGenerationEnabled: true,
     draftVerificationStep3Enabled: true,
     meetingOverseerEnabled: true,
   })
   ```

2. Load values from `getUserSettings()` response in the existing `useEffect`.

3. Include in the save payload in `handleSave`.

4. Add 3 Switch components in the Email Draft Generation section using the existing pattern:
   - **AI Draft Generation** — "Generate AI response drafts for inbound messages. When off, no AI drafts are created."
   - **Draft Verification (Step 3)** — "Run a verification pass on AI drafts to catch errors. When off, drafts go straight to safety post-processing."
   - **Meeting Overseer** — "AI scheduling coherence check on drafts. When off, drafts skip the scheduling gate."

5. Each switch: `disabled={!isWorkspaceAdmin}`, proper `aria-labelledby`, calls `handleChange()`.

## Output

- 3 switches visible and functional in Settings UI
- Values persist on save

## Handoff

Phase 141c adds the runtime checks in `lib/ai-drafts.ts` that read these settings.
