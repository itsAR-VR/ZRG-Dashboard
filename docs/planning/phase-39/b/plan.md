# Phase 39b — Persona CRUD Actions

## Focus

Implement server actions for creating, reading, updating, deleting, and listing AI personas. Also implement setting a persona as the workspace default.

## Inputs

- `AiPersona` Prisma model from subphase 39a
- Existing action patterns from `actions/booking-process-actions.ts`
- `requireClientAdminAccess` pattern for permission checking

## Work

### 1. Create `actions/ai-persona-actions.ts`

```typescript
"use server"

// Types
export type AiPersonaData = {
  id: string
  name: string
  isDefault: boolean
  personaName: string | null
  tone: string
  greeting: string | null
  smsGreeting: string | null
  signature: string | null
  goals: string | null
  serviceDescription: string | null
  idealCustomerProfile: string | null
  createdAt: Date
  updatedAt: Date
}

export type AiPersonaSummary = {
  id: string
  name: string
  isDefault: boolean
  personaName: string | null
  tone: string
}

export type CreateAiPersonaInput = {
  name: string
  personaName?: string | null
  tone?: string
  greeting?: string | null
  smsGreeting?: string | null
  signature?: string | null
  goals?: string | null
  serviceDescription?: string | null
  idealCustomerProfile?: string | null
  isDefault?: boolean
}

export type UpdateAiPersonaInput = Partial<CreateAiPersonaInput>
```

### 2. Implement actions

#### `listAiPersonas(clientId: string)`
- Verify user has access to workspace
- Return all personas for workspace, ordered by `isDefault desc, name asc`
- Return `AiPersonaSummary[]`

#### `getAiPersona(personaId: string)`
- Verify user has access to persona's workspace
- Return full `AiPersonaData` or null

#### `createAiPersona(clientId: string, input: CreateAiPersonaInput)`
- Require admin access
- Validate name uniqueness within workspace
- If `isDefault: true`, unset any existing default first (transaction)
- Create persona
- Return created `AiPersonaData`

#### `updateAiPersona(personaId: string, input: UpdateAiPersonaInput)`
- Require admin access
- If `isDefault: true` and not already default, unset any existing default first (transaction)
- Update persona
- Return updated `AiPersonaData`

#### `deleteAiPersona(personaId: string)`
- Require admin access
- Check if persona is the only one (prevent deleting last persona? Or allow?)
- Assumption: allow deletion; campaigns will fall back to default
- If deleting the default persona, promote another persona to default (oldest first)
- Delete persona (campaigns with this persona will have `aiPersonaId` set to null via `onDelete: SetNull`)
- Return `{ success: true }`

#### `setDefaultAiPersona(personaId: string)`
- Require admin access
- Unset existing default in transaction
- Set this persona as default
- Return updated `AiPersonaData`

#### `getDefaultAiPersona(clientId: string)`
- Return the default persona for workspace, or null if none exists
- Used for fallback resolution

### 3. Helper: `getOrCreateDefaultPersonaFromSettings(clientId: string)`

For backward compatibility, if no personas exist for a workspace:
- Read `WorkspaceSettings` persona fields
- Auto-create a "Default" persona from those values
- Mark as `isDefault: true`
- Return the created persona

This can be called lazily when needed (e.g., on persona list load or draft generation).

## Output

**Completed 2026-01-19:**

- Created `actions/ai-persona-actions.ts` (570+ lines) with all CRUD + utility actions:
  - **Types exported**: `AiPersonaData`, `AiPersonaSummary`, `CreateAiPersonaInput`, `UpdateAiPersonaInput`
  - **`listAiPersonas(clientId)`**: Returns summaries ordered by isDefault desc, name asc, with campaign counts
  - **`getAiPersona(id)`**: Returns full persona data
  - **`createAiPersona(clientId, input)`**: Creates persona with name validation, auto-sets default if first persona
  - **`updateAiPersona(id, input)`**: Updates persona with name uniqueness check, handles isDefault transitions
  - **`deleteAiPersona(id)`**: Deletes persona, promotes next-oldest to default if deleting default
  - **`setDefaultAiPersona(id)`**: Sets persona as workspace default (unsets others in transaction)
  - **`getDefaultAiPersona(clientId)`**: Returns default persona or null
  - **`getOrCreateDefaultPersonaFromSettings(clientId)`**: Backward compatibility helper - creates "Default" persona from WorkspaceSettings if no personas exist
  - **`duplicateAiPersona(id, newName?)`**: Creates copy with unique name

- All actions use:
  - `requireClientAccess` for read operations
  - `requireClientAdminAccess` for write operations
  - Prisma transactions for multi-step operations (default switching, delete with promotion)

- `npm run lint` passes (warnings only, none from new file)

## Handoff

Subphase 39c can now build the Persona Manager UI using these actions:
- Import from `@/actions/ai-persona-actions`
- Use `listAiPersonas` for initial load
- Use `createAiPersona`/`updateAiPersona` for form submissions
- Use `deleteAiPersona` for delete confirmation
- Use `setDefaultAiPersona` for "Set as Default" action
- Use `getOrCreateDefaultPersonaFromSettings` for backward-compat migration prompt
