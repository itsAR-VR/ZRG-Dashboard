# Phase 107c — Prompt Dashboard: Verify Editability + Runtime Fidelity

## Focus
Ensure Settings → AI Personality → View Prompts is (a) clearly editable where intended and (b) accurately reflects runtime usage for the Jam’s “Auto-Send Evaluator” and related prompts.

## Inputs
- Jam segment: Settings → AI Personality → View Prompts → expand “Auto-Send Evaluator”.
- Prompt override system (Phase 47):
  - Prisma models: `PromptOverride`, `PromptSnippetOverride`
  - Registry: `lib/ai/prompt-registry.ts` (`getPromptWithOverrides`)
  - UI: `components/dashboard/settings-view.tsx` (prompt modal + override editing)
  - Actions: `actions/ai-observability-actions.ts` (save/reset overrides)

## Work (RED TEAM Refined)

### Step 1: Verify editability (no code changes)
- [ ] Open Settings → AI Personality → View Prompts → expand "Auto-Send Evaluator"
- [ ] Confirm prompt content is editable
- [ ] Make a test edit and save
- [ ] Verify `PromptOverride` record created in database
- [ ] Re-open modal and confirm saved override is displayed

### Step 2: Verify runtime fidelity
- [ ] Confirm `evaluateAutoSend()` uses `runStructuredJsonPrompt()` which applies overrides via `getPromptWithOverrides("auto_send.evaluate.v1")`
- [ ] Prompt key stays `v1` per Phase 107b decision (no UI naming change needed)
- [ ] Test: edit prompt to add obvious text → trigger evaluator → confirm telemetry shows edited prompt was used

### Step 3: Add runtime context preview example (USER CHOICE)
Add UI element to the prompt modal showing a preview of injected context:

```tsx
<Alert className="mt-4">
  <InfoIcon className="h-4 w-4" />
  <AlertTitle>Runtime Context Preview</AlertTitle>
  <AlertDescription className="text-sm text-muted-foreground">
    <p className="mb-2">
      The evaluator also receives dynamic context from your workspace settings:
    </p>
    <pre className="bg-muted p-2 rounded text-xs overflow-x-auto">
{`• service_description: "[Your AI Personality service description]"
• goals: "[Your AI Personality goals]"
• knowledge_context: "[Asset Name]: [First 1000 chars]..."`}
    </pre>
    <p className="mt-2">
      This context helps the evaluator verify pricing and service claims.
    </p>
  </AlertDescription>
</Alert>
```

Location: `components/dashboard/settings-view.tsx` in the prompt modal component, below the prompt editor.

### Step 4: Guardrails verification
- [ ] Confirm `savePromptOverride()` uses `requireClientAdminAccess()` pattern (already verified ✅)
- [ ] Confirm prompt modal only shows for admin users
- [ ] Confirm strict-output prompts are labeled (JSON schema indicator)

## Validation (RED TEAM)
- [ ] Edit prompt → save → re-open → shows saved content
- [ ] Edit prompt → trigger evaluator → new behavior reflects edit (check telemetry or behavior)
- [ ] Reset prompt → trigger evaluator → original behavior restored
- [ ] Runtime context preview example is visible in the prompt modal
- [ ] Preview shows correct field names: `service_description`, `goals`, `knowledge_context`

## Output
- Added a runtime context preview block under the Auto-Send Evaluator prompt in the “Backend Prompts” modal:
  - `components/dashboard/settings-view.tsx`
  - Shows `service_description`, `goals`, and Knowledge Assets summary with ≈token/byte estimates.
- (Pending validation) Confirm prompt overrides are editable + used by runtime evaluator in a real workspace.

## Handoff
- Prompt key → runtime path mapping:
  - `auto_send.evaluate.v1` → `lib/auto-send-evaluator.ts:evaluateAutoSend()` → `runStructuredJsonPrompt()` → `getPromptWithOverrides()`
- UI notes: runtime context preview explains dynamic injection; users can edit system prompt but not runtime-composed fields.

## Progress This Turn (Terminus Maximus)
- Work done:
  - Implemented runtime context preview in the prompt modal for `auto_send.evaluate.v1`.
- Commands run:
  - (pending) `npm run lint` / `npm run build` — run during Phase 107d validation.
- Blockers:
  - Cannot confirm “edit prompt → changes runtime behavior” without an environment that can trigger evaluator runs.
- Next concrete steps:
  - Run tests/lint/build.
  - In a real workspace, edit the system prompt and trigger an evaluator run to confirm override application.
