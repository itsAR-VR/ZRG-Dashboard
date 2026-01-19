# Phase 39e — AI Draft Integration

## Focus

Update the AI draft generation logic in `lib/ai-drafts.ts` to resolve and use the correct persona based on campaign assignment, with fallback to workspace default persona, then to `WorkspaceSettings` fields.

## Inputs

- `AiPersona` model from subphase 39a
- Persona resolution requirements from root plan
- Current persona field usage in `lib/ai-drafts.ts` (lines ~648-662)

## Work

### 1. Update Lead query to include persona data

In `generateResponseDraft`, the lead query already fetches `client.settings`. We need to also fetch:
- `emailCampaign.aiPersona` (campaign-assigned persona)
- `client.aiPersonas` where `isDefault: true` (workspace default persona)

Update the `prisma.lead.findUnique` include:

```typescript
include: {
  client: {
    include: {
      settings: true,
      // Add: fetch default persona
      aiPersonas: {
        where: { isDefault: true },
        take: 1,
      },
    },
  },
  // Add: fetch campaign with assigned persona
  emailCampaign: {
    include: {
      aiPersona: true,
      bookingProcess: {
        include: { stages: true },
      },
    },
  },
  // ... existing includes
}
```

### 2. Create persona resolution helper

```typescript
type ResolvedPersona = {
  personaName: string
  tone: string
  greeting: string
  smsGreeting: string
  signature: string | null
  goals: string | null
  serviceDescription: string | null
  idealCustomerProfile: string | null
  source: 'campaign' | 'default' | 'settings'
}

function resolvePersona(
  lead: LeadWithRelations,
  channel: 'sms' | 'email' | 'linkedin'
): ResolvedPersona {
  const settings = lead.client?.settings
  const campaignPersona = lead.emailCampaign?.aiPersona
  const defaultPersona = lead.client?.aiPersonas?.[0] // isDefault: true

  // Priority: campaign persona > default persona > settings
  const persona = campaignPersona ?? defaultPersona

  if (persona) {
    const defaultGreeting = "Hi {firstName},"
    return {
      personaName: persona.personaName || lead.client?.name || "Your Sales Rep",
      tone: persona.tone || "friendly-professional",
      greeting: channel === 'sms'
        ? (persona.smsGreeting?.trim() || persona.greeting?.trim() || defaultGreeting)
        : (persona.greeting?.trim() || defaultGreeting),
      smsGreeting: persona.smsGreeting?.trim() || persona.greeting?.trim() || defaultGreeting,
      signature: persona.signature?.trim() || null,
      goals: persona.goals?.trim() || null,
      serviceDescription: persona.serviceDescription?.trim() || null,
      idealCustomerProfile: persona.idealCustomerProfile?.trim() || null,
      source: campaignPersona ? 'campaign' : 'default',
    }
  }

  // Fallback to WorkspaceSettings (backward compatibility)
  const defaultGreeting = "Hi {firstName},"
  return {
    personaName: settings?.aiPersonaName || lead.client?.name || "Your Sales Rep",
    tone: settings?.aiTone || "friendly-professional",
    greeting: channel === 'sms'
      ? (settings?.aiSmsGreeting?.trim() || settings?.aiGreeting?.trim() || defaultGreeting)
      : (settings?.aiGreeting?.trim() || defaultGreeting),
    smsGreeting: settings?.aiSmsGreeting?.trim() || settings?.aiGreeting?.trim() || defaultGreeting,
    signature: settings?.aiSignature?.trim() || null,
    goals: settings?.aiGoals?.trim() || null,
    serviceDescription: settings?.serviceDescription?.trim() || null,
    idealCustomerProfile: settings?.idealCustomerProfile?.trim() || null,
    source: 'settings',
  }
}
```

### 3. Update `generateResponseDraft` to use resolved persona

Replace the current settings extraction (lines ~648-662):

