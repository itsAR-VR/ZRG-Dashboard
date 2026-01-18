# Phase 30c — UI: Add Draft Model/Reasoning Selection to Settings

## Focus

Add UI controls in Settings for selecting the email draft generation model + reasoning effort (workspace-wide, admin-gated).

## Inputs

- Phase 30a completed:
  - Schema has `draftGenerationModel` and `draftGenerationReasoningEffort` fields
  - `actions/settings-actions.ts` returns these fields via `getUserSettings()`
- Existing UI patterns:
  - `insightsChatSettings` state + admin lock UI in `components/dashboard/settings-view.tsx`
- Model options: `gpt-5.1`, `gpt-5.2`
- Reasoning levels: `low`, `medium`, `high`, `extra_high` (extra_high only for gpt-5.2)

## Work

### 1) Add state in `settings-view.tsx`

Add a new state block next to `insightsChatSettings`:
```ts
const [draftGenerationSettings, setDraftGenerationSettings] = useState({
  model: "gpt-5.1",
  reasoningEffort: "medium",
})
```

Initialize it in `loadSettings()` from `result.data`:
- `draftGenerationModel` → `draftGenerationSettings.model`
- `draftGenerationReasoningEffort` → `draftGenerationSettings.reasoningEffort`

### 2) Add UI card/section (admin-gated)

Add a new Settings card (recommended placement: near the existing “Insights Chatbot” card) using the same “Workspace-wide / Locked” pattern:

```tsx
<Select
  value={draftGenerationSettings.model}
  onValueChange={(v) => {
    const nextModel = v
    setDraftGenerationSettings((prev) => ({
      ...prev,
      model: nextModel,
      reasoningEffort:
        nextModel === "gpt-5.2"
          ? prev.reasoningEffort
          : prev.reasoningEffort === "extra_high"
            ? "high"
            : prev.reasoningEffort,
    }))
    handleChange()
  }}
  disabled={!isWorkspaceAdmin}
>
  …
</Select>
```

Reasoning effort select:
- Shows `extra_high` only when model is `gpt-5.2`
- Disabled when `!isWorkspaceAdmin`

### 3) Update save payload

In `handleSaveSettings()`, include the fields in the payload when admin (recommended):
```ts
if (isWorkspaceAdmin) {
  payload.draftGenerationModel = draftGenerationSettings.model
  payload.draftGenerationReasoningEffort = draftGenerationSettings.reasoningEffort
}
```

This matches the existing pattern used for Insights Chatbot settings.

## Output

**Completed:**

1. **State** (lines 167-171): Added `draftGenerationSettings` state with `model` and `reasoningEffort`

2. **State initialization** (lines 299-302): Populates from `getUserSettings()` response

3. **Save payload** (lines 606-608): Includes fields in save when `isWorkspaceAdmin`

4. **UI Card** (lines 2650-2751): "Email Draft Generation" card with:
   - Workspace-wide / Admin-gated badge (same pattern as Insights Chatbot)
   - Model select: GPT-5.1 (default), GPT-5.2
   - Reasoning effort select: Low, Medium (Recommended), High, Extra High (GPT-5.2 only)
   - Automatic downgrade from `extra_high` → `high` when switching from GPT-5.2 to GPT-5.1
   - Info box explaining two-step drafting pipeline

5. **Type check**: Passes with no errors

## Handoff

UI is ready. Phase 30d validates end-to-end: the settings are now readable by the draft generation pipeline (Phase 30b already wired), and webhook flows should show the two-step approach in AIInteraction logs.
