# Phase 93d — Settings UI (Trigger + Persona + Note)

## Focus
Allow admins to configure persona-routed workflows in the UI:
* Select trigger: “On first manual email reply” (`triggerOn = "setter_reply"`)
* Optionally bind a follow-up sequence to an AI persona (`FollowUpSequence.aiPersonaId`)
* Add a clear explanatory note about persona-sourced `{senderName}` and `{signature}` tokens (per user request)

## Inputs
* Phase 93a: sequence can persist `aiPersonaId`
* Phase 93b: tokens `{senderName}` + `{signature}` are persona-resolved
* Existing UI: `components/dashboard/followup-sequence-manager.tsx`
* Persona list API: `actions/ai-persona-actions.ts` (`listAiPersonas`)

## Work

### 1. Add trigger option

In `followup-sequence-manager.tsx:96-100`, add 4th option:

```typescript
const TRIGGER_OPTIONS = [
  { value: "no_response", label: "No response (after 24h)" },
  { value: "meeting_selected", label: "After meeting selected" },
  { value: "setter_reply", label: "On first manual email reply" },  // NEW
  { value: "manual", label: "Manual trigger only" },
];
```

### 2. Add persona selector UI

After the Trigger dropdown in the sequence form, add:

```tsx
<div className="space-y-2">
  <Label>AI Persona (optional)</Label>
  <Select
    value={formData.aiPersonaId ?? "any"}
    onValueChange={(v) => setFormData({
      ...formData,
      aiPersonaId: v === "any" ? null : v
    })}
  >
    <SelectTrigger>
      <SelectValue placeholder="Any (uses campaign/default)" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="any">Any (uses campaign/default)</SelectItem>
      {personas.map(p => (
        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

Capability gating: Only show for roles that can edit settings (respect existing capability checks).

### 3. Fetch personas on mount

Add alongside existing `loadWorkspaceContext()`:

```typescript
const [personas, setPersonas] = useState<AiPersona[]>([]);

const loadPersonas = useCallback(async () => {
  if (!clientId) return;
  const result = await listAiPersonas(clientId);
  if (result.success && result.data) {
    setPersonas(result.data);
  }
}, [clientId]);

useEffect(() => {
  loadPersonas();
}, [loadPersonas]);
```

### 4. Update form state

Add `aiPersonaId` to form data:

```typescript
const [formData, setFormData] = useState({
  name: "",
  description: "",
  triggerOn: "no_response" as "no_response" | "meeting_selected" | "setter_reply" | "manual",
  aiPersonaId: null as string | null,  // NEW
  steps: [] as Omit<FollowUpStepData, "id">[],
});
```

Include in `handleSaveSequence` payload.

### 5. Add explanatory note

After the persona selector:

```tsx
<p className="text-xs text-muted-foreground">
  When a persona is selected, this workflow activates only for leads
  in campaigns assigned to that persona. The tokens {"{senderName}"} and
  {"{signature}"} will use the persona's values (or fall back to
  campaign/workspace defaults if not set).
</p>
```

### 6. Validation feedback

On save/activate, if template uses `{signature}` but applicable persona has no signature configured, show warning:

```tsx
{formError && formError.includes("signature") && (
  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700">
    This template uses {"{signature}"} but the selected persona has no signature configured.
    Follow-ups will be blocked until a signature is added.
  </div>
)}
```

## Validation (RED TEAM)

- [ ] 4th trigger option added: `{ value: "setter_reply", label: "On first manual email reply" }`
- [ ] Persona selector dropdown shows all workspace personas + "Any" option
- [ ] Form state includes `aiPersonaId`
- [ ] Save payload includes `aiPersonaId`
- [ ] Explanatory note displayed after persona selector
- [ ] Role capabilities respected (admin-only editing)

## Output
* Added trigger option `"setter_reply"` in the follow-up sequence UI.
* Added AI Persona selector (auto vs specific persona) and wired it into create/update payloads.
* Persona list loads via `listAiPersonas` with on-demand `getAiPersona` for signature validation.
* Added UI note clarifying `{senderName}` / `{signature}` persona resolution and pause behavior.
* Server-side activation checks now validate `{signature}` using persona + workspace fallbacks.

## Handoff
Phase 93e will run tests/build and produce a Founders Club verification runbook for Chris + Aaron routing.

## Coordination Notes

**Unrelated working tree changes detected:** `lib/availability-cache.ts`, `scripts/backfill-ai-auto-send.ts`, `lib/draft-availability-refresh.ts` (left untouched).
