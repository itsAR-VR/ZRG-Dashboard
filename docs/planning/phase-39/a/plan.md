# Phase 39a — Data Model & Schema

## Focus

Create the `AiPersona` Prisma model and establish the relationship between campaigns and personas. This lays the foundation for all subsequent subphases.

## Inputs

- Current `WorkspaceSettings` persona fields (reference for field names/types)
- `BookingProcess` / `EmailCampaign` relationship pattern (from Phase 36)
- Root plan requirements for persona structure

## Work

### 1. Add `AiPersona` model to `prisma/schema.prisma`

```prisma
// =============================================================================
// AI Personas (Phase 39)
// =============================================================================

// Reusable AI persona definition per workspace
// Defines how the AI communicates: name, tone, greeting, signature, goals, etc.
model AiPersona {
  id          String   @id @default(uuid())
  clientId    String
  client      Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)

  name        String                    // Display name (e.g., "Direct Sales Rep", "Consultative Advisor")
  isDefault   Boolean  @default(false)  // One default per workspace

  // Communication style
  personaName       String?             // AI display name in messages (e.g., "Sarah")
  tone              String   @default("friendly-professional")
  greeting          String?             // Email greeting (e.g., "Hi {firstName},")
  smsGreeting       String?             // SMS greeting (falls back to greeting)
  signature         String?  @db.Text   // Email signature block

  // Strategy & context
  goals             String?  @db.Text   // AI goals & strategy
  serviceDescription String? @db.Text   // Business/service description
  idealCustomerProfile String? @db.Text // ICP for lead scoring context

  // Relations
  campaigns   EmailCampaign[]

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  createdBy   String?                   // Supabase Auth user ID who created

  @@unique([clientId, name])            // Unique persona names per workspace
  @@index([clientId])
  @@index([clientId, isDefault])        // Fast lookup for default persona
}
```

### 2. Add relation to `Client` model

```prisma
// In Client model, add:
aiPersonas AiPersona[]
```

### 3. Add optional persona reference to `EmailCampaign`

```prisma
// In EmailCampaign model, add after bookingProcessId:
aiPersonaId      String?
aiPersona        AiPersona? @relation(fields: [aiPersonaId], references: [id], onDelete: SetNull)

// Add index:
@@index([aiPersonaId])
```

### 4. Run Prisma migration

```bash
npm run db:push
```

### 5. Verify in Prisma Studio

- Confirm `AiPersona` table exists
- Confirm `EmailCampaign.aiPersonaId` column exists
- Confirm indexes are created

## Output

**Completed 2026-01-19:**

- `prisma/schema.prisma` updated with `AiPersona` model (lines 1171-1207):
  - Fields: `id`, `clientId`, `name`, `isDefault`, `personaName`, `tone`, `greeting`, `smsGreeting`, `signature`, `goals`, `serviceDescription`, `idealCustomerProfile`, `createdBy`, timestamps
  - Unique constraint: `[clientId, name]` — persona names unique per workspace
  - Indexes: `[clientId]` and `[clientId, isDefault]` for fast lookups
  - Relation: `campaigns EmailCampaign[]`

- `Client` model updated (line 162):
  - Added `aiPersonas AiPersona[]` relation

- `EmailCampaign` model updated (lines 776-778, 785):
  - Added `aiPersonaId String?`
  - Added `aiPersona AiPersona? @relation(fields: [aiPersonaId], references: [id], onDelete: SetNull)`
  - Added `@@index([aiPersonaId])`

- Database schema synced via `npm run db:push`:
  - `AiPersona` table created
  - `EmailCampaign.aiPersonaId` column added
  - Prisma client regenerated automatically

## Handoff

Subphase 39b can now implement CRUD actions using the new `AiPersona` model and Prisma client types. The types are available via `import { AiPersona } from "@prisma/client"`.
