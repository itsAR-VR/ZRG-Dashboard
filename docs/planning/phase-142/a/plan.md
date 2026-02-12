# Phase 142a — Schema Changes

## Focus

Add the database fields needed for booking qualification: new background job type, workspace settings for the feature, and lead-level qualification tracking fields.

## Inputs

- Root plan context and field definitions
- Existing `prisma/schema.prisma` structure

## Work

### 1. Add `BOOKING_QUALIFICATION_CHECK` to `BackgroundJobType` enum (~line 165)

```prisma
BOOKING_QUALIFICATION_CHECK
```

### 2. Add fields to `WorkspaceSettings` model

```prisma
// Post-booking qualification check (Phase 142)
bookingQualificationCheckEnabled  Boolean  @default(false)
bookingQualificationCriteria      String?  @db.Text
bookingDisqualificationMessage    String?  @db.Text
```

- `bookingQualificationCheckEnabled` — master toggle, defaults to `false` (no behavior change for existing workspaces)
- `bookingQualificationCriteria` — free-text description of what qualifies a lead (fed to AI evaluator)
- `bookingDisqualificationMessage` — customizable template with `{reasons}` and `{companyName}` vars

### 3. Add fields to `Lead` model

```prisma
// Post-booking qualification (Phase 142)
bookingQualificationStatus     String?
bookingQualificationCheckedAt  DateTime?
bookingQualificationReason     String?   @db.Text
```

- `bookingQualificationStatus` — `"pending"` | `"qualified"` | `"disqualified"` | `null`
- `bookingQualificationCheckedAt` — when the AI check ran
- `bookingQualificationReason` — AI-generated reasoning for the decision

### 4. Run `npm run db:push`

Verify schema deploys cleanly.

### Verify

- `npm run db:push` succeeds
- `npm run build` passes (Prisma client regenerated)
- New fields visible in Prisma Studio (`npm run db:studio`)

## Output

Schema updated with all required fields. Prisma client regenerated.

## Handoff

142b can now use the new types (`BackgroundJobType.BOOKING_QUALIFICATION_CHECK`) and settings fields in TypeScript code.
