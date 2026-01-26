# Phase 58a — Schema Update: Add `publicUrl` Field to CalendarLink

## Focus
Add a new optional `publicUrl` field to the `CalendarLink` model that will store the "frontend" booking link sent to leads, separate from the `url` field used for backend availability fetching.

## Inputs
- `prisma/schema.prisma`: Current `CalendarLink` model definition (lines 1166-1182)
- Phase 58 root plan: Understanding of the dual-purpose separation needed

## Work

### Step 1: Update Prisma Schema

Add `publicUrl` field to `CalendarLink` model:

```prisma
model CalendarLink {
  id         String   @id @default(uuid())
  clientId   String
  client     Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  name       String              // Display name (e.g., "Sales Calendar", "Demo Calls")
  url        String              // Backend: Full calendar URL for fetching availability
  publicUrl  String?             // Frontend: Optional public booking link sent to leads (falls back to url)
  type       String              // 'calendly' | 'hubspot' | 'ghl' | 'unknown'
  isDefault  Boolean  @default(false)  // Default calendar for this workspace
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  // ... existing relations
}
```

**Key semantics**:
- `url` (required): Used by availability fetching code (backend)
- `publicUrl` (optional): Used by `getBookingLink()` for outbound messages (frontend)
- When `publicUrl` is null/empty, code should fall back to `url`

### Step 2: Add Field Comment for Documentation

Include clear field-level comments in schema to explain the distinction:
- `url`: "Backend: Full calendar URL for fetching availability slots from provider APIs"
- `publicUrl`: "Frontend: Optional public booking link sent to leads in messages (falls back to url if not set)"

### Step 3: Run Schema Push

```bash
npm run db:push
```

### Step 4: Verify Migration

- Check Prisma Studio to confirm field exists
- Existing CalendarLink records should have `publicUrl = null` (backwards compatible)

## Output
- Updated `prisma/schema.prisma` with new `publicUrl` field on `CalendarLink`
- Database schema updated via `npm run db:push`
- No data migration needed (new field is optional)

## Handoff
Phase 58b will update `getBookingLink()` in `lib/meeting-booking-provider.ts` to read `publicUrl` with fallback to `url`.
