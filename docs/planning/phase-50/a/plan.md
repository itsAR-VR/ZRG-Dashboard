# Phase 50a — Schema: Add from/to Fields to Message Model

## Focus

Add `fromEmail`, `fromName`, `toEmail`, `toName` fields to the Message model to store explicit sender/recipient information for email messages.

## Inputs

- Current Message model in `prisma/schema.prisma` (lines 631-674)
- Existing `cc` and `bcc` fields are `String[]` arrays

## Work

1. **Repo reality check** — Confirm whether these fields already exist in `prisma/schema.prisma` (Phase 50 may already be partially applied in the working tree):
   - `rg -n "fromEmail|fromName|toEmail|toName" prisma/schema.prisma`

2. **Edit `prisma/schema.prisma` (if needed)** — Add four new optional fields to Message model:
   ```prisma
   model Message {
     // ... existing fields ...

     // Email participant fields (Phase 50)
     fromEmail    String?  // Sender email address
     fromName     String?  // Sender display name
     toEmail      String?  // Primary recipient email address
     toName       String?  // Primary recipient display name
   }
   ```

3. **Run `npm run db:push`** — Apply schema changes to database
   - Ensure `DIRECT_URL` is set correctly for Prisma CLI usage (see repo README/AGENTS guidance)

4. **Verify in Prisma Studio** — Confirm new fields appear on Message model

## Output

- Added `fromEmail`, `fromName`, `toEmail`, `toName` fields to Message model in `prisma/schema.prisma` (lines 650-653)
- Ran `npm run db:push` successfully - schema applied to database
- Fields are nullable for backward compatibility with existing messages

## Handoff

Subphase b will update the email webhooks (EmailBison, SmartLead, Instantly) to populate these new fields when creating Message records.