```typescript
// Before:
const aiTone = settings?.aiTone || "friendly-professional"
const aiName = settings?.aiPersonaName || lead?.client?.name || "Your Sales Rep"
const aiGreeting = channel === "sms" ? ... : ...
const aiGoals = settings?.aiGoals?.trim()
const aiSignature = settings?.aiSignature?.trim()
const serviceDescription = settings?.serviceDescription?.trim()

// After:
const persona = resolvePersona(lead, channel)
const aiTone = persona.tone
const aiName = persona.personaName
const aiGreeting = persona.greeting
const aiGoals = persona.goals
const aiSignature = persona.signature
const serviceDescription = persona.serviceDescription
// Note: idealCustomerProfile is available in persona but not currently used in draft generation
```

### 4. Update all prompt builders to use resolved values

The existing prompt builders (`buildSmsPrompt`, `buildLinkedInPrompt`, `buildEmailPrompt`, `buildEmailDraftStrategyInstructions`, `buildEmailDraftGenerationInstructions`) already accept individual parameters like `aiTone`, `aiGoals`, etc.

No changes needed to prompt builders — they receive the resolved values from `generateResponseDraft`.

### 5. Add telemetry for persona source (optional)

In the `AIInteraction` record, consider adding the persona source for debugging:
- Could add to `promptKey` suffix: `"draft.sms:persona=campaign"` or `"draft.email:persona=default"`
- Or log to console for now

### 6. Test scenarios

1. **Campaign with assigned persona**: Draft should use campaign persona settings
2. **Campaign without persona (null)**: Draft should use workspace default persona
3. **No personas exist**: Draft should fall back to WorkspaceSettings values
4. **Persona deleted (campaign.aiPersonaId orphaned → null)**: Draft should fall back to default

### 7. Edge case: Persona deleted mid-conversation

If a campaign had a persona assigned, but that persona was deleted:
- Prisma `onDelete: SetNull` will set `EmailCampaign.aiPersonaId` to null
- On next draft generation, `lead.emailCampaign?.aiPersona` will be null
- Resolution will fall back to default persona or settings
- No action needed; the fallback chain handles this naturally

## Output

- `lib/ai-drafts.ts` updated with:
  - Extended lead query to include persona data
  - `resolvePersona` helper function
  - Updated `generateResponseDraft` to use resolved persona
- Draft generation correctly uses campaign-assigned persona with fallback chain

## Output

**Completed 2026-01-19:**

- **`lib/ai-drafts.ts`** updated with:
  - Added `ResolvedPersona`, `PersonaData`, and `LeadForPersona` types (lines 63-107)
  - Added `resolvePersona(lead, channel)` helper function (lines 109-154)
    - Priority chain: campaign persona → default persona → workspace settings
    - Channel-specific greeting resolution (SMS vs email)
    - Returns source for debugging ("campaign", "default", or "settings")
  - Extended lead query in `generateResponseDraft` to include:
    - `client.aiPersonas` with `where: { isDefault: true }` (workspace default)
    - `emailCampaign.aiPersona` (campaign-assigned persona)
  - Replaced inline settings extraction with `resolvePersona()` call
  - Added console log for persona source debugging

- All existing variables remain compatible:
  - `aiTone`, `aiName`, `aiGreeting`, `aiGoals`, `aiSignature`, `serviceDescription`
  - No changes needed to prompt builders or downstream logic

- `npm run lint` passes (warnings only)
- `npm run build` succeeds

## Validation

- [x] `npm run lint` passes
- [x] `npm run build` succeeds
- [ ] Manual test: create persona → assign to campaign → trigger draft → verify persona settings used
- [ ] Manual test: remove persona assignment → verify default persona or settings used

## Handoff

**Phase 39 complete.** All subphases delivered:
- **39a**: Schema - `AiPersona` model, campaign relation
- **39b**: Actions - CRUD + setDefault + backward-compat migration
- **39c**: Persona Manager UI - card-based list, create/edit modal, migration banner
- **39d**: Campaign Assignment UI - persona column in campaign panel
- **39e**: Draft Integration - persona resolution with fallback chain

The feature is ready for testing and deployment. Key test scenarios:
1. New workspace with no personas → uses WorkspaceSettings values
2. Workspace with default persona → all campaigns use default
3. Campaign with assigned persona → that campaign uses assigned persona
4. Persona deleted → affected campaigns fall back to default/settings
