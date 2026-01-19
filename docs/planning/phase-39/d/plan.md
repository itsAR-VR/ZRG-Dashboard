# Phase 39d — Campaign Persona Assignment

## Focus

Add a persona selector column to the Campaign Assignment panel (in the Booking tab), allowing users to assign specific AI personas to campaigns. This follows the same pattern as booking process assignment.

## Inputs

- Persona list action from subphase 39b (`listAiPersonas`)
- Campaign assignment panel in `components/dashboard/settings/ai-campaign-assignment.tsx`
- `assignBookingProcessToCampaign` pattern to replicate for persona assignment

## Work

### 1. Add `assignPersonaToCampaign` action

In `actions/email-campaign-actions.ts`:

```typescript
export async function assignPersonaToCampaign(
  campaignId: string,
  personaId: string | null
): Promise<{
  success: boolean
  data?: { aiPersonaId: string | null; aiPersonaName: string | null }
  error?: string
}> {
  // 1. Verify user has admin access to campaign's workspace
  // 2. If personaId is not null, verify persona belongs to same workspace
  // 3. Update EmailCampaign.aiPersonaId
  // 4. Return updated values
}
```

### 2. Update `getEmailCampaigns` action

Add persona fields to the returned campaign data:
- `aiPersonaId: string | null`
- `aiPersonaName: string | null` (from joined AiPersona.name)

### 3. Update `CampaignRow` type in `ai-campaign-assignment.tsx`

```typescript
type CampaignRow = {
  id: string
  name: string
  bisonCampaignId: string
  leadCount: number
  responseMode: CampaignResponseMode
  autoSendConfidenceThreshold: number
  bookingProcessId: string | null
  bookingProcessName: string | null
  // Add:
  aiPersonaId: string | null
  aiPersonaName: string | null
}
```

### 4. Update `areEqual` function

Include persona comparison:
```typescript
a.aiPersonaId === b.aiPersonaId
```

### 5. Load personas on component mount

In `load()` callback:
```typescript
const [campaignsRes, bookingRes, personasRes] = await Promise.all([
  getEmailCampaigns(activeWorkspace),
  listBookingProcesses(activeWorkspace),
  listAiPersonas(activeWorkspace),  // Add this
])

if (personasRes.success && personasRes.data) {
  setPersonas(personasRes.data)
}
```

### 6. Add Persona column to table

After the Booking Process column, add:

```tsx
<TableHead>
  <div className="flex items-center gap-1.5">
    <Bot className="h-4 w-4" />
    <span>AI Persona</span>
  </div>
</TableHead>
```

And in the row:

```tsx
<TableCell className="min-w-[200px]">
  <Select
    value={row.aiPersonaId ?? "default"}
    onValueChange={(v) => {
      const personaId = v === "default" ? null : v
      const persona = personas.find((p) => p.id === personaId)
      updateRow(row.id, {
        aiPersonaId: personaId,
        aiPersonaName: persona?.name ?? null,
      })
    }}
  >
    <SelectTrigger>
      <SelectValue placeholder="Workspace Default">
        {row.aiPersonaName ?? "Workspace Default"}
      </SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="default">Workspace Default</SelectItem>
      {personas.map((p) => (
        <SelectItem key={p.id} value={p.id}>
          {p.name} {p.isDefault && "(Default)"}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
  <div className="text-xs text-muted-foreground mt-1">
    {row.aiPersonaId ? (
      <span>Uses "{row.aiPersonaName}" persona</span>
    ) : (
      <span>Uses workspace default persona</span>
    )}
  </div>
</TableCell>
```

### 7. Update `saveRow` to handle persona changes

```typescript
const personaChanged = row.aiPersonaId !== baseline.aiPersonaId

// ... after booking process save ...

if (personaChanged) {
  const res = await assignPersonaToCampaign(row.id, row.aiPersonaId)

  if (!res.success || !res.data) {
    toast.error(res.error || "Failed to assign persona")
    setSavingIds((prev) => ({ ...prev, [id]: false }))
    return
  }

  nextRow.aiPersonaId = res.data.aiPersonaId
  nextRow.aiPersonaName = res.data.aiPersonaName
}
```

### 8. Update header description

Add note about persona assignment:
> "Controls response mode, booking process, and AI persona for each EmailBison campaign."

## Output

**Completed 2026-01-19:**

- **`actions/email-campaign-actions.ts`**:
  - Added `aiPersonaId` and `aiPersonaName` to `EmailCampaignData` interface
  - Updated `getEmailCampaigns` to include `aiPersona` relation in Prisma query
  - Added `assignPersonaToCampaign` action with workspace validation

- **`components/dashboard/settings/ai-campaign-assignment.tsx`**:
  - Added imports for `listAiPersonas` and `assignPersonaToCampaign`
  - Extended `CampaignRow` type with `aiPersonaId` and `aiPersonaName`
  - Added `personas` state and loading in `load()` callback
  - Updated `areEqual` to compare persona assignment
  - Added "AI Persona" table header with User icon
  - Added persona selector cell with "Default (Workspace)" option + list of workspace personas
  - Updated `saveRow` to call `assignPersonaToCampaign` when persona changes

- `npm run lint` passes (warnings only)
- `npm run build` succeeds

## Handoff

Subphase 39e can now implement the AI draft integration that resolves the correct persona from campaign assignment. The resolution chain should be:

1. Check `EmailCampaign.aiPersonaId` (campaign-level assignment)
2. If null, check `getDefaultAiPersona(clientId)` for workspace default
3. If no personas exist, use `getOrCreateDefaultPersonaFromSettings` to migrate from WorkspaceSettings
